import "server-only";
import { createHmac, randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { webhookDeliveries, webhooks } from "@/db/schema";
import { enqueueJob } from "./pipeline/pipeline";

/**
 * Webhooks: project-scoped subscriptions with HMAC-SHA256 signing.
 * Delivery happens through the background job queue (webhook.deliver) with
 * exponential-backoff retries; every attempt is logged in
 * webhook_deliveries.
 */

export const WEBHOOK_EVENTS = [
  "scan.created",
  "scan.completed",
  "building.detected",
  "building.reconstructed",
  "building.approved",
  "location.created",
  "model.updated",
  "submission.approved",
  "submission.rejected",
] as const;
export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];

export function generateWebhookSecret(): string {
  return `whsec_${randomBytes(24).toString("base64url")}`;
}

export function signPayload(secret: string, body: string, timestamp: number): string {
  return createHmac("sha256", secret)
    .update(`${timestamp}.${body}`)
    .digest("hex");
}

/** Fan an event out to all matching active webhooks of a project. */
export async function dispatchEvent(
  projectId: string | null,
  event: WebhookEvent,
  data: Record<string, unknown>,
) {
  if (!projectId) return;
  try {
    const subs = await db
      .select()
      .from(webhooks)
      .where(eq(webhooks.projectId, projectId));
    const matching = subs.filter(
      (w) => w.status === "active" && (w.events ?? []).includes(event),
    );
    for (const w of matching) {
      const payload = {
        id: crypto.randomUUID(),
        event,
        projectId,
        createdAt: new Date().toISOString(),
        data,
      };
      const rows = await db
        .insert(webhookDeliveries)
        .values({ webhookId: w.id, event, payload: payload as never })
        .returning();
      await enqueueJob("webhook.deliver", { deliveryId: rows[0].id }, 3);
    }
  } catch {
    // Webhook dispatch must never break the primary operation.
  }
}

export const RETRY_SCHEDULE_SEC = [10, 60, 300, 1800]; // 4 retries
export const MAX_WEBHOOK_ATTEMPTS = 5;
