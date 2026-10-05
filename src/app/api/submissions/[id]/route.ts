import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import {
  buildingVersions,
  buildings,
  captures,
  mapObjects,
  submissions,
} from "@/db/schema";
import { getSession } from "@/lib/auth";
import { audit, jsonError, parseJson } from "@/lib/api";
import { canManage, projectAccess } from "@/lib/tenancy";
import { dispatchEvent } from "@/lib/webhooks";

type Params = { params: Promise<{ id: string }> };

/** Legacy (pre-multi-tenancy) submissions have no project — admins only. */
async function accessForSubmission(
  user: Awaited<ReturnType<typeof getSession>>,
  projectId: string | null,
) {
  if (!projectId) {
    if (user?.role !== "admin") return null;
    return { level: "owner" as const };
  }
  const { level } = await projectAccess(user, projectId);
  if (!level) return null;
  return { level };
}

/** GET /api/submissions/:id — detail with captures for the review UI. */
export async function GET(_req: Request, { params }: Params) {
  const user = await getSession();
  const { id } = await params;
  const rows = await db.select().from(submissions).where(eq(submissions.id, id)).limit(1);
  const submission = rows[0];
  if (!submission) return jsonError("Not found", 404);
  const access = await accessForSubmission(user, submission.projectId);
  if (!access) return jsonError("forbidden", 403);

  const caps = await db
    .select({
      id: captures.id,
      kind: captures.kind,
      status: captures.status,
      gpsLat: captures.gpsLat,
      gpsLng: captures.gpsLng,
      gpsHAccuracy: captures.gpsHAccuracy,
      gpsHeading: captures.gpsHeading,
      quality: captures.quality,
      storageKey: captures.storageKey,
      createdAt: captures.createdAt,
    })
    .from(captures)
    .where(eq(captures.sessionId, submission.sessionId));
  return NextResponse.json({ submission, captures: caps });
}

/**
 * PATCH /api/submissions/:id — review action: approve / reject /
 * needs_imagery / reprocess. Approval creates a map object (and links the
 * pipeline building when present), honoring the link's autoPublish flag.
 */
export async function PATCH(req: Request, { params }: Params) {
  const user = await getSession();
  const { id } = await params;
  const body = await parseJson<{
    action?: "approve" | "reject" | "needs_imagery" | "note";
    note?: string;
  }>(req);
  if (!body?.action) return jsonError("action required");

  const rows = await db.select().from(submissions).where(eq(submissions.id, id)).limit(1);
  const submission = rows[0];
  if (!submission) return jsonError("Not found", 404);
  const access = await accessForSubmission(user, submission.projectId);
  if (!access || !canManage(access.level)) return jsonError("forbidden", 403);

  if (body.action === "note") {
    await db
      .update(submissions)
      .set({ reviewNote: body.note?.slice(0, 2000), updatedAt: new Date() })
      .where(eq(submissions.id, id));
    return NextResponse.json({ ok: true });
  }

  if (body.action === "needs_imagery") {
    // Request more imagery: attach the note to the linked building so the
    // contributor sees it, and surface the submission for re-upload.
    await db
      .update(submissions)
      .set({
        status: "needs_imagery",
        reviewNote: body.note?.slice(0, 2000) ?? "More photographs requested.",
        reviewedBy: user?.sub,
        reviewedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(submissions.id, id));
    if (submission.buildingId) {
      await db
        .update(buildings)
        .set({ requestedImagery: body.note ?? "More photographs requested." })
        .where(eq(buildings.id, submission.buildingId));
    }
    return NextResponse.json({ ok: true, status: "needs_imagery" });
  }

  if (body.action === "reject") {
    await db
      .update(submissions)
      .set({
        status: "rejected",
        reviewNote: body.note ?? null,
        reviewedBy: user?.sub,
        reviewedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(submissions.id, id));
    await dispatchEvent(submission.projectId, "submission.rejected", {
      submissionId: id,
      note: body.note ?? null,
    });
    return NextResponse.json({ ok: true, status: "rejected" });
  }

  // approve
  let objectId = submission.objectId;

  if (!objectId) {
    if (!submission.projectId) {
      return jsonError("Legacy submissions (no project) cannot be promoted to a map object", 422);
    }
    // Use the pipeline building when this is a building scan.
    let building = null as typeof buildings.$inferSelect | null;
    if (submission.buildingId) {
      const bRows = await db
        .select()
        .from(buildings)
        .where(eq(buildings.id, submission.buildingId))
        .limit(1);
      building = bRows[0] ?? null;
    }

    // Geometry: building footprint if available, else the submission GPS.
    let geometry: unknown;
    let verification: "unverified" | "estimated" | "verified" = "unverified";
    let confidence = 0;
    let buildingIdRef: string | null = null;

    if (building) {
      buildingIdRef = building.id;
      const vRows = await db
        .select()
        .from(buildingVersions)
        .where(eq(buildingVersions.buildingId, building.id));
      const v = vRows.find((x) => x.version === building!.currentVersion) ?? vRows[0];
      geometry = (v?.footprint as unknown) ?? {
        type: "Point",
        coordinates: [submission.lng ?? building.centerLng, submission.lat ?? building.centerLat],
      };
      verification =
        building.verification === "verified"
          ? "verified"
          : building.verification === "estimated"
            ? "estimated"
            : "unverified";
      confidence = v?.confidence ?? 0;
      // Name the building from the submission.
      await db
        .update(buildings)
        .set({
          name: submission.name ?? building.name,
          status: "approved",
          updatedAt: new Date(),
        })
        .where(eq(buildings.id, building.id));
    } else {
      const lat = submission.lat;
      const lng = submission.lng;
      if (lat == null || lng == null) {
        return jsonError("Submission has no location — cannot approve to map", 422);
      }
      geometry = { type: "Point", coordinates: [lng, lat] };
    }

    const objRows = await db
      .insert(mapObjects)
      .values({
        projectId: submission.projectId!,
        type: (submission.kind === "area"
          ? "area"
          : submission.kind === "building"
            ? "building"
            : (submission.category as (typeof mapObjects.$inferInsert)["type"]) ?? "location"),
        name: submission.name ?? `Submission ${submission.id.slice(0, 8)}`,
        description: submission.description,
        geometry: geometry as never,
        properties: {
          ...(submission.formData ?? {}),
          address: submission.address ?? null,
          category: submission.category ?? null,
          contributor: submission.contributorName,
          linkToken: submission.linkToken,
        },
        images: [],
        buildingId: buildingIdRef,
        sourceSubmissionId: submission.id,
        confidence,
        verification,
        status: "published",
        createdBy: user?.sub,
      })
      .returning();
    objectId = objRows[0].id;
    await db
      .update(submissions)
      .set({ objectId })
      .where(eq(submissions.id, id));
  }

  await db
    .update(submissions)
    .set({
      status: "approved",
      reviewNote: body.note ?? submission.reviewNote,
      reviewedBy: user?.sub,
      reviewedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(submissions.id, id));

  await dispatchEvent(submission.projectId, "submission.approved", {
    submissionId: id,
    objectId,
  });
  await dispatchEvent(submission.projectId, "location.created", {
    objectId,
    name: submission.name,
  });
  await audit(user ?? { sub: "system", role: "system" }, "submission.approve", "submission", id, { objectId });

  return NextResponse.json({ ok: true, status: "approved", objectId });
}
