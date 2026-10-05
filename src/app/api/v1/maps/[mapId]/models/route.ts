import { NextResponse } from "next/server";
import { eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { buildings, buildingVersions } from "@/db/schema";
import { requireKey, isResponse, v1Error, assertProject } from "@/lib/v1";

/**
 * GET /api/v1/maps/{mapId}/models — 3D model versions available for the
 * map's buildings (models:read). GLB/glTF outputs when a reconstruction
 * engine produced them; estimation-only buildings are marked ESTIMATED.
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ mapId: string }> },
) {
  const ctx = await requireKey(req, "models:read");
  if (isResponse(ctx)) return ctx;
  const { mapId } = await params;
  const denied = assertProject(ctx, mapId);
  if (denied) return denied;

  const bs = await db.select({ id: buildings.id }).from(buildings).where(eq(buildings.projectId, mapId));
  if (!bs.length) return NextResponse.json({ data: [], meta: { count: 0 } });
  const versions = await db
    .select()
    .from(buildingVersions)
    .where(inArray(buildingVersions.buildingId, bs.map((b) => b.id)));

  return NextResponse.json({
    data: versions.map((v) => ({
      id: v.id,
      buildingId: v.buildingId,
      version: v.version,
      type: v.type,
      engine: v.engine,
      state: v.state,
      confidence: v.confidence,
      heightM: v.heightM,
      floors: v.floors,
      buildingType: v.buildingType,
      footprint: v.footprint,
      modelUrl: v.modelUrl,
      modelFormat: v.modelFormat,
      textureUrl: v.textureUrl,
      lod: v.lod,
      metrics: v.metrics,
      createdAt: v.createdAt,
    })),
    meta: { count: versions.length },
  });
}
