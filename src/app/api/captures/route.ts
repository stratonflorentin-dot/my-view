import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import {
  captureSessions,
  captures,
  contributorLinks,
  gpsFixes,
} from "@/db/schema";
import { getSettings } from "@/lib/config";
import { fenceFromLink, inFence, OUTSIDE_FENCE_MESSAGE } from "@/lib/fence";
import { validateFix } from "@/lib/gps";
import { checkLink } from "@/lib/links";
import { jsonError, parseJson } from "@/lib/api";
import { ensureWorkerStarted } from "@/lib/pipeline/worker";
import { enqueueJob } from "@/lib/pipeline/pipeline";
import { captureStorageKey, storage } from "@/lib/storage";
import { rateLimit } from "@/lib/rate-limit";

const MAX_IMAGE_BYTES = 12 * 1024 * 1024; // client pre-compresses; hard cap 12MB
const MAX_VIDEO_BYTES = 60 * 1024 * 1024;

/**
 * Upload a capture (base64 image/video + app-recorded GPS).
 * GPS recorded by the app is the primary location; EXIF is not trusted.
 */
export async function POST(req: Request) {
  ensureWorkerStarted();
  const limited = rateLimit(req, "upload");
  if (limited) return limited;

  const body = await parseJson<{
    sessionId?: string;
    kind?: "photo" | "video";
    mime?: string;
    base64?: string;
    gps?: {
      lat: number;
      lng: number;
      altitude?: number | null;
      hAccuracy?: number | null;
      vAccuracy?: number | null;
      heading?: number | null;
      source?: string;
      deviceTs?: string;
    };
  }>(req);

  const kind = body?.kind === "video" ? "video" : "photo";
  if (!body?.sessionId || !body?.base64) return jsonError("sessionId and base64 required");
  if (
    !body.mime ||
    !(kind === "photo"
      ? body.mime.startsWith("image/")
      : body.mime.startsWith("video/"))
  ) {
    return jsonError(`MIME type must match a ${kind}`);
  }

  const sessionRows = await db
    .select()
    .from(captureSessions)
    .where(eq(captureSessions.id, body.sessionId))
    .limit(1);
  const session = sessionRows[0];
  if (!session) return jsonError("Unknown session", 404);

  const linkRows = await db
    .select()
    .from(contributorLinks)
    .where(eq(contributorLinks.token, session.linkToken))
    .limit(1);
  const linkCheck = checkLink(linkRows[0] ?? null);
  if (!linkCheck.ok) {
    return NextResponse.json({ error: linkCheck.message }, { status: 403 });
  }
  const link = linkCheck.ok ? linkCheck.link : null;
  if (!link) return jsonError("Link unavailable", 403);
  if (kind === "video" && !link.allowVideo) {
    return jsonError("Video capture is not allowed on this link", 403);
  }
  if (kind === "photo" && !link.allowPhotos) {
    return jsonError("Photographs are not allowed on this link", 403);
  }

  const settings = await getSettings();
  const gps = body.gps;
  if (!gps || typeof gps.lat !== "number" || typeof gps.lng !== "number") {
    return jsonError("GPS coordinates are required for every capture", 422);
  }
  // Per-link accuracy floor (falls back to the platform threshold).
  const minAccuracy = link.minGpsAccuracyM ?? settings.gps_max_accuracy_m;
  const fixCheck = validateFix(
    {
      lat: gps.lat,
      lng: gps.lng,
      altitude: gps.altitude,
      hAccuracy: gps.hAccuracy,
      vAccuracy: gps.vAccuracy,
      heading: gps.heading,
      source: gps.source,
    },
    minAccuracy,
  );
  if (!fixCheck.ok) {
    return NextResponse.json(
      { error: fixCheck.errors.join(", ") },
      { status: 422 },
    );
  }
  // Hard reject beyond twice the configured threshold — the data would be
  // geographically meaningless. Between threshold and 2x it is accepted
  // but the grade is recorded and confidence is penalized.
  if (gps.hAccuracy != null && gps.hAccuracy > minAccuracy * 2) {
    return NextResponse.json(
      { error: fixCheck.grade.message },
      { status: 422 },
    );
  }
  // Geographic fence enforcement (server-side, never client-trusted).
  const fence = fenceFromLink(link);
  if (fence && !inFence({ lat: gps.lat, lng: gps.lng }, fence)) {
    return jsonError(OUTSIDE_FENCE_MESSAGE, 422);
  }

  // Decode + size check + file validation (magic bytes for jpeg/png/mp4).
  let buf: Buffer;
  try {
    buf = Buffer.from(body.base64, "base64");
  } catch {
    return jsonError("Invalid base64 payload");
  }
  const maxBytes = kind === "video" ? MAX_VIDEO_BYTES : MAX_IMAGE_BYTES;
  if (!buf.length) return jsonError("Empty payload");
  if (buf.length > maxBytes)
    return jsonError(`File too large (max ${Math.round(maxBytes / 1048576)} MB)`, 413);
  const sig = buf.subarray(0, 4).toString("hex");
  const validSig =
    (kind === "photo" && (sig.startsWith("ffd8ff") || sig.startsWith("89504e47"))) ||
    (kind === "video" && (sig === "0000001c" || sig === "00000020" || sig === "2650484d" || sig.startsWith("1a45dfa3")));
  if (!validSig) return jsonError("Unsupported or corrupted media file");

  const captureId = crypto.randomUUID();
  const ext = kind === "video" ? "mp4" : body.mime.includes("png") ? "png" : "jpg";
  const storageKey = captureStorageKey(session.id, captureId, ext);
  await storage.put(storageKey, buf, body.mime);

  const insert = await db
    .insert(captures)
    .values({
      id: captureId,
      sessionId: session.id,
      kind,
      storageKey,
      mime: body.mime,
      sizeBytes: buf.length,
      gpsLat: gps.lat,
      gpsLng: gps.lng,
      gpsAltitude: gps.altitude ?? null,
      gpsHAccuracy: gps.hAccuracy ?? null,
      gpsVAccuracy: gps.vAccuracy ?? null,
      gpsHeading: gps.heading ?? null,
      gpsSource: gps.source ?? "device",
      deviceTimestamp: gps.deviceTs ? new Date(gps.deviceTs) : new Date(),
      status: "received",
    })
    .returning();

  // Discrete GPS fix record (session-level provenance).
  await db
    .insert(gpsFixes)
    .values({
      captureId,
      sessionId: session.id,
      lat: gps.lat,
      lng: gps.lng,
      altitude: gps.altitude ?? null,
      hAccuracy: gps.hAccuracy ?? null,
      vAccuracy: gps.vAccuracy ?? null,
      heading: gps.heading ?? null,
      source: gps.source ?? "device",
      deviceTs: gps.deviceTs ? new Date(gps.deviceTs) : new Date(),
    })
    .catch(() => {});

  // Count the submission against the link.
  await db
    .update(contributorLinks)
    .set({ usedSubmissions: link.usedSubmissions + 1 })
    .where(eq(contributorLinks.id, link.id));

  const job = await enqueueJob(
    kind === "video" ? "video.process" : "capture.process",
    { captureId },
    8,
  );
  void job;

  return NextResponse.json(
    {
      captureId,
      status: "received",
      grade: fixCheck.grade,
    },
    { status: 201 },
  );
}
