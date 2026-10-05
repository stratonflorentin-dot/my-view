import { NextResponse } from "next/server";
import { desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { webhookDeliveries, webhooks } from "@/db/schema";
import { getSession } from "@/lib/auth";
import { audit, jsonError, parseJson } from "@/lib/api";
import { canManage, projectAccess } from "@/lib/tenancy";
import { generateWebhookSecret, WEBHOOK_EVENTS } from "@/lib/webhooks";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const projectId = url.searchParams.get("projectId");
  if (!projectId) return jsonError("projectId required");
  const user = await getSession();
  const { level } = await projectAccess(user, projectId);
  if (!level || !canManage(level)) return jsonError("forbidden", 403);

  const hooks = await db
    .select()
    .from(webhooks)
    .where(eq(webhooks.projectId, projectId))
    .orderBy(desc(webhooks.createdAt));

  const deliveries = hooks.length
    ? await db
        .select()
        .from(webhookDeliveries)
        .where(inArray(webhookDeliveries.webhookId, hooks.map((h) => h.id)))
        .orderBy(desc(webhookDeliveries.createdAt))
        .limit(100)
    : [];

  return NextResponse.json({
    webhooks: hooks.map((h) => ({ ...h, secret: `${h.secret.slice(0, 10)}…` })),
    deliveries,
    events: WEBHOOK_EVENTS,
  });
}

export async function POST(req: Request) {
  const user = await getSession();
  const body = await parseJson<{
    projectId?: string;
    url?: string;
    events?: string[];
  }>(req);
  if (!body?.projectId || !body.url) return jsonError("projectId and url required");
  let parsed: URL;
  try {
    parsed = new URL(body.url);
  } catch {
    return jsonError("url must be a valid absolute URL");
  }
  if (!["http:", "https:"].includes(parsed.protocol)) return jsonError("url must be http(s)");
  const { level } = await projectAccess(user, body.projectId);
  if (!level || !canManage(level)) return jsonError("forbidden", 403);

  const events = (body.events ?? [...WEBHOOK_EVENTS]).filter((e) =>
    (WEBHOOK_EVENTS as readonly string[]).includes(e),
  );
  const secret = generateWebhookSecret();
  const rows = await db
    .insert(webhooks)
    .values({
      projectId: body.projectId,
      url: body.url,
      secret,
      events,
      createdBy: user?.sub,
    })
    .returning();
  await audit(user ?? { sub: "system", role: "system" }, "webhook.create", "webhook", rows[0].id);
  // The signing secret is shown once at creation.
  return NextResponse.json({ webhook: { ...rows[0], secret: undefined }, secret }, { status: 201 });
}

export async function PATCH(req: Request) {
  const user = await getSession();
  const body = await parseJson<{ id?: string; action?: "disable" | "enable" | "rotate" }>(req);
  if (!body?.id) return jsonError("id required");
  const rows = await db.select().from(webhooks).where(eq(webhooks.id, body.id)).limit(1);
  if (!rows[0]) return jsonError("Not found", 404);
  const { level } = await projectAccess(user, rows[0].projectId);
  if (!level || !canManage(level)) return jsonError("forbidden", 403);

  const patch: Record<string, unknown> = {};
  let secret: string | null = null;
  if (body.action === "disable") patch.status = "disabled";
  else if (body.action === "enable") patch.status = "active";
  else if (body.action === "rotate") {
    secret = generateWebhookSecret();
    patch.secret = secret;
  } else return jsonError("Unknown action");
  await db.update(webhooks).set(patch as never).where(eq(webhooks.id, body.id));
  return NextResponse.json({ ok: true, secret });
}

export async function DELETE(req: Request) {
  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  if (!id) return jsonError("id required");
  const user = await getSession();
  const rows = await db.select().from(webhooks).where(eq(webhooks.id, id)).limit(1);
  if (!rows[0]) return jsonError("Not found", 404);
  const { level } = await projectAccess(user, rows[0].projectId);
  if (!level || !canManage(level)) return jsonError("forbidden", 403);
  await db.delete(webhooks).where(eq(webhooks.id, id));
  await audit(user ?? { sub: "system", role: "system" }, "webhook.delete", "webhook", id);
  return NextResponse.json({ ok: true });
}
