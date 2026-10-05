import "server-only";
import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { buildings, projects } from "@/db/schema";
import { authenticateApiKey, recordUsage, type ApiKeyRow, type ApiScope } from "./apiKeys";

/**
 * Shared plumbing for the public /api/v1 routes: key authentication,
 * scope enforcement, project isolation, usage recording.
 */

export type V1Context = {
  key: ApiKeyRow;
  projectId: string;
  startedAt: number;
};

export async function requireKey(
  req: Request,
  scope: ApiScope,
): Promise<V1Context | NextResponse> {
  const startedAt = performance.now();
  const auth = await authenticateApiKey(req, scope);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  await recordUsage(auth.key, req, new URL(req.url).pathname, 200, startedAt);
  return { key: auth.key, startedAt, projectId: auth.projectId };
}

export function isResponse(x: unknown): x is NextResponse {
  return x instanceof NextResponse;
}

export function v1Error(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

/** Ensure the key's project matches the requested map (tenant isolation). */
export function assertProject(ctx: V1Context, mapId: string): NextResponse | null {
  if (ctx.projectId !== mapId) {
    return NextResponse.json(
      { error: "This API key does not have access to the requested map" },
      { status: 403 },
    );
  }
  return null;
}

/** Load a building and verify it belongs to the key's project. */
export async function loadScopedBuilding(buildingId: string, projectId: string) {
  const rows = await db
    .select()
    .from(buildings)
    .where(and(eq(buildings.id, buildingId), eq(buildings.projectId, projectId)))
    .limit(1);
  return rows[0] ?? null;
}

export async function loadScopedProject(projectId: string) {
  const rows = await db.select().from(projects).where(eq(projects.id, projectId)).limit(1);
  return rows[0] ?? null;
}
