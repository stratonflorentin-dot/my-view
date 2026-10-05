import { NextResponse } from "next/server";
import { storage, verifySignedUrl } from "@/lib/storage";

const MIME: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  mp4: "video/mp4",
  glb: "model/gltf-binary",
  gltf: "model/gltf+json",
  log: "text/plain",
  json: "application/json",
  txt: "text/plain",
};

/**
 * Signed object-storage access. Every URL carries an expiry + HMAC
 * signature; unauthenticated paths are impossible by construction.
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ key: string[] }> },
) {
  const { key: parts } = await params;
  const key = parts.join("/");
  const url = new URL(req.url);
  const exp = url.searchParams.get("exp") ?? "";
  const sig = url.searchParams.get("sig") ?? "";
  if (!verifySignedUrl(key, exp, sig)) {
    return NextResponse.json({ error: "Invalid or expired URL" }, { status: 403 });
  }
  const buf = await storage.get(key);
  if (!buf) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const ext = key.split(".").pop() ?? "";
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      "Content-Type": MIME[ext] ?? "application/octet-stream",
      "Cache-Control": "private, max-age=300",
    },
  });
}
