import { NextResponse } from "next/server";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { mapObjects } from "@/db/schema";
import { getSession } from "@/lib/auth";
import { audit, jsonError, parseJson } from "@/lib/api";
import { canWrite, projectAccess } from "@/lib/tenancy";

/**
 * Generic map object system: buildings, locations, roads, landmarks,
 * businesses, properties, warehouses, infrastructure, POIs.
 * Geometry is GeoJSON (Point / LineString / Polygon).
 */

const OBJECT_TYPES = [
  "building", "location", "road", "landmark", "business", "property",
  "warehouse", "infrastructure", "construction", "poi", "area", "model",
];

export async function GET(req: Request) {
  const url = new URL(req.url);
  const projectId = url.searchParams.get("projectId");
  if (!projectId) return jsonError("projectId required");
  const user = await getSession();
  const { project, level } = await projectAccess(user, projectId);
  if (!project || (!level && project.visibility !== "public" && project.visibility !== "shared")) {
    return jsonError("forbidden", 403);
  }

  const type = url.searchParams.get("type");
  const where = type
    ? and(eq(mapObjects.projectId, projectId), eq(mapObjects.type, type as never))
    : eq(mapObjects.projectId, projectId);
  const rows = await db
    .select()
    .from(mapObjects)
    .where(where)
    .orderBy(mapObjects.createdAt)
    .limit(2000);
  return NextResponse.json({ objects: rows });
}

export async function POST(req: Request) {
  const user = await getSession();
  const body = await parseJson<{
    projectId?: string;
    type?: string;
    name?: string;
    description?: string;
    geometry?: unknown;
    properties?: Record<string, unknown>;
    images?: string[];
    lat?: number;
    lng?: number;
  }>(req);
  if (!body?.projectId || !body.name) return jsonError("projectId and name required");

  const { level } = await projectAccess(user, body.projectId);
  if (!level || !canWrite(level)) return jsonError("forbidden", 403);

  let geometry = body.geometry;
  if (!geometry && Number.isFinite(body.lat) && Number.isFinite(body.lng)) {
    geometry = { type: "Point", coordinates: [body.lng, body.lat] };
  }
  if (
    !geometry ||
    typeof geometry !== "object" ||
    !["Point", "LineString", "Polygon"].includes((geometry as { type?: string }).type ?? "")
  ) {
    return jsonError("geometry must be GeoJSON Point, LineString or Polygon (or provide lat/lng)");
  }
  const type = body.type && OBJECT_TYPES.includes(body.type) ? body.type : "location";

  const rows = await db
    .insert(mapObjects)
    .values({
      projectId: body.projectId,
      type: type as never,
      name: body.name.slice(0, 200),
      description: body.description?.slice(0, 4000) ?? null,
      geometry: geometry as never,
      properties: body.properties ?? {},
      images: body.images ?? [],
      createdBy: user?.sub,
    })
    .returning();
  await audit(user ?? { sub: "system", role: "system" }, "object.create", "map_object", rows[0].id, { type });
  return NextResponse.json({ object: rows[0] }, { status: 201 });
}

/** DELETE /api/objects?id=… — archive an object (nothing is destroyed). */
export async function DELETE(req: Request) {
  const user = await getSession();
  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  if (!id) return jsonError("id required");
  const rows = await db.select().from(mapObjects).where(eq(mapObjects.id, id)).limit(1);
  const obj = rows[0];
  if (!obj) return jsonError("Not found", 404);
  const { level } = await projectAccess(user, obj.projectId);
  if (!level || !canWrite(level)) return jsonError("forbidden", 403);
  await db
    .update(mapObjects)
    .set({ status: "archived", updatedAt: new Date() })
    .where(eq(mapObjects.id, id));
  await audit(user ?? { sub: "system", role: "system" }, "object.archive", "map_object", id);
  return NextResponse.json({ ok: true });
}

/** PATCH /api/objects?id=… — update fields. */
export async function PATCH(req: Request) {
  const user = await getSession();
  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  if (!id) return jsonError("id required");
  const rows = await db.select().from(mapObjects).where(eq(mapObjects.id, id)).limit(1);
  const obj = rows[0];
  if (!obj) return jsonError("Not found", 404);
  const { level } = await projectAccess(user, obj.projectId);
  if (!level || !canWrite(level)) return jsonError("forbidden", 403);

  const body = await parseJson<{
    name?: string;
    description?: string;
    geometry?: unknown;
    properties?: Record<string, unknown>;
    type?: string;
  }>(req);
  if (!body) return jsonError("Invalid JSON");
  const patch: Record<string, unknown> = { updatedAt: new Date() };
  if (body.name) patch.name = body.name.slice(0, 200);
  if (body.description != null) patch.description = body.description.slice(0, 4000);
  if (body.geometry) patch.geometry = body.geometry;
  if (body.properties) patch.properties = { ...(obj.properties ?? {}), ...body.properties };
  if (body.type && OBJECT_TYPES.includes(body.type)) patch.type = body.type;
  await db.update(mapObjects).set(patch as never).where(eq(mapObjects.id, id));
  return NextResponse.json({ ok: true });
}
