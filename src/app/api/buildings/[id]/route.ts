import { NextResponse } from "next/server";
import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  buildings,
  buildingVersions,
  captureSessions,
  captures,
} from "@/db/schema";
import { getSession } from "@/lib/auth";
import { getSettings } from "@/lib/config";
import { signKey } from "@/lib/storage";

/**
 * Full building dossier: versions (history), captures with signed
 * thumbnail URLs, capture positions, contributor identity (name only —
 * privacy by default), GPS accuracy, engine + confidence metadata.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const settings = await getSettings();
  if (settings.map_visibility !== "public") {
    if (!(await getSession())) {
      return NextResponse.json({ error: "Access required" }, { status: 401 });
    }
  }
  const { id } = await params;
  const bRows = await db
    .select()
    .from(buildings)
    .where(eq(buildings.id, id))
    .limit(1);
  const b = bRows[0];
  if (!b) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const versions = await db
    .select()
    .from(buildingVersions)
    .where(eq(buildingVersions.buildingId, id))
    .orderBy(asc(buildingVersions.version));

  const caps = await db
    .select()
    .from(captures)
    .where(and(eq(captures.buildingId, id)))
    .orderBy(asc(captures.createdAt));
  const sessions = await db
    .select()
    .from(captureSessions)
    .where(
      caps.length
        ? eq(captureSessions.id, caps[0].sessionId)
        : eq(captureSessions.id, "00000000-0000-0000-0000-000000000000"),
    );
  const sessionBy = new Map(sessions.map((s) => [s.id, s]));
  const sessionsOf = [...new Set(caps.map((c) => c.sessionId))]
    .map((sid) => sessionBy.get(sid))
    .filter(Boolean) as (typeof sessions)[number][];

  return NextResponse.json({
    building: b,
    versions: versions.map((v) => ({
      ...v,
      modelUrl: v.modelUrl ? signKey(v.modelUrl, 3600) : null,
      textureUrl: v.textureUrl ? signKey(v.textureUrl, 3600) : null,
    })),
    captures: caps.map((c) => ({
      id: c.id,
      kind: c.kind,
      status: c.status,
      gpsLat: c.gpsLat,
      gpsLng: c.gpsLng,
      gpsAltitude: c.gpsAltitude,
      gpsHAccuracy: c.gpsHAccuracy,
      gpsHeading: c.gpsHeading,
      gpsSource: c.gpsSource,
      width: c.width,
      height: c.height,
      sizeBytes: c.sizeBytes,
      deviceTimestamp: c.deviceTimestamp,
      createdAt: c.createdAt,
      duplicateOf: c.duplicateOf,
      quality: c.quality,
      exif: c.exif,
      url: signKey(c.storageKey, 3600),
      thumbnailUrl: c.storageKey.includes("video") || c.kind === "video"
        ? null
        : signKey(
            `thumbs/${c.storageKey.split("/").slice(0, 3).join("/")}/t-${c.id}.jpg`,
            3600,
          ),
    })),
    sessions: sessionsOf.map((s) => ({
      id: s.id,
      contributorName: s.contributorName,
      deviceInfo: s.deviceInfo,
      startedAt: s.startedAt,
      finishedAt: s.finishedAt,
    })),
  });
}
