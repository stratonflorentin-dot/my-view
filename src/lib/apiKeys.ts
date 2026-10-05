import "server-only";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { apiKeys, apiUsage, plans, projects } from "@/db/schema";
import { clientIp } from "./auth";
import { rateLimit } from "./rate-limit";

/**
 * API key platform. Keys are scoped to ONE project. The secret
 * (mk_secret_…) is shown exactly once at creation and only its SHA-256
 * hash is stored. Public keys (mk_public_…) identify the key.
 */

export const API_SCOPES = [
  "maps:read",
  "maps:write",
  "buildings:read",
  "buildings:write",
  "locations:read",
  "locations:write",
  "models:read",
  "models:write",
  "analytics:read",
] as const;
export type ApiScope = (typeof API_SCOPES)[number];

export type GeneratedKey = {
  publicKey: string;
  secret: string; // shown once
  id: string;
};

export type ApiKeyRow = typeof apiKeys.$inferSelect;

export function generateApiKey(projectId: string, createdBy?: string): GeneratedKey {
  const publicKey = `mk_public_${randomBytes(16).toString("hex")}`;
  const secret = `mk_secret_${randomBytes(24).toString("base64url")}`;
  void projectId;
  void createdBy;
  return { publicKey, secret, id: "" };
}

export function hashSecret(secret: string): string {
  return createHash("sha256").update(secret).digest("hex");
}

/** Extract `Authorization: Bearer mk_…` or `x-api-key` header. */
export function extractKey(req: Request): string | null {
  const auth = req.headers.get("authorization");
  if (auth?.startsWith("Bearer ")) return auth.slice(7).trim();
  return req.headers.get("x-api-key");
}

export type KeyAuth =
  | { ok: true; key: ApiKeyRow; projectId: string }
  | { ok: false; status: number; error: string };

/**
 * Authenticate an API request. Accepts the full secret (server use) or the
 * public key (browser/embed use, validated against allowedOrigins).
 */
export async function authenticateApiKey(
  req: Request,
  requiredScope: ApiScope,
): Promise<KeyAuth> {
  const raw = extractKey(req);
  if (!raw) {
    return { ok: false, status: 401, error: "Missing API key" };
  }

  let row: ApiKeyRow | undefined;
  if (raw.startsWith("mk_secret_")) {
    const hash = hashSecret(raw);
    const rows = await db
      .select()
      .from(apiKeys)
      .where(and(eq(apiKeys.secretHash, hash), eq(apiKeys.status, "active")))
      .limit(1);
    row = rows[0];
  } else if (raw.startsWith("mk_public_")) {
    const rows = await db
      .select()
      .from(apiKeys)
      .where(and(eq(apiKeys.publicKey, raw), eq(apiKeys.status, "active")))
      .limit(1);
    row = rows[0];
    if (row) {
      // Public keys are browser-safe only for read scopes and only from
      // allowed origins (when the restriction list is non-empty).
      if (!requiredScope.endsWith(":read")) {
        return { ok: false, status: 403, error: "Public keys support read scopes only" };
      }
      const origins = row.allowedOrigins ?? [];
      if (origins.length) {
        const origin = req.headers.get("origin") ?? "";
        if (!origins.includes(origin)) {
          return { ok: false, status: 403, error: "Origin not allowed for this key" };
        }
      }
    }
  } else {
    return { ok: false, status: 401, error: "Malformed API key" };
  }

  if (!row) return { ok: false, status: 401, error: "Invalid API key" };
  if (row.expiresAt && row.expiresAt.getTime() < Date.now()) {
    return { ok: false, status: 401, error: "API key expired" };
  }

  const scopes = (row.scopes ?? []) as string[];
  if (!scopes.includes(requiredScope)) {
    return { ok: false, status: 403, error: `Missing required scope: ${requiredScope}` };
  }

  // Optional IP restriction (secret-key server use).
  const ips = (row.allowedIps ?? []) as string[];
  if (ips.length) {
    const ip = clientIp(req);
    if (!ips.includes(ip)) {
      return { ok: false, status: 403, error: "IP not allowed for this key" };
    }
  }

  // Plan rate limit (per key).
  const limitPerMin = row.rateLimitPerMin ?? (await projectRateLimit(row.projectId)) ?? 60;
  const limited = rateLimit(req, "api", limitPerMin);
  if (limited) {
    return { ok: false, status: 429, error: "Rate limit exceeded" };
  }

  await db
    .update(apiKeys)
    .set({ lastUsedAt: new Date() })
    .where(eq(apiKeys.id, row.id))
    .catch(() => {});

  return { ok: true, key: row, projectId: row.projectId };
}

async function projectRateLimit(projectId: string): Promise<number | null> {
  try {
    const rows = await db
      .select({ planId: projects.planId })
      .from(projects)
      .where(eq(projects.id, projectId))
      .limit(1);
    const planId = rows[0]?.planId;
    if (!planId) return null;
    const p = await db
      .select({ rate: plans.rateLimitPerMin })
      .from(plans)
      .where(eq(plans.id, planId))
      .limit(1);
    return p[0]?.rate ?? null;
  } catch {
    return null;
  }
}

/** Record one API call for the usage dashboard. */
export async function recordUsage(
  key: ApiKeyRow,
  req: Request,
  route: string,
  statusCode: number,
  startedAt: number,
) {
  await db
    .insert(apiUsage)
    .values({
      keyId: key.id,
      projectId: key.projectId,
      route: route.slice(0, 160),
      method: req.method.slice(0, 8),
      statusCode,
      latencyMs: Math.max(0, Math.round(performance.now() - startedAt)),
    })
    .catch(() => {});
}

export function constantTimeEquals(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}
