import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { buildings, captureSessions, contributorLinks } from "@/db/schema";
import { checkLink, type LinkRow } from "@/lib/links";
import { jsonError, parseJson } from "@/lib/api";
import { haversineM } from "@/lib/geo";
import { rateLimit } from "@/lib/rate-limit";

/**
 * Start (or resume) a capture session for a mapping link.
 * All link permissions are re-validated server-side here.
 */
export async function POST(req: Request) {
  const limited = rateLimit(req, "api");
  if (limited) return limited;
  const body = await parseJson<{
    token?: string;
    name?: string;
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

  // Resume an existing session for this link.
  if (body?.sessionId) {
    const existing = await db
      .select()
      .from(captureSessions)
      .where(
        eq(captureSessions.id, body.sessionId),
      )
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

  const created = await db
    .insert(captureSessions)
    .values({
      linkToken: okLink.token,
      contributorName: (body?.name ?? "Anonymous").slice(0, 120) || "Anonymous",
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
    link: {
      label: link.label,
      scope: link.scope,
      centerLat: link.centerLat,
      centerLng: link.centerLng,
      radiusM: link.radiusM,
      allowVideo: link.allowVideo,
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
