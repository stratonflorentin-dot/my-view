import { NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { captureSessions, contributorLinks } from "@/db/schema";
import { checkLink } from "@/lib/links";
import { rateLimit } from "@/lib/rate-limit";

/**
 * Public, unauthenticated check of a mapping link. This is what the
 * contributor page calls first — server-side validation, never trusting
 * the client.
 */
export async function GET(req: Request) {
  const limited = rateLimit(req, "api");
  if (limited) return limited;
  const token = new URL(req.url).searchParams.get("token") ?? "";
  if (token.length < 8 || token.length > 12) {
    return NextResponse.json({ ok: false, message: "Invalid link" });
  }
  const rows = await db
    .select()
    .from(contributorLinks)
    .where(eq(contributorLinks.token, token.toUpperCase()))
    .limit(1);
  const link = rows[0] ?? null;
  const check = checkLink(link);
  if (!check.ok) {
    return NextResponse.json({ ok: false, reason: check.reason, message: check.message });
  }
  // Resume support: find the contributor's most recent session for this
  // link so an interrupted capture can continue (offline queue).
  const sessions = await db
    .select()
    .from(captureSessions)
    .where(eq(captureSessions.linkToken, link.token))
    .orderBy(desc(captureSessions.startedAt))
    .limit(1);
  const last = sessions[0] ?? null;
  return NextResponse.json({
    ok: true,
    link: {
      label: link.label,
      scope: link.scope,
      centerLat: link.centerLat,
      centerLng: link.centerLng,
      radiusM: link.radiusM,
      allowVideo: link.allowVideo,
      oneTime: link.oneTime,
      maxSubmissions: link.maxSubmissions,
      usedSubmissions: link.usedSubmissions,
      expiresAt: link.expiresAt,
    },
    lastSessionId: last ? last.id : null,
  });
}
