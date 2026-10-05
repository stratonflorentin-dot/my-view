import "server-only";
import { and, eq, isNull, lte, ne } from "drizzle-orm";
import { db } from "@/db";
import {
  buildings,
  buildingVersions,
  captures,
  contributorLinks,
  gpsFixes,
  processingJobs,
} from "@/db/schema";
import { getSettings } from "../config";
import {
  arcCoverage,
  haversineM,
  nearestCenter,
  polygonCentroid,
} from "../geo";
import {
  aHash,
  analyzeImageQuality,
  DUPLICATE_HAMMING_MAX,
  extractImageMeta,
  hamming,
  makeThumbnail,
} from "../image";
import { validateFix } from "../gps";
import { storage } from "../storage";
import {
  EngineNotConfigured,
  selectDetectionEngine,
  selectReconstructionEngine,
  type EnrichedCapture,
} from "./engines";

export type JobRow = typeof processingJobs.$inferSelect;

/* ------------------------------ enqueue ------------------------------ */

export async function enqueueJob(
  type: typeof processingJobs.$inferInsert["type"],
  inputRef: Record<string, unknown>,
  priority = 5,
): Promise<string> {
  const rows = await db
    .insert(processingJobs)
    .values({ type, inputRef, priority })
    .returning();
  return rows[0].id;
}

/* --------------------------- capture job --------------------------- */

/**
 * Captures within this distance of a building's anchor join it. Ring
 * captures around a building are typically 8–20 m apart, while distinct
 * buildings are >30 m apart.
 */
const GROUP_RADIUS_M = 35;

function loadEnrichedCapture(c: typeof captures.$inferSelect): EnrichedCapture {
  const q = (c.quality ?? {}) as Record<string, unknown>;
  return {
    id: c.id,
    lat: c.gpsLat ?? 0,
    lng: c.gpsLng ?? 0,
    altitude: c.gpsAltitude,
    hAccuracy: c.gpsHAccuracy,
    heading: c.gpsHeading,
    sharpness: typeof q.sharpness === "number" ? q.sharpness : 0,
    createdAt: c.createdAt,
  };
}

const refOf = (job: JobRow) =>
  (job.inputRef ?? {}) as Record<string, unknown>;

export async function handleCaptureProcess(job: JobRow): Promise<void> {
  const capId = String(refOf(job).captureId ?? "");
  const rows = await db
    .select()
    .from(captures)
    .where(eq(captures.id, capId))
    .limit(1);
  const cap = rows[0];
  if (!cap) throw new Error(`Capture ${capId} not found`);
  if (cap.status !== "received") return; // idempotent

  const buf = await storage.get(cap.storageKey);
  if (!buf) throw new Error("Stored file missing");

  const settings = await getSettings();

  if (cap.kind === "video") {
    await db
      .update(captures)
      .set({ status: "processed", quality: { note: "video-stored" } })
      .where(eq(captures.id, cap.id));
    await enqueueJob("video.process", { captureId: cap.id }, 7);
    return;
  }

  // 1) validation + metadata extraction
  const meta = await extractImageMeta(buf);
  const grade = validateFix(
    {
      lat: cap.gpsLat!,
      lng: cap.gpsLng!,
      hAccuracy: cap.gpsHAccuracy,
    },
    settings.gps_max_accuracy_m,
  );

  // 2) real image-quality analysis + duplicate detection
  const quality = await analyzeImageQuality(buf);
  const hash = await aHash(buf);
  const siblings = await db
    .select({ id: captures.id, quality: captures.quality, duplicateOf: captures.duplicateOf })
    .from(captures)
    .where(
      and(
        eq(captures.sessionId, cap.sessionId),
        isNull(captures.duplicateOf),
        ne(captures.id, cap.id),
      ),
    );
  let duplicateOf: string | null = null;
  for (const s of siblings) {
    const otherHash = (s.quality as Record<string, unknown> | null)?.hash as
      | string
      | undefined;
    if (otherHash && hamming(hash, otherHash) <= DUPLICATE_HAMMING_MAX) {
      duplicateOf = s.id;
      break;
    }
  }

  // 3) thumbnail for the admin gallery (keeps map payloads small)
  const thumbKey = `thumbs/${cap.storageKey.split("/").slice(0, 3).join("/")}/t-${cap.id}.jpg`;
  await storage.put(thumbKey, await makeThumbnail(buf), "image/jpeg");

  const qualityJson = {
    ...quality,
    hash,
    gpsGrade: grade.grade.level,
    exifMatch: meta.exif.gps
      ? Math.round(
          haversineM(
            meta.exif.gps.lat,
            meta.exif.gps.lng,
            cap.gpsLat!,
            cap.gpsLng!,
          ) * 10,
        ) / 10
      : null,
  };

  await db
    .update(captures)
    .set({
      width: meta.width,
      height: meta.height,
      exif: meta.exif as never,
      quality: qualityJson as never,
      duplicateOf,
      status: duplicateOf ? "rejected" : "processed",
    })
    .where(eq(captures.id, cap.id));
  await storage.put(
    `jobs/${job.id}.log`,
    Buffer.from(
      JSON.stringify(
        {
          at: new Date().toISOString(),
          step: "capture.process",
          grade: grade.grade,
          quality,
          duplicateOf,
        },
        null,
        2,
      ),
    ),
    "application/json",
  );

  if (duplicateOf) return;

  // 4) grouping → building assignment
  await groupCapture(cap.id);

  // 5) enqueue reconstruction for the affected building
  const updated = await db
    .select()
    .from(captures)
    .where(eq(captures.id, cap.id))
    .limit(1);
  const buildingId = updated[0]?.buildingId;
  if (buildingId) {
    await enqueueJob("building.reconstruct", { buildingId }, 6);
  }
}

