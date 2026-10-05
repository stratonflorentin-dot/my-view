import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { buildings, buildingVersions } from "@/db/schema";
import { requireKey, isResponse, v1Error } from "@/lib/v1";

/**
 * GET /api/v1/models/{modelId} — one reconstruction version with model
 * output URLs (models:read). The version's building must belong to the
 * key's project.
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ modelId: string }> },
) {
  const ctx = await requireKey(req, "models:read");
  if (isResponse(ctx)) return ctx;
  const { modelId } = await params;
  const rows = await db
    .select()
    .from(buildingVersions)
    .where(eq(buildingVersions.id, modelId))
    .limit(1);
  const v = rows[0];
  if (!v) return v1Error("Model not found", 404);

  const bRows = await db
    .select({ projectId: buildings.projectId })
    .from(buildings)
    .where(eq(buildings.id, v.buildingId))
    .limit(1);
  if (!bRows[0] || bRows[0].projectId !== ctx.projectId) {
    return v1Error("Model not found", 404);
  }

  return NextResponse.json({
    data: {
      id: v.id,
      buildingId: v.buildingId,
      version: v.version,
      type: v.type,
      engine: v.engine,
      state: v.state,
      confidence: v.confidence,
      footprint: v.footprint,
      heightM: v.heightM,
      floors: v.floors,
      buildingType: v.buildingType,
      roofType: v.roofType,
      modelUrl: v.modelUrl,
      modelFormat: v.modelFormat,
      textureUrl: v.textureUrl,
      lod: v.lod,
      metrics: v.metrics,
      error: v.error,
      createdAt: v.createdAt,
    },
  });
}
