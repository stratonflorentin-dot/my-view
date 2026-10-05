import { NextResponse } from "next/server";
import { and, eq, inArray, ne } from "drizzle-orm";
import { db } from "@/db";
import { buildings, buildingVersions } from "@/db/schema";
import { requireKey, isResponse, v1Error, assertProject } from "@/lib/v1";

/**
 * GET /api/v1/maps/{mapId}/buildings — real building rows with the active
 * reconstruction version (buildings:read).
 * GET /api/v1/buildings/{buildingId} — single building (buildings:read).
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ mapId: string }> },
) {
  const ctx = await requireKey(req, "buildings:read");
  if (isResponse(ctx)) return ctx;
  const { mapId } = await params;
  const denied = assertProject(ctx, mapId);
  if (denied) return denied;

  const rows = await db
    .select()
    .from(buildings)
    .where(and(eq(buildings.projectId, mapId), ne(buildings.status, "rejected")))
    .limit(1000);
  const versions = rows.length
    ? await db
        .select()
        .from(buildingVersions)
        .where(inArray(buildingVersions.buildingId, rows.map((b) => b.id)))
    : [];
  const active = new Map<string, typeof buildingVersions.$inferSelect>();
  for (const v of versions) {
    const b = rows.find((x) => x.id === v.buildingId);
    if (b && b.currentVersion === v.version) active.set(b.id, v);
  }

  return NextResponse.json({
    data: rows.map((b) => {
      const v = active.get(b.id);
      return {
        id: b.id,
        name: b.name,
        status: b.status,
        verification: b.verification,
        center: { lat: b.centerLat, lng: b.centerLng },
        currentVersion: b.currentVersion,
        reconstruction: v
          ? {
              version: v.version,
              type: v.type,
              engine: v.engine,
              state: v.state,
              confidence: v.confidence,
              footprint: v.footprint,
              heightM: v.heightM,
              floors: v.floors,
              buildingType: v.buildingType,
              modelUrl: v.modelUrl,
              modelFormat: v.modelFormat,
            }
          : null,
        createdAt: b.createdAt,
        updatedAt: b.updatedAt,
      };
    }),
    meta: { count: rows.length },
  });
}
