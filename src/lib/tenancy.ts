import "server-only";
import { and, eq, or } from "drizzle-orm";
import { db } from "@/db";
import { projectMembers, projects } from "@/db/schema";
import type { SessionUser } from "./auth";

export type ProjectRow = typeof projects.$inferSelect;
export type AccessLevel = "owner" | "editor" | "contributor" | "viewer" | null;

export class ForbiddenError extends Error {
  status = 403;
}
export class NotFoundError extends Error {
  status = 404;
}

const rank: Record<string, number> = {
  viewer: 0,
  contributor: 1,
  editor: 2,
  owner: 3,
};

export function canWrite(level: Exclude<AccessLevel, null>): boolean {
  return rank[level] >= rank.editor;
}

export function canManage(level: Exclude<AccessLevel, null>): boolean {
  return level === "owner" || level === "editor";
}

/** Resolve the current user's access level on a project. */
export async function projectAccess(
  user: SessionUser | null,
  projectId: string,
): Promise<{ project: ProjectRow; level: AccessLevel }> {
  const rows = await db
    .select()
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);
  const project = rows[0];
  if (!project) throw new NotFoundError("Project not found");

  let level: AccessLevel = null;
  if (user) {
    if (project.ownerId === user.sub || user.role === "admin") {
      level = "owner";
    } else {
      const m = await db
        .select()
        .from(projectMembers)
        .where(
          and(
            eq(projectMembers.projectId, projectId),
            eq(projectMembers.userId, user.sub),
          ),
        )
        .limit(1);
      if (m[0]) level = m[0].role;
    }
  }
  return { project, level };
}

/** Require an authenticated user with at least the given level. */
export async function requireProject(
  user: SessionUser | null,
  projectId: string,
  min: "viewer" | "contributor" | "editor" | "owner",
): Promise<{ project: ProjectRow; level: Exclude<AccessLevel, null> }> {
  const { project, level } = await projectAccess(user, projectId);
  if (!level || rank[level] < rank[min]) throw new ForbiddenError("forbidden");
  return { project, level: level as Exclude<AccessLevel, null> };
}

/** Projects visible to a user: owned, member of, or (public/shared) to all. */
export async function visibleProjectIds(userId: string | null): Promise<string[] | "all"> {
  if (!userId) {
    const pub = await db
      .select({ id: projects.id })
      .from(projects)
      .where(or(eq(projects.visibility, "public"), eq(projects.visibility, "shared")));
    return pub.map((p) => p.id);
  }
  const owned = await db
    .select({ id: projects.id })
    .from(projects)
    .where(eq(projects.ownerId, userId));
  const member = await db
    .select({ id: projectMembers.projectId })
    .from(projectMembers)
    .where(eq(projectMembers.userId, userId));
  return [...new Set([...owned, ...member].map((r) => r.id))];
}

export function slugify(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return `${base || "map"}-${Math.random().toString(36).slice(2, 7)}`;
}
