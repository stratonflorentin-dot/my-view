import { NextResponse } from "next/server";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { buildings, contributorLinks, mapObjects, projectMembers, projects, submissions } from "@/db/schema";
import { clientIp, requireUser } from "@/lib/auth";
import { audit, jsonError, parseJson } from "@/lib/api";
import { canManage, requireProject } from "@/lib/tenancy";

type Params = { params: Promise<{ id: string }> };

/** GET /api/projects/:id — project detail + summary counts. */
export async function GET(_req: Request, { params }: Params) {
  const user = await requireUser();
  const { id } = await params;
  const { project, level } = await requireProject(user, id, "viewer");

  const [buildingCount, objectCount, pendingCount, memberRows] = await Promise.all([
    db.select({ id: buildings.id }).from(buildings).where(eq(buildings.projectId, id)),
    db.select({ id: mapObjects.id }).from(mapObjects).where(eq(mapObjects.projectId, id)),
    db
      .select({ id: submissions.id })
      .from(submissions)
      .where(and(eq(submissions.projectId, id), eq(submissions.status, "pending"))),
    db
      .select()
      .from(projectMembers)
      .where(eq(projectMembers.projectId, id))
      .orderBy(desc(projectMembers.createdAt)),
  ]);

  return NextResponse.json({
    project,
    access: level,
    stats: {
      buildings: buildingCount.length,
      objects: objectCount.length,
      pendingSubmissions: pendingCount.length,
      members: memberRows.length,
    },
    members: memberRows.map((m) => ({
      userId: m.userId,
      role: m.role,
      createdAt: m.createdAt,
    })),
  });
}

/** PATCH /api/projects/:id — update settings (owner/editor only). */
export async function PATCH(req: Request, { params }: Params) {
  const user = await requireUser();
  const { id } = await params;
  const { project, level } = await requireProject(user, id, "viewer");
  if (!canManage(level)) return jsonError("Only project owners and editors can update", 403);

  const body = await parseJson<{
    name?: string;
    description?: string;
    visibility?: "private" | "invitation_only" | "shared" | "public" | "api_only";
    centerLat?: number;
    centerLng?: number;
    defaultZoom?: number;
  }>(req);
  if (!body) return jsonError("Invalid JSON");

  const patch: Record<string, unknown> = { updatedAt: new Date() };
  if (body.name?.trim()) patch.name = body.name.trim().slice(0, 160);
  if (body.description != null) patch.description = body.description.slice(0, 2000);
  if (body.visibility) patch.visibility = body.visibility;
  if (body.centerLat != null && Number.isFinite(body.centerLat)) patch.centerLat = body.centerLat;
  if (body.centerLng != null && Number.isFinite(body.centerLng)) patch.centerLng = body.centerLng;
  if (body.defaultZoom != null) patch.defaultZoom = Math.min(19, Math.max(2, Math.floor(body.defaultZoom)));

  const rows = await db
    .update(projects)
    .set(patch as never)
    .where(eq(projects.id, project.id))
    .returning();
  await audit(user, "project.update", "project", project.id, patch, clientIp(req));
  return NextResponse.json({ project: rows[0] });
}

/** DELETE /api/projects/:id — archive (owner only; nothing is destroyed). */
export async function DELETE(req: Request, { params }: Params) {
  const user = await requireUser();
  const { id } = await params;
  const { project } = await requireProject(user, id, "viewer");
  if (project.ownerId !== user.sub && user.role !== "admin") {
    return jsonError("Only the project owner can archive a project", 403);
  }
  await db
    .update(projects)
    .set({ archivedAt: new Date() })
    .where(eq(projects.id, project.id));
  await audit(user, "project.archive", "project", project.id, {}, clientIp(req));
  return NextResponse.json({ ok: true, archived: true });
}

/** PUT /api/projects/:id — add a member (owner/editor only). */
export async function PUT(req: Request, { params }: Params) {
  const user = await requireUser();
  const { id } = await params;
  const { level } = await requireProject(user, id, "viewer");
  if (!canManage(level)) return jsonError("Only owners and editors can add members", 403);
  const body = await parseJson<{ userId?: string; role?: "editor" | "contributor" | "viewer" }>(req);
  if (!body?.userId) return jsonError("userId required");
  const rows = await db
    .insert(projectMembers)
    .values({
      projectId: id,
      userId: body.userId,
      role: body.role ?? "contributor",
      invitedBy: user.sub,
    })
    .onConflictDoUpdate({
      target: [projectMembers.projectId, projectMembers.userId],
      set: { role: body.role ?? "contributor" },
    })
    .returning();
  await audit(user, "project.member.upsert", "project", id, { userId: body.userId }, clientIp(req));
  return NextResponse.json({ member: rows[0] }, { status: 201 });
}
