import "server-only";
import { createHmac, randomBytes } from "node:crypto";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileSigningKey, storageRoot } from "../config";

/**
 * Object-storage abstraction. The default driver is a local filesystem
 * store; an S3-compatible driver can implement this same interface and be
 * selected via STORAGE_DRIVER (see .env.example). The database stores only
 * metadata + storage keys, never file contents.
 */
export interface ObjectStorage {
  put(key: string, data: Buffer, mime: string): Promise<void>;
  get(key: string): Promise<Buffer | null>;
  delete(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
  size(key: string): Promise<number | null>;
}

class LocalObjectStorage implements ObjectStorage {
  async put(key: string, data: Buffer, _mime: string) {
    const abs = path.join(storageRoot(), key);
    await mkdir(path.dirname(abs), { recursive: true });
    await writeFile(abs, data);
  }
  async get(key: string) {
    try {
      return await readFile(path.join(storageRoot(), key));
    } catch {
      return null;
    }
  }
  async delete(key: string) {
    await rm(path.join(storageRoot(), key), { force: true }).catch(() => {});
  }
  async exists(key: string) {
    return (await stat(path.join(storageRoot(), key)).catch(() => null)) !==
      null;
  }
  async size(key: string) {
    const s = await stat(path.join(storageRoot(), key)).catch(() => null);
    return s ? s.size : null;
  }
}

/**
 * Vercel Blob driver (STORAGE_DRIVER=vercel-blob). Requires
 * BLOB_READ_WRITE_TOKEN — create a store with `vercel storage create
 * <name> --type blob` and connect it to the project.
 */
class VercelBlobStorage implements ObjectStorage {
  private mod: Promise<typeof import("@vercel/blob")> | null = null;
  private client() {
    // Dynamic import keeps the dependency optional at build time.
    this.mod ??= import("@vercel/blob");
    return this.mod;
  }
  async put(key: string, data: Buffer, mime: string) {
    const blob = await this.client();
    await blob.put(key, data, {
      access: "public",
      contentType: mime,
      addRandomSuffix: false,
      allowOverwrite: true,
    });
  }
  async get(key: string): Promise<Buffer | null> {
    const blob = await this.client();
    const head = await blob.head(key).catch(() => null);
    if (!head) return null;
    const res = await fetch(head.url);
    if (!res.ok) return null;
    return Buffer.from(await res.arrayBuffer());
  }
  async delete(key: string) {
    const blob = await this.client();
    await blob.del(key).catch(() => {});
  }
  async exists(key: string) {
    const blob = await this.client();
    return (await blob.head(key).catch(() => null)) !== null;
  }
  async size(key: string) {
    const blob = await this.client();
    const head = await blob.head(key).catch(() => null);
    return head ? head.size : null;
  }
}

export const storage: ObjectStorage =
  process.env.STORAGE_DRIVER === "vercel-blob"
    ? new VercelBlobStorage()
    : new LocalObjectStorage();

/* ------------------------- signed URLs ------------------------- */

/**
 * Signed download URLs: /api/files/<key>?exp=<unix>&sig=<hmac-sha256>
 * The signing key lives in env; URLs expire.
 */
export function signKey(key: string, ttlSec = 600): string {
  const exp = Math.floor(Date.now() / 1000) + ttlSec;
  const sig = createHmac("sha256", fileSigningKey())
    .update(`${key}:${exp}`)
    .digest("hex");
  return `/api/files/${key}?exp=${exp}&sig=${sig}`;
}

export function verifySignedUrl(
  key: string,
  exp: string,
  sig: string,
): boolean {
  const expN = Number(exp);
  if (!Number.isFinite(expN) || expN * 1000 < Date.now()) return false;
  const expected = createHmac("sha256", fileSigningKey())
    .update(`${key}:${expN}`)
    .digest("hex");
  try {
    return (
      createHmac("sha256", "0")
        .update("")
        .digest() &&
      timingSafe(expected, sig)
    );
  } catch {
    return false;
  }
}

function timingSafe(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  let out = 0;
  for (let i = 0; i < ab.length; i++) out |= ab[i] ^ bb[i];
  return out === 0;
}

export function captureStorageKey(sessionId: string, id: string, ext: string) {
  const day = new Date().toISOString().slice(0, 10);
  return `captures/${day}/${sessionId.slice(0, 8)}/${id}.${ext}`;
}

export function modelStorageKey(buildingId: string, version: number, ext: string) {
  return `models/${buildingId}/v${version}.${ext}`;
}

export function randomToken(bytes = 9): string {
  return randomBytes(bytes).toString("hex").slice(0, 12);
}
