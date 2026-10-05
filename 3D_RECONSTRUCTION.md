# 3D Reconstruction

## Honesty contract

The platform distinguishes every grade of geographic truth and never conflates them:

1. **Exact GPS location** — the device fix, graded honestly (phone GPS is ±3–20 m, never cm).
2. **Photograph** — the raw capture with measured quality metrics.
3. **Estimated geometry** — derived from capture positions/angles. Labeled `estimated_*`.
4. **AI-assisted reconstruction** — a configured engine's output, labeled with the engine id.
5. **Photogrammetry reconstruction** — SfM + MVS mesh from overlapping imagery.
6. **Verified 3D model** — an admin-approved building.

A single photograph **cannot** produce an exact building; it produces a
labeled *estimate* with a capped confidence (≤ 0.4 with one capture, by
construction in `src/lib/confidence.ts`).

## Confidence scoring (real, deterministic)

`computeConfidence()`:

```
base:  single-photo estimate 0.22 · multi-view 0.34 · engine 0.55
+ distinct compass arcs / 8        → up to +0.26
+ mean sharpness normalized (400)  → up to +0.14
− GPS penalty min(1, acc/15m)      → up to −0.10
+ view-geometry overlap ratio      → up to +0.12
clamp [0.05, 0.9]
```

All inputs are measured (arc coverage, Laplacian sharpness, GPS accuracy,
pairwise capture distances). Nothing is invented.

## Engine registry

`src/lib/pipeline/engines.ts` defines:

```ts
interface ReconstructionEngine {
  id: string;
  name: string;
  available(): boolean;                                  // is it configured?
  reconstruct(input): Promise<ReconstructionOutput>;     // throws EngineNotConfigured
}
```

- `built-in-estimation` — always available. Footprint = convex hull of
  capture positions (shrunk 35 % toward centroid) or a conservative octagon
  from single views; height/floors/type stay **unknown** unless a detection
  engine reports them.
- `remote-photogrammetry` — active when `RECON_API_URL` is set and ≥ 2
  captures exist; falls back to estimation on failure.

### Remote engine HTTP contract

```
POST {RECON_API_URL}
Authorization: Bearer {RECON_API_KEY}          (if set)
{
  "kind": "photogrammetry" | "neural",
  "buildingId": "uuid",
  "captures": [{ "lat": .., "lng": .., "heading": .., "accuracy": .. }]
}
→ 200 {
  "type": "photogrammetry" | "neural",
  "footprint": { "type": "Polygon", "coordinates": [[[lng,lat], …] ] },
  "heightM": 12.5,              // null = unknown
  "floors": 4,                  // null = unknown
  "buildingType": "commercial", // "unknown" when undetermined
  "roofType": "flat",
  "modelUrl": "https://…/building.glb",   // web-compatible GLB
  "modelFormat": "glb",
  "textureUrl": "https://…/atlas.jpg",
  "lod": { "levels": […] },              // optional LOD hints
  "confidence": 0.82
}
```

The resulting version is stored verbatim (model URLs served through signed
URLs once copied into object storage), and the pipeline records which engine
produced it. **If the service is down, the version is marked `failed` and the
previous version stays live — nothing is silently degraded or faked.**

### Building detection engine

Same pattern (`DETECTION_API_URL`): returns `buildingFound`, `heightM`,
`floors`, `buildingType`, `roofType` — anything it cannot determine must be
`null`/`"unknown"`. The built-in `built-in-anchor` detector only asserts the
building exists at the capture cluster center.

## Model formats & LOD

- Web-compatible: **GLB / glTF**, 3D Tiles and point clouds supported by the
  schema (`model_format`, `lod` JSONB).
- The map renders estimated buildings as real `fill-extrusion` geometry with
  confidence-coded color; engine-produced GLBs attach to the version and are
  downloadable/verifiable in review. Large environments should use the `lod`
  hints + 3D Tiles on the engine side — the browser never loads unoptimized
  meshes.

## Video

Stored + tracked today; `video.process` jobs report
`Video processing engine is not configured` until a frame-extraction engine
is attached — visible, retryable, never pretended.
