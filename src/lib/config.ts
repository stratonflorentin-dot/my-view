import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { mapSettings } from "@/db/schema";

export const DEFAULT_SETTINGS = {
  platform_name: process.env.PLATFORM_NAME || "MyWorld 3D Map",
  map_visibility: (process.env.MAP_VISIBILITY || "invite_only") as
    | "public"
    | "invite_only"
    | "private",
  /** Horizontal GPS accuracy beyond which captures are flagged. */
  gps_max_accuracy_m: 20,
  /** Minimum distinct views to upgrade an estimate to multi-view. */
  multi_view_min_captures: 3,
} as const;

export type PlatformSettings = {
  platform_name: string;
  map_visibility: "public" | "invite_only" | "private";
  gps_max_accuracy_m: number;
  multi_view_min_captures: number;
};

export async function getSettings(): Promise<PlatformSettings> {
  try {
    const rows = await db.select().from(mapSettings);
    const merged: PlatformSettings = { ...DEFAULT_SETTINGS };
    for (const r of rows) {
      if (r.key in merged) (merged as Record<string, unknown>)[r.key] = r.value;
    }
    return merged;
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export async function setSetting(key: string, value: unknown) {
  if (!Object.keys(DEFAULT_SETTINGS).includes(key)) return;
  await db
    .insert(mapSettings)
    .values({ key, value })
    .onConflictDoUpdate({ target: mapSettings.key, set: { value } });
}

/** Storage root for the local object-storage implementation. */
export function storageRoot(): string {
  return process.env.STORAGE_DIR || "./storage";
}

export function fileSigningKey(): string {
  return process.env.FILE_SIGNING_KEY || "dev-file-signing-key";
}

export function authSecret(): string {
  return process.env.AUTH_SECRET || "dev-auth-secret";
}
