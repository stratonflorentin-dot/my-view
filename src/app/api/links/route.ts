import { NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { contributorLinks } from "@/db/schema";
import { clientIp, requireUser } from "@/lib/auth";
import { audit, jsonError, parseJson } from "@/lib/api";
import { generateToken } from "@/lib/links";
import { rateLimit } from "@/lib/rate-limit";
import { canManage, projectAccess } from "@/lib/tenancy";
import { fenceFromLink, type Fence } from "@/lib/fence";

/**
 * Scan links. A link belongs to a map project; everything contributed
 * through it lands in that project. Full configuration set per the
 * scan-system spec; all permissions are re-validated server-side.
 */

export async function GET(req: Request) {
  const user = await requireUser();
  const url = new URL(req.url);
  const projectId = url.searchParams.get("projectId");
  if (projectId) {
    const { level } = await projectAccess(user, projectId);
    if (!level) return jsonError("forbidden", 403);
    const links = await db
      .select()
      .from(contributorLinks)
      .where(eq(contributorLinks.projectId, projectId))
      .orderBy(desc(contributorLinks.createdAt))
      .limit(200);
    return NextResponse.json({ links });
  }
  // No project filter: admins see everything; others see their projects' links.
  if (user.role === "admin") {
    const links = await db
      .select()
      .from(contributorLinks)
      .orderBy(desc(contributorLinks.createdAt))
      .limit(200);
    return NextResponse.json({ links });
  }
  return jsonError("projectId query parameter is required", 400);
}

export async function POST(req: Request) {
  const limited = rateLimit(req, "api");
  if (limited) return limited;
  const user = await requireUser();
  const body = await parseJson<{
    projectId?: string;
    label?: string;
    scope?: "global" | "area" | "location";
    fenceType?: "circle" | "polygon" | "rectangle";
    centerLat?: number;
    centerLng?: number;
    radiusM?: number;
    polygon?: number[][] | [number, number, number, number];
    requireLogin?: boolean;
    requireGps?: boolean;
    minGpsAccuracyM?: number;
    allowPhotos?: boolean;
    allowVideo?: boolean;
    allowBuildingScan?: boolean;
    allowAreaScan?: boolean;
    requireApproval?: boolean;
    autoPublish?: boolean;
    formId?: string;
    maxSubmissions?: number | null;
    oneTime?: boolean;
    expiresInDays?: number | null;
  }>(req);
  if (!body) return jsonError("Invalid JSON");

  // Project membership is mandatory unless the caller is a platform admin.
  let projectId: string | null = null;
  if (body.projectId) {
    const { level } = await projectAccess(user, body.projectId);
    if (!level || !canManage(level)) {
      return jsonError("You do not have permission to create links for this project", 403);
    }
    projectId = body.projectId;
  } else if (user.role !== "admin") {
    return jsonError("projectId is required", 400);
  }

  const scope = body.scope ?? "global";
  const fenceType = body.fenceType ?? "circle";
  const centerLat =
    body.centerLat != null && Number.isFinite(body.centerLat) ? body.centerLat : null;
  const centerLng =
    body.centerLng != null && Number.isFinite(body.centerLng) ? body.centerLng : null;

  let polygon: unknown = null;
  if (fenceType === "rectangle") {
    const b = body.polygon;
    if (!Array.isArray(b) || b.length !== 4 || b.some((n) => !Number.isFinite(n))) {
      return jsonError("Rectangle fence requires polygon=[minLng,minLat,maxLng,maxLat]");
    }
    polygon = b;
  } else if (fenceType === "polygon") {
    const ring = body.polygon;
    if (
      !Array.isArray(ring) ||
      ring.length < 3 ||
      !ring.every((p) => Array.isArray(p) && p.length === 2 && p.every((n) => Number.isFinite(n)))
    ) {
      return jsonError("Polygon fence requires polygon=[[lng,lat], …] with ≥ 3 points");
    }
    polygon = ring;
  }

  if (fenceType === "circle" && scope !== "global" && (centerLat == null || centerLng == null)) {
    return jsonError("Scoped links require a center location");
  }
  if (scope === "global") {
    body.centerLat = undefined;
    body.centerLng = undefined;
  }

  // Validate the fence parses before persisting.
  const fence = fenceFromLink({
    fenceType,
    centerLat,
    centerLng,
    radiusM: body.radiusM ?? 250,
    polygon,
    scope,
  } as never) as Fence | null;
  if (scope !== "global" && !fence) {
    return jsonError("Invalid geo-fence configuration");
  }

  const rows = await db
    .insert(contributorLinks)
    .values({
      token: generateToken(),
      projectId,
      label: (body.label ?? "Scan link").slice(0, 160),
      scope,
      fenceType,
      polygon: polygon as never,
      centerLat,
      centerLng,
      radiusM: Math.min(20000, Math.max(20, body.radiusM ?? 250)),
      requireLogin: body.requireLogin ?? false,
      requireGps: body.requireGps ?? true,
      minGpsAccuracyM:
        body.minGpsAccuracyM != null && Number.isFinite(body.minGpsAccuracyM)
          ? Math.min(200, Math.max(1, body.minGpsAccuracyM))
          : null,
      allowPhotos: body.allowPhotos ?? true,
      allowVideo: body.allowVideo ?? true,
      allowBuildingScan: body.allowBuildingScan ?? true,
      allowAreaScan: body.allowAreaScan ?? false,
      requireApproval: body.requireApproval ?? true,
      autoPublish: body.autoPublish ?? false,
      formId: body.formId ?? null,
      maxSubmissions:
        body.maxSubmissions != null
          ? Math.max(1, Math.min(100000, Math.floor(body.maxSubmissions)))
          : null,
      oneTime: body.oneTime ?? false,
      expiresAt:
        body.expiresInDays != null
          ? new Date(Date.now() + body.expiresInDays * 86400_000)
          : null,
      createdBy: user.sub,
    })
    .returning();
  const link = rows[0];
  await audit(user, "link.create", "contributor_link", link.id, {
    token: link.token,
    scope: link.scope,
    projectId,
  }, clientIp(req));
  return NextResponse.json(
    {
      link,
      scanPath: `/scan/${link.token}`,
      scanUrl: `${req.headers.get("origin") ?? ""}/scan/${link.token}`,
      contributeUrl: `${req.headers.get("origin") ?? ""}/contribute/${link.token}`,
    },
    { status: 201 },
  );
}
