import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { buildingVersions } from "@/db/schema";
import { requireKey, isResponse, v1Error, loadScopedBuilding } from "@/lib/v1";

/** GET /api/v1/buildings/{buildingId} — single building (buildings:read). */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ buildingId: string }> },
) {
  const ctx = await requireKey(req, "buildings:read");
  if (isResponse(ctx)) return ctx;
  const { buildingId } = await params;
  const b = await loadScopedBuilding(buildingId, ctx.projectId);
  if (!b) return v1Error("Building not found", 404);

  const versions = await db
    .select()
    .from(buildingVersions)
    .where(eq(buildingVersions.buildingId, b.id));
  const active = versions.find((v) => v.version === b.currentVersion) ?? null;

  return NextResponse.json({
    data: {
      id: b.id,
      name: b.name,
      status: b.status,
      verification: b.verification,
      center: { lat: b.centerLat, lng: b.centerLng },
      altitude: b.altitude,
      currentVersion: b.currentVersion,
      reconstruction: active
        ? {
            version: active.version,
            type: active.type,
            engine: active.engine,
            state: active.state,
            confidence: active.confidence,
            footprint: active.footprint,
            heightM: active.heightM,
            floors: active.floors,
            buildingType: active.buildingType,
            roofType: active.roofType,
            modelUrl: active.modelUrl,
            modelFormat: active.modelFormat,
            textureUrl: active.textureUrl,
            metrics: active.metrics,
          }
        : null,
      versions: versions.map((v) => ({ version: v.version, type: v.type, confidence: v.confidence, state: v.state })),
      createdAt: b.createdAt,
      updatedAt: b.updatedAt,
    },
  });
}
