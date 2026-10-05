import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { mapObjects } from "@/db/schema";
import { requireKey, isResponse, v1Error, assertProject } from "@/lib/v1";

/**
 * GET /api/v1/maps/{mapId}/locations — generic map objects (points, lines,
 * polygons: locations, roads, landmarks, businesses, POIs, …).
 * Query: ?type=landmark&status=published
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ mapId: string }> },
) {
  const ctx = await requireKey(req, "locations:read");
  if (isResponse(ctx)) return ctx;
  const { mapId } = await params;
  const denied = assertProject(ctx, mapId);
  if (denied) return denied;

  const url = new URL(req.url);
  const type = url.searchParams.get("type");
  const status = url.searchParams.get("status") ?? "published";

  const rows = await db.select().from(mapObjects).where(eq(mapObjects.projectId, mapId));
  const filtered = rows.filter(
    (o) =>
      (!type || o.type === type) &&
      (!status || o.status === status),
  );
  // GeoJSON FeatureCollection for direct consumption by map clients.
  return NextResponse.json({
    data: filtered.map((o) => ({
      id: o.id,
      type: o.type,
      name: o.name,
      description: o.description,
      geometry: o.geometry,
      properties: o.properties,
      images: o.images,
      buildingId: o.buildingId,
      confidence: o.confidence,
      verification: o.verification,
      status: o.status,
      createdAt: o.createdAt,
      updatedAt: o.updatedAt,
    })),
    meta: { count: filtered.length },
  });
}
