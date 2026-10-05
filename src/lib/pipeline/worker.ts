import "server-only";
import { and, asc, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { processingJobs } from "@/db/schema";
import {
  handleCaptureProcess,
  handlePublish,
  handleReconstruct,
  handleVideoProcess,
  logJob,
  type JobRow,
} from "./pipeline";

/**
 * In-process background worker over the Postgres job queue.
 *
 * Single-node by design; for multi-node deployments, front the queue with
 * a claim-token (UPDATE ... FOR UPDATE SKIP LOCKED) worker — the schema
 * already supports it.
 */
let started = false;
let running = false;

export function ensureWorkerStarted() {
  if (started || process.env.NODE_ENV === "test") return;
  started = true;
  const iv = setInterval(() => {
    void tick();
  }, 2500);
  iv.unref?.();
}

const HANDLERS: Record<string, (job: JobRow) => Promise<void>> = {
  "capture.process": handleCaptureProcess,
  "building.reconstruct": handleReconstruct,
  "building.publish": handlePublish,
  "video.process": handleVideoProcess,
  "model.optimize": () =>
    Promise.reject(
      new Error("Model optimization requires a configured reconstruction service"),
    ),
};

async function tick() {
  if (running) return;
  running = true;
  try {
    const jobs = await db
      .select()
      .from(processingJobs)
      .where(eq(processingJobs.status, "pending"))
      .orderBy(desc(processingJobs.priority), asc(processingJobs.createdAt))
      .limit(1);
    const job = jobs[0];
    if (!job) return;

    // Claim (single worker; status transition guards against double-runs).
    await db
      .update(processingJobs)
      .set({ status: "running", startedAt: new Date() })
      .where(and(eq(processingJobs.id, job.id), eq(processingJobs.status, "pending")));

    logJob(job.id, `started ${job.type}`);
    try {
      await HANDLERS[job.type]?.(job) ?? (async () => {})();
      await db
        .update(processingJobs)
        .set({ status: "completed", completedAt: new Date() })
        .where(eq(processingJobs.id, job.id));
      logJob(job.id, "completed");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const retryable = job.retryCount < job.maxRetries;
      await db
        .update(processingJobs)
        .set({
          status: retryable ? "pending" : "failed",
          error: msg,
          retryCount: job.retryCount + 1,
          completedAt: retryable ? null : new Date(),
        })
        .where(eq(processingJobs.id, job.id));
      logJob(job.id, retryable ? `retryable error: ${msg}` : `failed: ${msg}`);
    }
  } catch {
    // Never let the timer crash the process.
  } finally {
    running = false;
  }
}
