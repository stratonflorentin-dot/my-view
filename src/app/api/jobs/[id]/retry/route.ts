import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { processingJobs } from "@/db/schema";
import { clientIp, requireRole } from "@/lib/auth";
import { audit, jsonError } from "@/lib/api";
import { ensureWorkerStarted } from "@/lib/pipeline/worker";

type Params = { params: Promise<{ id: string }> };

/** Admin: retry a failed job (resets retry counter). */
export async function POST(req: Request, { params }: Params) {
  const user = await requireRole(["admin"]);
  if (!user) return jsonError("Authentication required", 401);
  ensureWorkerStarted();
  const { id } = await params;
  const rows = await db
    .select()
    .from(processingJobs)
    .where(eq(processingJobs.id, id))
    .limit(1);
  const job = rows[0];
  if (!job) return jsonError("Job not found", 404);
  if (job.status !== "failed") return jsonError("Only failed jobs can be retried");

  await db
    .update(processingJobs)
    .set({
      status: "pending",
      retryCount: 0,
      error: null,
      completedAt: null,
      startedAt: null,
    })
    .where(eq(processingJobs.id, id));
  await audit(user, "job.retry", "job", id, { type: job.type }, clientIp(req));
  return NextResponse.json({ ok: true });
}
