import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { mapObjects } from "@/db/schema";
import { requireKey, isResponse, v1Error } from "@/lib/v1";

/**
 * GET /api/v1/locations/{locationId} — single generic map object
 * (locations:read). Tenant-scoped: the object must belong to the key's
 * project.
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ locationId: string }> },
) {
  const ctx = await requireKey(req, "locations:read");
  if (isResponse(ctx)) return ctx;
  const { locationId } = await params;
  const rows = await db
    .select()
    .from(mapObjects)
    .where(and(eq(mapObjects.id, locationId), eq(mapObjects.projectId, ctx.projectId)))
    .limit(1);
  const o = rows[0];
  if (!o) return v1Error("Location not found", 404);
  return NextResponse.json({
    data: {
      id: o.id,
      type: o.type,
      name: o.name,
      description: o.description,
      geometry: o.geometry,
      properties: o.properties,
      images: o.images,
      buildingId: o.buildingId,
      sourceSubmissionId: o.sourceSubmissionId,
      confidence: o.confidence,
      verification: o.verification,
      status: o.status,
      createdAt: o.createdAt,
      updatedAt: o.updatedAt,
    },
  });
}
