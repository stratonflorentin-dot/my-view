import { NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { captureSessions, contributorLinks, forms } from "@/db/schema";
import { checkLink } from "@/lib/links";
import { rateLimit } from "@/lib/rate-limit";

/**
 * Public, unauthenticated check of a scan/mapping link. This is what the
 * contributor page calls first — server-side validation, never trusting
 * the client. Returns the link's capture permissions and its custom form
 * definition (if any).
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
      requireGps: link.requireGps,
      minGpsAccuracyM: link.minGpsAccuracyM,
      allowPhotos: link.allowPhotos,
      allowVideo: link.allowVideo,
      allowBuildingScan: link.allowBuildingScan,
      allowAreaScan: link.allowAreaScan,
      requireApproval: link.requireApproval,
      oneTime: link.oneTime,
      maxSubmissions: link.maxSubmissions,
      usedSubmissions: link.usedSubmissions,
      expiresAt: link.expiresAt,
    },
    form,
    lastSessionId: last ? last.id : null,
  });
}
