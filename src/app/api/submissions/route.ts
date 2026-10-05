import { NextResponse } from "next/server";
import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { captureSessions, captures, contributorLinks, forms, submissions } from "@/db/schema";
import { getSession } from "@/lib/auth";
import { jsonError, parseJson } from "@/lib/api";
import { validateFormData } from "@/lib/forms";
import { rateLimit } from "@/lib/rate-limit";
import { projectAccess } from "@/lib/tenancy";
import { dispatchEvent } from "@/lib/webhooks";
import { ensureWorkerStarted } from "@/lib/pipeline/worker";

/**
 * POST /api/submissions — finalize a capture session into a reviewable
 * submission. Called by the scanner when the contributor submits.
 * Link permissions (requireApproval / autoPublish) are applied here.
 */
export async function POST(req: Request) {
  ensureWorkerStarted();
  const limited = rateLimit(req, "api");
  if (limited) return limited;

  const body = await parseJson<{
    sessionId?: string;
    kind?: "building" | "location" | "area";
    name?: string;
    category?: string;
    description?: string;
    address?: string;
    formData?: Record<string, unknown>;
    lat?: number;
    lng?: number;
  }>(req);
  if (!body?.sessionId) return jsonError("sessionId required");

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
  const link = linkRows[0] ?? null;
  if (!link) return jsonError("Scan link no longer exists", 403);

  // Idempotent: one live submission per session.
  const existing = await db
    .select()
    .from(submissions)
    .where(eq(submissions.sessionId, session.id))
    .limit(1);
  if (existing[0]) {
    return NextResponse.json({ submission: existing[0], alreadySubmitted: true });
  }

  // Custom form validation (project's form attached to the link).
  let formData: Record<string, unknown> = {};
  if (link.formId) {
    const f = await db.select().from(forms).where(eq(forms.id, link.formId)).limit(1);
    if (f[0]) {
      const v = validateFormData(f[0].fields ?? [], body.formData ?? {});
      if (!v.ok) {
        return NextResponse.json({ error: "Form validation failed", fieldErrors: v.errors }, { status: 422 });
      }
      formData = v.values;
    }
  } else if (body.formData) {
    formData = body.formData;
  }

  const captureRows = await db
    .select({ count: sql<number>`count(*)` })
    .from(captures)
    .where(eq(captures.sessionId, session.id));
  const captureCount = Number(captureRows[0]?.count ?? 0);

  const kind = body.kind ?? (session.kind === "area" ? "area" : "building");
  const autoApprove = !link.requireApproval;
  const rows = await db
    .insert(submissions)
    .values({
      projectId: session.projectId,
      sessionId: session.id,
      linkToken: session.linkToken,
      contributorName: session.contributorName,
      userId: session.userId,
      kind,
      name: body.name?.slice(0, 200) ?? null,
      category: body.category?.slice(0, 80) ?? null,
      description: body.description?.slice(0, 4000) ?? null,
      address: body.address?.slice(0, 500) ?? null,
      formData,
      lat: Number.isFinite(body.lat) ? body.lat : null,
      lng: Number.isFinite(body.lng) ? body.lng : null,
      captureCount,
      status: autoApprove ? "approved" : "pending",
      reviewedAt: autoApprove ? new Date() : null,
    })
    .returning();
  const submission = rows[0];

  await db
    .update(captureSessions)
    .set({ finishedAt: new Date() })
    .where(eq(captureSessions.id, session.id));

  await dispatchEvent(session.projectId, "scan.created", {
    submissionId: submission.id,
    kind,
    captureCount,
    contributor: session.contributorName,
  });
  if (autoApprove) {
    await dispatchEvent(session.projectId, "scan.completed", {
      submissionId: submission.id,
      status: "approved",
    });
  }

  return NextResponse.json({ submission }, { status: 201 });
}

/** GET /api/submissions?projectId=…&status=… — review queue for a project. */
export async function GET(req: Request) {
  const user = await getSession();
  const url = new URL(req.url);
  const projectId = url.searchParams.get("projectId");
  if (!projectId) return jsonError("projectId required");
  const { level } = await projectAccess(user, projectId);
  if (!level) return jsonError("forbidden", 403);

  const status = url.searchParams.get("status");
  const where = status
    ? and(eq(submissions.projectId, projectId), eq(submissions.status, status as never))
    : eq(submissions.projectId, projectId);
  const rows = await db
    .select()
    .from(submissions)
    .where(where)
    .orderBy(desc(submissions.createdAt))
    .limit(200);
  return NextResponse.json({ submissions: rows });
}