/**
 * Assigns a capture to a building: nearest existing building center within
 * GROUP_RADIUS_M, otherwise creates a new building anchored at the capture.
 */
export async function groupCapture(captureId: string): Promise<void> {
  const rows = await db
    .select()
    .from(captures)
    .where(eq(captures.id, captureId))
    .limit(1);
  const cap = rows[0];
  if (!cap || cap.gpsLat == null || cap.gpsLng == null) return;
  if (cap.buildingId) return;

  const all = await db
    .select({ id: buildings.id, centerLat: buildings.centerLat, centerLng: buildings.centerLng })
    .from(buildings);
  const idx = nearestCenter(
    { lat: cap.gpsLat, lng: cap.gpsLng },
    all.map((b) => ({ lat: b.centerLat, lng: b.centerLng })),
    GROUP_RADIUS_M,
  );
  let buildingId: string;
  if (idx != null) {
    buildingId = all[idx].id;
  } else {
    const created = await db
      .insert(buildings)
      .values({
        name: `Building ${cap.id.slice(0, 8).toUpperCase()}`,
        centerLat: cap.gpsLat,
        centerLng: cap.gpsLng,
        altitude: cap.gpsAltitude,
        status: "draft",
      })
      .returning();
    buildingId = created[0].id;
  }
  await db
    .update(captures)
    .set({ buildingId })
    .where(eq(captures.id, captureId));
}

/* --------------------------- reconstruct --------------------------- */

