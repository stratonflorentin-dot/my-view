import "server-only";
import { after } from "next/server";
import { and, asc, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { processingJobs, webhookDeliveries, webhooks } from "@/db/schema";
import {
  handleCaptureProcess,
  handlePublish,
  handleReconstruct,
  handleVideoProcess,
  logJob,
  type JobRow,
} from "./pipeline";
import { MAX_WEBHOOK_ATTEMPTS, RETRY_SCHEDULE_SEC, signPayload } from "../webhooks";

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

/**
 * Serverless kick: run one worker tick after the current response finishes.
 * On long-lived processes the interval already covers this; on Vercel
 * (frozen between requests) this is the only thing that drains the queue.
 */
export function kickWorker() {
  try {
    // after() throws outside a request scope — e.g. when called from the
    // worker's own reschedule loop — which we silently ignore.
    void after(async () => {
      await tick();
    });
  } catch {
    /* not in a request scope */
  }
}

const HANDLERS: Record<string, (job: JobRow) => Promise<void>> = {
  "capture.process": handleCaptureProcess,
  "building.reconstruct": handleReconstruct,
  "building.publish": handlePublish,
  "video.process": handleVideoProcess,
  "webhook.deliver": handleWebhookDeliver,
  "model.optimize": () =>
    Promise.reject(
      new Error("Model optimization requires a configured reconstruction service"),
    ),
};

/**
 * Deliver a signed webhook. Signed with HMAC-SHA256 over
 * `{timestamp}.{body}` (X-MyMap-Timestamp / X-MyMap-Signature headers).
 * Retries on exponential backoff via the job queue.
 */
async function handleWebhookDeliver(job: JobRow): Promise<void> {
  const ref = (job.inputRef ?? {}) as Record<string, unknown>;
  const deliveryId = String(ref.deliveryId ?? "");
  const dRows = await db
    .select()
    .from(webhookDeliveries)
    .where(eq(webhookDeliveries.id, deliveryId))
    .limit(1);
  const delivery = dRows[0];
  if (!delivery || delivery.status === "delivered") return;

  const wRows = await db
    .select()
    .from(webhooks)
    .where(eq(webhooks.id, delivery.webhookId))
    .limit(1);
  const hook = wRows[0];
  if (!hook || hook.status !== "active") {
    await db
      .update(webhookDeliveries)
      .set({ status: "abandoned", error: "webhook disabled or removed" })
      .where(eq(webhookDeliveries.id, deliveryId));
    return;
  }

  const body = JSON.stringify(delivery.payload);
  const timestamp = Math.floor(Date.now() / 1000);
  const attempt = delivery.attempts + 1;
  let responseStatus: number | null = null;
  let error: string | null = null;

  try {
    const res = await fetch(hook.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-MyMap-Event": delivery.event,
        "X-MyMap-Timestamp": String(timestamp),
        "X-MyMap-Signature": signPayload(hook.secret, body, timestamp),
      },
      body,
      signal: AbortSignal.timeout(15_000),
    });
    responseStatus = res.status;
    if (!res.ok) error = `HTTP ${res.status}`;
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }

  if (!error) {
    await db
      .update(webhookDeliveries)
      .set({
        status: "delivered",
        attempts: attempt,
        responseStatus,
        deliveredAt: new Date(),
        error: null,
      })
      .where(eq(webhookDeliveries.id, deliveryId));
    logJob(job.id, `webhook ${delivery.event} delivered (HTTP ${responseStatus})`);
    return;
  }

  if (attempt >= MAX_WEBHOOK_ATTEMPTS) {
    await db
      .update(webhookDeliveries)
      .set({ status: "failed", attempts: attempt, responseStatus, error })
      .where(eq(webhookDeliveries.id, deliveryId));
    logJob(job.id, `webhook permanently failed: ${error}`);
    throw new Error(`Webhook delivery failed permanently: ${error}`);
  }

  const delaySec = RETRY_SCHEDULE_SEC[Math.min(attempt - 1, RETRY_SCHEDULE_SEC.length - 1)];
  await db
    .update(webhookDeliveries)
    .set({
      status: "retrying",
      attempts: attempt,
      responseStatus,
      error,
      nextAttemptAt: new Date(Date.now() + delaySec * 1000),
    })
    .where(eq(webhookDeliveries.id, deliveryId));
  logJob(job.id, `webhook attempt ${attempt} failed (${error}); retry in ${delaySec}s`);
}

/** Re-enqueue webhook deliveries whose backoff window has elapsed. */
async function rescheduleDueWebhooks() {
  try {
    const due = await db
      .select({ id: webhookDeliveries.id })
      .from(webhookDeliveries)
      .where(and(eq(webhookDeliveries.status, "retrying")))
      .limit(10);
    for (const d of due) {
      const rows = await db
        .select()
        .from(webhookDeliveries)
        .where(eq(webhookDeliveries.id, d.id))
        .limit(1);
      const next = rows[0]?.nextAttemptAt;
      if (next && next.getTime() <= Date.now()) {
        await db
          .update(webhookDeliveries)
          .set({ status: "pending" })
          .where(eq(webhookDeliveries.id, d.id));
        const { enqueueJob } = await import("./pipeline");
        await enqueueJob("webhook.deliver", { deliveryId: d.id }, 3);
      }
    }
  } catch {
    // Never crash the worker loop.
  }
}

async function tick() {
  if (running) return;
  running = true;
  try {
    void rescheduleDueWebhooks();
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
