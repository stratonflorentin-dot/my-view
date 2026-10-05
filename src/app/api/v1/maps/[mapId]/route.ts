import { NextResponse } from "next/server";
import { requireKey, isResponse, v1Error, assertProject, loadScopedProject } from "@/lib/v1";

/** GET /api/v1/maps/{mapId} — single map detail (maps:read). */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ mapId: string }> },
) {
  const ctx = await requireKey(req, "maps:read");
  if (isResponse(ctx)) return ctx;
  const { mapId } = await params;
  const denied = assertProject(ctx, mapId);
  if (denied) return denied;
  const project = await loadScopedProject(mapId);
  if (!project) return v1Error("Map not found", 404);
  return NextResponse.json({
    data: {
      id: project.id,
      name: project.name,
      slug: project.slug,
      description: project.description,
      visibility: project.visibility,
      center:
        project.centerLat != null && project.centerLng != null
          ? { lat: project.centerLat, lng: project.centerLng }
          : null,
      defaultZoom: project.defaultZoom,
      createdAt: project.createdAt,
      updatedAt: project.updatedAt,
    },
  });
}
