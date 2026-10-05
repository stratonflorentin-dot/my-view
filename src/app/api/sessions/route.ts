import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { buildings, captureSessions, contributorLinks, forms } from "@/db/schema";
import { checkLink, type LinkRow } from "@/lib/links";
import { getSession } from "@/lib/auth";
import { jsonError, parseJson } from "@/lib/api";
import { haversineM } from "@/lib/geo";
import { rateLimit } from "@/lib/rate-limit";

/**
 * Start (or resume) a capture session for a scan link.
 * All link permissions are re-validated server-side here.
 */
export async function POST(req: Request) {
  const limited = rateLimit(req, "api");
  if (limited) return limited;
  const body = await parseJson<{
    token?: string;
    name?: string;
    kind?: "building" | "area";
    deviceInfo?: Record<string, unknown>;
    sessionId?: string;
  }>(req);
  const token = (body?.token ?? "").toUpperCase();
  if (token.length < 8 || token.length > 12) return jsonError("Invalid link");

  const rows = await db
    .select()
    .from(contributorLinks)
    .where(eq(contributorLinks.token, token))
    .limit(1);
  const link = rows[0] ?? null;
  const check = checkLink(link);
  if (!check.ok) {
    return NextResponse.json({ ok: false, message: check.message }, { status: 403 });
  }
  const okLink = check.link;

  // Require-login links need an authenticated session.
  let userId: string | null = null;
  if (okLink.requireLogin) {
    const user = await getSession();
    if (!user) {
      return NextResponse.json(
        { ok: false, message: "This scan link requires you to sign in first." },
        { status: 401 },
      );
    }
    userId = user.sub;
  }

  // Resume an existing session for this link.
  if (body?.sessionId) {
    const existing = await db
      .select()
      .from(captureSessions)
      .where(eq(captureSessions.id, body.sessionId))
      .limit(1);
    const s = existing[0];
    if (s && s.linkToken === okLink.token) {
      return NextResponse.json(sessionPayload(okLink, s));
    }
  }

  // If this is a location-scoped link, attach any outstanding imagery
  // request so the contributor sees a concrete task.
  let requestedImagery: string | null = null;
  if (okLink.scope === "location" && okLink.centerLat != null && okLink.centerLng != null) {
    const bs = await db.select().from(buildings).limit(500);
    const near = bs.find(
      (b) =>
        haversineM(b.centerLat, b.centerLng, okLink.centerLat!, okLink.centerLng!) <
        Math.max(200, okLink.radiusM),
    );
    if (near?.requestedImagery) requestedImagery = near.requestedImagery;
  }

  const kind = body?.kind === "area" ? "area" : "building";
  if (kind === "area" && !okLink.allowAreaScan) {
    return NextResponse.json(
      { ok: false, message: "Area scanning is not allowed on this link." },
      { status: 403 },
    );
  }

  const created = await db
    .insert(captureSessions)
    .values({
      linkToken: okLink.token,
      projectId: okLink.projectId,
      kind,
      contributorName: (body?.name ?? "Anonymous").slice(0, 120) || "Anonymous",
      userId,
      deviceInfo: (body?.deviceInfo ?? null) as never,
    })
    .returning();
  const session = created[0];

  if (okLink.oneTime) {
    await db
      .update(contributorLinks)
      .set({ usedSessionId: session.id })
      .where(eq(contributorLinks.id, okLink.id));
  }

  return NextResponse.json(sessionPayload(okLink, session, requestedImagery), {
    status: 201,
  });
}

function sessionPayload(
  link: LinkRow,
  session: typeof captureSessions.$inferSelect,
  requestedImagery: string | null = null,
) {
  return {
    sessionId: session.id,
    contributorName: session.contributorName,
    projectId: session.projectId,
    kind: session.kind,
    link: {
      label: link.label,
      scope: link.scope,
      fenceType: link.fenceType,
      centerLat: link.centerLat,
      centerLng: link.centerLng,
      radiusM: link.radiusM,
      polygon: link.polygon,
      requireGps: link.requireGps,
      minGpsAccuracyM: link.minGpsAccuracyM,
      allowPhotos: link.allowPhotos,
      allowVideo: link.allowVideo,
      allowBuildingScan: link.allowBuildingScan,
      allowAreaScan: link.allowAreaScan,
      requireApproval: link.requireApproval,
      maxSubmissions: link.maxSubmissions,
      usedSubmissions: link.usedSubmissions,
    },
    remaining:
      link.maxSubmissions == null
        ? null
        : Math.max(0, link.maxSubmissions - link.usedSubmissions),
    requestedImagery,
  };
}

/** GET /api/sessions?token=… — public scan-link metadata incl. custom form. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const token = (url.searchParams.get("token") ?? "").toUpperCase();
  if (token.length < 8 || token.length > 12) return jsonError("Invalid link");
  const rows = await db
    .select()
    .from(contributorLinks)
    .where(eq(contributorLinks.token, token))
    .limit(1);
  const check = checkLink(rows[0] ?? null);
  if (!check.ok) {
    return NextResponse.json({ ok: false, message: check.message }, { status: 403 });
  }
  const link = check.link;
  let form = null;
  if (link.formId) {
    const f = await db.select().from(forms).where(eq(forms.id, link.formId)).limit(1);
    form = f[0] ? { id: f[0].id, name: f[0].name, fields: f[0].fields } : null;
  }
  return NextResponse.json({
    ok: true,
    link: {
      label: link.label,
      scope: link.scope,
      fenceType: link.fenceType,
      centerLat: link.centerLat,
      centerLng: link.centerLng,
      radiusM: link.radiusM,
      polygon: link.polygon,
      requireLogin: link.requireLogin,
      requireGps: link.requireGps,
      minGpsAccuracyM: link.minGpsAccuracyM,
      allowPhotos: link.allowPhotos,
      allowVideo: link.allowVideo,
      allowBuildingScan: link.allowBuildingScan,
      allowAreaScan: link.allowAreaScan,
      requireApproval: link.requireApproval,
      maxSubmissions: link.maxSubmissions,
      usedSubmissions: link.usedSubmissions,
      projectId: link.projectId,
    },
    form,
  });
}
