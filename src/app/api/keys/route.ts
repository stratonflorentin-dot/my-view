import { NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { apiKeys } from "@/db/schema";
import { getSession } from "@/lib/auth";
import { audit, jsonError, parseJson } from "@/lib/api";
import { API_SCOPES, generateApiKey, hashSecret } from "@/lib/apiKeys";
import { canManage, projectAccess } from "@/lib/tenancy";
import { randomBytes } from "node:crypto";

/** GET /api/keys?projectId=… — list the project's API keys (no secrets). */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const projectId = url.searchParams.get("projectId");
  if (!projectId) return jsonError("projectId required");
  const user = await getSession();
  const { level } = await projectAccess(user, projectId);
  if (!level) return jsonError("forbidden", 403);
  const rows = await db
    .select({
      id: apiKeys.id,
      name: apiKeys.name,
      publicKey: apiKeys.publicKey,
      secretPrefix: apiKeys.secretPrefix,
      scopes: apiKeys.scopes,
      status: apiKeys.status,
      rateLimitPerMin: apiKeys.rateLimitPerMin,
      allowedOrigins: apiKeys.allowedOrigins,
      allowedIps: apiKeys.allowedIps,
      expiresAt: apiKeys.expiresAt,
      lastUsedAt: apiKeys.lastUsedAt,
      revokedAt: apiKeys.revokedAt,
      createdAt: apiKeys.createdAt,
    })
    .from(apiKeys)
    .where(eq(apiKeys.projectId, projectId))
    .orderBy(desc(apiKeys.createdAt));
  return NextResponse.json({ keys: rows, availableScopes: API_SCOPES });
}

/**
 * POST /api/keys — create a key. The raw secret is returned EXACTLY ONCE.
 * Secret keys: mk_secret_… (server-side). Public keys: mk_public_…
 * (browser/embed, read-only).
 */
export async function POST(req: Request) {
  const user = await getSession();
  const body = await parseJson<{
    projectId?: string;
    name?: string;
    scopes?: string[];
    type?: "secret" | "public";
    expiresInDays?: number | null;
    rateLimitPerMin?: number | null;
    allowedOrigins?: string[];
    allowedIps?: string[];
  }>(req);
  if (!body?.projectId || !body.name) return jsonError("projectId and name required");
  const { level } = await projectAccess(user, body.projectId);
  if (!level || !canManage(level)) return jsonError("forbidden", 403);

  const type = body.type === "public" ? "public" : "secret";
  const scopes = (body.scopes ?? ["maps:read", "buildings:read", "locations:read", "models:read"])
    .filter((s) => (API_SCOPES as readonly string[]).includes(s));
  if (!scopes.length) return jsonError("At least one valid scope is required");
  if (type === "public") {
    const bad = scopes.filter((s) => !s.endsWith(":read"));
    if (bad.length) return jsonError(`Public keys support read scopes only: ${bad.join(", ")}`);
  }

  const publicKey = `mk_public_${randomBytes(16).toString("hex")}`;
  const secret = `mk_secret_${randomBytes(24).toString("base64url")}`;

  const rows = await db
    .insert(apiKeys)
    .values({
      projectId: body.projectId,
      name: body.name.slice(0, 120),
      publicKey,
      secretHash: hashSecret(secret),
      secretPrefix: secret.slice(0, 16),
      scopes,
      rateLimitPerMin:
        body.rateLimitPerMin != null ? Math.max(1, Math.min(6000, body.rateLimitPerMin)) : null,
      allowedOrigins: body.allowedOrigins ?? [],
      allowedIps: body.allowedIps ?? [],
      expiresAt:
        body.expiresInDays != null
          ? new Date(Date.now() + body.expiresInDays * 86400_000)
          : null,
      createdBy: user?.sub,
    })
    .returning();

  await audit(user ?? { sub: "system", role: "system" }, "apikey.create", "api_key", rows[0].id, {
    scopes,
    type,
  });

  return NextResponse.json(
    {
      key: { ...rows[0], secretHash: undefined },
      // Only response that ever contains the raw secret:
      secret: type === "secret" ? secret : null,
      publicKey,
    },
    { status: 201 },
  );
}
