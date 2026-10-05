import { NextResponse } from "next/server";
import { and, count, eq, gte, sql } from "drizzle-orm";
import { db } from "@/db";
import { apiKeys, apiUsage } from "@/db/schema";
import { getSession } from "@/lib/auth";
import { audit, jsonError, parseJson } from "@/lib/api";
import { hashSecret } from "@/lib/apiKeys";
import { canManage, projectAccess } from "@/lib/tenancy";
import { randomBytes } from "node:crypto";

type Params = { params: Promise<{ id: string }> };

async function loadKeyWithAccess(keyId: string) {
  const user = await getSession();
  const rows = await db.select().from(apiKeys).where(eq(apiKeys.id, keyId)).limit(1);
  const key = rows[0];
  if (!key) return { error: jsonError("Not found", 404) as NextResponse };
  const { level } = await projectAccess(user, key.projectId);
  if (!level || !canManage(level)) return { error: jsonError("forbidden", 403) as NextResponse };
  return { key };
}

/**
 * POST /api/keys/:id — actions: rename, rotate (new secret, same public
 * id), restrict (origins/ips/rate), expire, revoke. Usage stats returned
 * for ?usage=1.
 */
export async function POST(req: Request, { params }: Params) {
  const { id } = await params;
  const { key, error } = await loadKeyWithAccess(id);
  if (error) return error;
  const body = await parseJson<{
    action?: "rename" | "rotate" | "restrict" | "expire" | "revoke" | "restore";
    name?: string;
    scopes?: string[];
    rateLimitPerMin?: number | null;
    allowedOrigins?: string[];
    allowedIps?: string[];
    expiresInDays?: number | null;
    usage?: boolean;
  }>(req);
  if (!body?.action) return jsonError("action required");

  const patch: Record<string, unknown> = {};
  let rotatedSecret: string | null = null;

  switch (body.action) {
    case "rename":
      if (!body.name) return jsonError("name required");
      patch.name = body.name.slice(0, 120);
      break;
    case "rotate": {
      rotatedSecret = `mk_secret_${randomBytes(24).toString("base64url")}`;
      patch.secretHash = hashSecret(rotatedSecret);
      patch.secretPrefix = rotatedSecret.slice(0, 16);
      break;
    }
    case "restrict":
      if (body.scopes) patch.scopes = body.scopes;
      if (body.rateLimitPerMin != null)
        patch.rateLimitPerMin = Math.max(1, Math.min(6000, body.rateLimitPerMin));
      if (body.allowedOrigins) patch.allowedOrigins = body.allowedOrigins;
      if (body.allowedIps) patch.allowedIps = body.allowedIps;
      break;
    case "expire":
      patch.expiresAt = new Date(Date.now() + (body.expiresInDays ?? 7) * 86400_000);
      break;
    case "revoke":
      patch.status = "revoked";
      patch.revokedAt = new Date();
      break;
    case "restore":
      patch.status = "active";
      patch.revokedAt = null;
      break;
    default:
      return jsonError("Unknown action");
  }

  await db.update(apiKeys).set(patch as never).where(eq(apiKeys.id, id));
  await audit(
    (await getSession()) ?? { sub: "system", role: "system" },
    `apikey.${body.action}`,
    "api_key",
    id,
  );

  let usage = null;
  if (body.usage) {
    usage = await usageStats(id, key.projectId);
  }
  return NextResponse.json({ ok: true, rotatedSecret, usage });
}

export async function GET(_req: Request, { params }: Params) {
  const { id } = await params;
  const { key, error } = await loadKeyWithAccess(id);
  if (error) return error;
  const usage = await usageStats(id, key.projectId);
  return NextResponse.json({ key: { ...key, secretHash: undefined }, usage });
}

async function usageStats(keyId: string, projectId: string) {
  const dayAgo = new Date(Date.now() - 86400_000);
  const monthAgo = new Date(Date.now() - 30 * 86400_000);

  const [today, month, okMonth, failMonth, byRoute] = await Promise.all([
    db.select({ n: count() }).from(apiUsage).where(and(eq(apiUsage.keyId, keyId), gte(apiUsage.createdAt, dayAgo))),
    db.select({ n: count() }).from(apiUsage).where(and(eq(apiUsage.keyId, keyId), gte(apiUsage.createdAt, monthAgo))),
    db
      .select({ n: count() })
      .from(apiUsage)
      .where(and(eq(apiUsage.keyId, keyId), gte(apiUsage.createdAt, monthAgo), sql`${apiUsage.statusCode} < 400`)),
    db
      .select({ n: count() })
      .from(apiUsage)
      .where(and(eq(apiUsage.keyId, keyId), gte(apiUsage.createdAt, monthAgo), sql`${apiUsage.statusCode} >= 400`)),
    db
      .select({ route: apiUsage.route, method: apiUsage.method, n: count() })
      .from(apiUsage)
      .where(and(eq(apiUsage.keyId, keyId), gte(apiUsage.createdAt, monthAgo)))
      .groupBy(apiUsage.route, apiUsage.method)
      .orderBy(sql`count(*) desc`)
      .limit(20),
  ]);

  return {
    keyId,
    projectId,
    requestsToday: Number(today[0]?.n ?? 0),
    requestsThisMonth: Number(month[0]?.n ?? 0),
    successfulThisMonth: Number(okMonth[0]?.n ?? 0),
    failedThisMonth: Number(failMonth[0]?.n ?? 0),
    byRoute: byRoute.map((r) => ({ ...r, n: Number(r.n) })),
  };
}
