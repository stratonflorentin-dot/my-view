import { NextResponse } from "next/server";
import { db } from "@/db";
import { contributorLinks } from "@/db/schema";
import { clientIp, requireRole } from "@/lib/auth";
import { audit, jsonError, parseJson } from "@/lib/api";
import { generateToken } from "@/lib/links";
import { rateLimit } from "@/lib/rate-limit";

export async function GET() {
  const user = await requireRole(["admin"]);
  const links = await db
    .select()
    .from(contributorLinks)
    .orderBy(contributorLinks.createdAt)
    .limit(200);
  return NextResponse.json({ links });
}

export async function POST(req: Request) {
  const limited = rateLimit(req, "api");
  if (limited) return limited;
  const user = await requireRole(["admin"]);
  const body = await parseJson<{
    label?: string;
    scope?: "global" | "area" | "location";
    centerLat?: number;
    centerLng?: number;
    radiusM?: number;
    allowVideo?: boolean;
    maxSubmissions?: number | null;
    oneTime?: boolean;
    expiresInDays?: number | null;
  }>(req);
  if (!body) return jsonError("Invalid JSON");

  const scope = body.scope ?? "global";
  const centerLat =
    body.centerLat != null && Number.isFinite(body.centerLat)
      ? body.centerLat
      : null;
  const centerLng =
    body.centerLng != null && Number.isFinite(body.centerLng)
      ? body.centerLng
      : null;
  if (scope !== "global" && (centerLat == null || centerLng == null)) {
    return jsonError("Scoped links require a center location");
  }
  const rows = await db
    .insert(contributorLinks)
    .values({
      token: generateToken(),
      label: (body.label ?? "Mapping link").slice(0, 160),
      scope,
      centerLat,
      centerLng,
      radiusM: Math.min(5000, Math.max(20, body.radiusM ?? 250)),
      allowVideo: body.allowVideo ?? true,
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
  }, clientIp(req));
  return NextResponse.json(
    {
      link,
      contributePath: `/contribute/${link.token}`,
      contributeUrl: `${req.headers.get("origin") ?? ""}/contribute/${link.token}`,
    },
    { status: 201 },
  );
}
