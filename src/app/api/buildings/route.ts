import { NextResponse } from "next/server";
import { and, desc, ilike, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { buildings } from "@/db/schema";
import { getSession } from "@/lib/auth";
import { getSettings } from "@/lib/config";

/** Admin/viewer building list with search (name, id, coordinates). */
export async function GET(req: Request) {
  const settings = await getSettings();
  if (settings.map_visibility !== "public") {
    if (!(await getSession())) {
      return NextResponse.json({ error: "Access required" }, { status: 401 });
    }
  }
  const url = new URL(req.url);
  const q = url.searchParams.get("q")?.trim() ?? "";
  const status = url.searchParams.get("status") ?? "";
  const limit = Math.min(100, Number(url.searchParams.get("limit") ?? 40));
  const offset = Math.max(0, Number(url.searchParams.get("offset") ?? 0));

  const conds = [];
  if (status) conds.push(sql`${buildings.status} = ${status}`);
  if (q) {
    conds.push(
      or(
        ilike(buildings.name, `%${q}%`),
        ilike(buildings.id, `%${q}%`),
        sql`(${buildings.centerLat})::text LIKE ${`%${q}%`}`,
      ),
    );
  }
  const rows = await db
    .select()
    .from(buildings)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(buildings.updatedAt))
    .limit(limit)
    .offset(offset);
  return NextResponse.json({ buildings: rows });
}