export async function handleReconstruct(job: JobRow): Promise<void> {
  const buildingId = String(refOf(job).buildingId ?? "");
  const bRows = await db
    .select()
    .from(buildings)
    .where(eq(buildings.id, buildingId))
    .limit(1);
  const b = bRows[0];
  if (!b) throw new Error(`Building ${buildingId} not found`);

  const capRows = await db
    .select()
    .from(captures)
    .where(
      and(
        eq(captures.buildingId, buildingId),
        eq(captures.status, "processed"),
        isNull(captures.duplicateOf),
        eq(captures.kind, "photo"),
        lte(captures.gpsLat, 90),
      ),
    );
  if (!capRows.length) throw new Error("No processable captures for building");

  const capturesEnriched: EnrichedCapture[] = capRows.map(loadEnrichedCapture);

  // Detection
  const detection = selectDetectionEngine();
  let det: Awaited<ReturnType<typeof detection.detect>>;
  try {
    det = await detection.detect({
      center: { lat: b.centerLat, lng: b.centerLng },
      captures: capturesEnriched,
    });
  } catch (e) {
    if (e instanceof EngineNotConfigured) {
      det = {
        buildingFound: true,
        heightM: null,
        floors: null,
        buildingType: "unknown",
        roofType: "unknown",
        engine: detection.id,
      };
    } else {
      throw e;
    }
  }

  // Reconstruction
  const { primary, fallback } = selectReconstructionEngine(capturesEnriched.length);
  let out: Awaited<ReturnType<typeof primary.reconstruct>>;
  let engineUsed = primary.id;
  try {
    out = await primary.reconstruct({ buildingId, captures: capturesEnriched });
  } catch (e) {
    if (e instanceof EngineNotConfigured || primary.id !== fallback.id) {
      engineUsed = fallback.id;
      out = await fallback.reconstruct({ buildingId, captures: capturesEnriched });
    } else {
      throw e;
    }
  }

  const versions = await db
    .select({ version: buildingVersions.version })
    .from(buildingVersions)
    .where(eq(buildingVersions.buildingId, buildingId));
  const nextVersion = (versions[0]?.version ?? 0) + 1;

  const headings = capturesEnriched.map((c) => c.heading);
  const coverage = arcCoverage(headings);
  const missingArcs = [0, 1, 2, 3, 4, 5, 6, 7].filter(
    (a) => !coverage.covered.includes(a),
  );

  const inserted = await db
    .insert(buildingVersions)
    .values({
      buildingId,
      version: nextVersion,
      type: out.type,
      engine: engineUsed,
      state: out.state,
      confidence: out.confidence,
      footprint: out.footprint as never,
      heightM: det.heightM ?? out.heightM,
      floors: det.floors ?? out.floors,
      buildingType: det.buildingType ?? out.buildingType,
      roofType: det.roofType ?? out.roofType,
      modelUrl: out.modelUrl ?? null,
      modelFormat: out.modelFormat ?? null,
      textureUrl: out.textureUrl ?? null,
      lod: (out.lod ?? null) as never,
      inputs: {
        captureIds: capturesEnriched.map((c) => c.id),
        distinctArcs: coverage.distinctArcs,
        missingArcs,
      } as never,
      metrics: {
        ...(out.metrics as object),
        detectionEngine: det.engine,
        coveredArcs: coverage.covered,
        distinctArcs: coverage.distinctArcs,
        captureCount: capturesEnriched.length,
        engineAvailable: {
          estimation: true,
          remoteReconstruction: selectReconstructionEngine(2).primary.id === "remote-photogrammetry",
        },
      } as never,
      error: out.error ?? null,
    })
    .returning();

  await db
    .update(buildings)
    .set({
      currentVersion: nextVersion,
      status: out.state === "ready" ? "needs_review" : "draft",
      updatedAt: new Date(),
    })
    .where(eq(buildings.id, buildingId));

  await enqueueJob("building.publish", { buildingId, version: nextVersion }, 4);
  void inserted;
}

/* ------------------------------ publish ------------------------------ */

export async function handlePublish(job: JobRow): Promise<void> {
  const buildingId = String(refOf(job).buildingId ?? "");
  const rows = await db
    .select()
    .from(buildings)
    .where(eq(buildings.id, buildingId))
    .limit(1);
  const b = rows[0];
  if (!b) return;
  if (b.status === "draft") {
    await db
      .update(buildings)
      .set({ status: "needs_review", updatedAt: new Date() })
      .where(eq(buildings.id, buildingId));
  }
}

/* ------------------------------- video ------------------------------- */

export async function handleVideoProcess(job: JobRow): Promise<void> {
  // Honest failure: no video-processing engine is configured in this
  // deployment. The file remains stored; admin can retry once an engine
  // is wired in (see docs/3D_RECONSTRUCTION.md).
  throw new EngineNotConfigured("Video processing");
}

/* ------------------------------ helpers ------------------------------ */

export function logJob(jobId: string, text: string) {
  const line = `[${new Date().toISOString()}] ${text}\n`;
  void storage
    .get(`jobs/${jobId}.log`)
    .then((b) =>
      storage.put(`jobs/${jobId}.log`, Buffer.from(`${b?.toString() ?? ""}${line}`), "text/plain"),
    )
    .catch(() => {});
}

export { gpsFixes };
