import { NextResponse } from "next/server";
import { desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { projectMembers, projects } from "@/db/schema";
import { clientIp, requireUser } from "@/lib/auth";
import { audit, jsonError, parseJson } from "@/lib/api";
import { rateLimit } from "@/lib/rate-limit";
import { slugify } from "@/lib/tenancy";

/** GET /api/projects — projects the current user owns or is a member of. */
export async function GET() {
  const user = await requireUser();
  const owned = await db
    .select()
    .from(projects)
    .where(eq(projects.ownerId, user.sub))
    .orderBy(desc(projects.createdAt));
  const memberships = await db
    .select({ projectId: projectMembers.projectId, role: projectMembers.role })
    .from(projectMembers)
    .where(eq(projectMembers.userId, user.sub));
  const memberIds = memberships.map((m) => m.projectId).filter((id) => !owned.some((o) => o.id === id));
  const memberProjects = memberIds.length
    ? await db.select().from(projects).where(inArray(projects.id, memberIds))
    : [];
  return NextResponse.json({
    projects: [
      ...owned.map((p) => ({ ...p, access: "owner" })),
      ...memberProjects.map((p) => ({
        ...p,
        access: memberships.find((m) => m.projectId === p.id)?.role ?? "viewer",
      })),
    ],
  });
}

/** POST /api/projects — create a map project (any authenticated user). */
export async function POST(req: Request) {
  const limited = rateLimit(req, "api");
  if (limited) return limited;
  const user = await requireUser();
  const body = await parseJson<{
    name?: string;
    description?: string;
    visibility?: "private" | "invitation_only" | "shared" | "public" | "api_only";
    centerLat?: number;
    centerLng?: number;
    defaultZoom?: number;
  }>(req);
  if (!body?.name || !body.name.trim()) return jsonError("Project name is required");

  const rows = await db
    .insert(projects)
    .values({
      ownerId: user.sub,
      name: body.name.trim().slice(0, 160),
      slug: slugify(body.name.trim()),
      description: body.description?.slice(0, 2000) ?? null,
      visibility: body.visibility ?? "private",
      centerLat:
        body.centerLat != null && Number.isFinite(body.centerLat) ? body.centerLat : null,
      centerLng:
        body.centerLng != null && Number.isFinite(body.centerLng) ? body.centerLng : null,
      defaultZoom: Math.min(19, Math.max(2, Math.floor(body.defaultZoom ?? 15))),
    })
    .returning();
  const project = rows[0];
  await db
    .insert(projectMembers)
    .values({ projectId: project.id, userId: user.sub, role: "owner" });
  await audit(user, "project.create", "project", project.id, { name: project.name }, clientIp(req));
  return NextResponse.json({ project }, { status: 201 });
}
