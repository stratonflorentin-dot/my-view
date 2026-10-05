import { NextResponse } from "next/server";
import { count, desc, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  auditLogs,
  buildings,
  buildingVersions,
  captureSessions,
  captures,
  contributorLinks,
  processingJobs,
  users,
} from "@/db/schema";
import { requireRole } from "@/lib/auth";

/** Admin dashboard statistics — all counts are live queries. */
export async function GET() {
  await requireRole(["admin"]);
  const [
    buildingsCount,
    buildingsByStatus,
    versionsCount,
    versionsByType,
    capturesCount,
    capturesByStatus,
    videos,
    photos,
    jobs,
    usersCount,
    sessionsCount,
    linksCount,
    activity,
  ] = await Promise.all([
    db.select({ n: count() }).from(buildings),
    db
      .select({ status: buildings.status, n: count() })
      .from(buildings)
      .groupBy(buildings.status),
    db.select({ n: count() }).from(buildingVersions),
    db
      .select({ type: buildingVersions.type, n: count() })
      .from(buildingVersions)
      .groupBy(buildingVersions.type),
    db.select({ n: count() }).from(captures),
    db
      .select({ status: captures.status, n: count() })
      .from(captures)
      .groupBy(captures.status),
    db.select({ n: count() }).from(captures).where(sql`${captures.kind} = 'video'`),
    db.select({ n: count() }).from(captures).where(sql`${captures.kind} = 'photo'`),
    db
      .select({ status: processingJobs.status, n: count() })
      .from(processingJobs)
      .groupBy(processingJobs.status),
    db.select({ n: count() }).from(users),
    db.select({ n: count() }).from(captureSessions),
    db.select({ n: count() }).from(contributorLinks),
    db
      .select()
      .from(auditLogs)
      .orderBy(desc(auditLogs.createdAt))
      .limit(12),
  ]);

  return NextResponse.json({
    buildings: buildingsCount[0]?.n ?? 0,
    buildingsByStatus: Object.fromEntries(buildingsByStatus.map((r) => [r.status, r.n])),
    versions: versionsCount[0]?.n ?? 0,
    versionsByType: Object.fromEntries(versionsByType.map((r) => [r.type, r.n])),
    photos: photos[0]?.n ?? 0,
    videos: videos[0]?.n ?? 0,
    capturesByStatus: Object.fromEntries(capturesByStatus.map((r) => [r.status, r.n])),
    jobsByStatus: Object.fromEntries(jobs.map((r) => [r.status, r.n])),
    users: usersCount[0]?.n ?? 0,
    sessions: sessionsCount[0]?.n ?? 0,
    links: linksCount[0]?.n ?? 0,
    totalCaptures: capturesCount[0]?.n ?? 0,
    activity,
  });
}
