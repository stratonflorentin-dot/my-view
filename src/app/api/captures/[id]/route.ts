import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { captures } from "@/db/schema";

/** Contributor progress check: has my capture been processed? */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const rows = await db
    .select()
    .from(captures)
    .where(eq(captures.id, id))
    .limit(1);
  const c = rows[0];
  if (!c) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const q = (c.quality ?? {}) as Record<string, unknown>;
  return NextResponse.json({
    id: c.id,
    kind: c.kind,
    status: c.status,
    duplicate: c.duplicateOf != null,
    buildingId: c.buildingId,
    quality: {
      blur: q.blur,
      issues: q.issues,
      sharpness: q.sharpness,
    },
    gpsAccuracyM: c.gpsHAccuracy,
  });
}
