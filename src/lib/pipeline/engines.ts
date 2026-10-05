import "server-only";
import { computeConfidence } from "../confidence";
import {
  arcCoverage,
  convexHull,
  haversineM,
  polygonAreaM2,
  regularPolygon,
  shrinkTowardCentroid,
  toGeoJSONPolygon,
  type Pt,
} from "../geo";

/**
 * Engine abstraction layer.
 *
 * The pipeline NEVER assumes a specific provider:
 *  - `EstimationEngine` is built-in and always available. It produces honest
 *    *estimated* geometry from capture data and labels it as such.
 *  - `RemoteReconstructionEngine` plugs in an external service
 *    (photogrammetry / neural / gaussian splatting) via RECON_API_URL. Its
 *    contract is documented in docs/3D_RECONSTRUCTION.md. When no service is
 *    configured, `available()` returns false and the pipeline records
 *    "unconfigured" — it does not fake results.
 */

export type EnrichedCapture = {
  id: string;
  lat: number;
  lng: number;
  altitude: number | null;
  hAccuracy: number | null;
  heading: number | null;
  sharpness: number;
  createdAt: Date;
};

export type Footprint = { type: "Polygon"; coordinates: [number, number][][] };

export type ReconstructionInput = {
  buildingId: string;
  captures: EnrichedCapture[];
};

export type ReconstructionOutput = {
  type:
    | "estimated_single_image"
    | "estimated_multi_view"
    | "photogrammetry"
    | "neural"
    | "manual";
  state: "ready" | "failed";
  footprint: Footprint;
  heightM: number | null;
  floors: number | null;
  buildingType: string;
  roofType: string;
  modelUrl?: string;
  modelFormat?: string;
  textureUrl?: string;
  lod?: unknown;
  metrics: Record<string, unknown>;
  confidence: number;
  error?: string;
};

export class EngineNotConfigured extends Error {
  constructor(engine: string) {
    super(`${engine} engine is not configured on this deployment.`);
  }
}

export interface ReconstructionEngine {
  id: string;
  name: string;
  available(): boolean;
  reconstruct(input: ReconstructionInput): Promise<ReconstructionOutput>;
}

/* ------------------------- geometry builder ------------------------- */

function median(xs: number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

function buildFootprint(captures: EnrichedCapture[]): {
  footprint: Footprint;
  radiusM: number;
  method: "hull" | "octagon";
} {
  const pts: Pt[] = captures.map((c) => ({ lat: c.lat, lng: c.lng }));
  const center: Pt = {
    lat: captures.reduce((s, c) => s + c.lat, 0) / captures.length,
    lng: captures.reduce((s, c) => s + c.lng, 0) / captures.length,
  };
  const dists = captures.map((c) => haversineM(c.lat, c.lng, center.lat, center.lng));
  const med = median(dists);

  if (pts.length >= 3) {
    let hull = convexHull(pts);
    let footprint = toGeoJSONPolygon(hull) as Footprint;
    if (polygonAreaM2(hull) < 25) {
      // Captures too tight to define a real hull — fall back to an octagon.
      footprint = toGeoJSONPolygon(
        regularPolygon(center, Math.max(4, med * 0.6), 8),
      ) as Footprint;
      return { footprint, radiusM: Math.max(4, med * 0.6), method: "octagon" };
    }
    const shrunk = shrinkTowardCentroid(hull, 0.35);
    footprint = toGeoJSONPolygon(shrunk) as Footprint;
    return { footprint, radiusM: med, method: "hull" };
  }
  const r = Math.max(4, med * 0.6);
  return {
    footprint: toGeoJSONPolygon(regularPolygon(center, r, 8)) as Footprint,
    radiusM: r,
    method: "octagon",
  };
}

function viewMetrics(captures: EnrichedCapture[]) {
  const headings = captures.map((c) => c.heading);
  const coverage = arcCoverage(headings);
  const pairDists: number[] = [];
  for (let i = 0; i < captures.length; i++) {
    for (let j = i + 1; j < captures.length; j++) {
      pairDists.push(
        haversineM(
          captures[i].lat,
          captures[i].lng,
          captures[j].lat,
          captures[j].lng,
        ),
      );
    }
  }
  const meanPair = pairDists.length
    ? pairDists.reduce((a, b) => a + b, 0) / pairDists.length
    : 0;
  // View-geometry overlap heuristic: views within ~8–38 m of each other
  // imply substantial frame overlap for typical phone FOVs.
  const overlapRatio = pairDists.length
    ? Math.min(1, Math.max(0, 1 - (meanPair - 8) / 30))
    : 0;
  return {
    coverage,
    overlapRatio,
    meanPairDistM: Math.round(meanPair * 10) / 10,
  };
}

/* -------------------------- built-in engine -------------------------- */

export const estimationEngine: ReconstructionEngine = {
  id: "built-in-estimation",
  name: "Built-in geometric estimation",
  available: () => true,
  async reconstruct(input: ReconstructionInput) {
    const { captures } = input;
    if (!captures.length) {
      throw new Error("No captures to reconstruct");
    }
    const { footprint, radiusM, method } = buildFootprint(captures);
    const vm = viewMetrics(captures);
    const multiView = captures.length >= 2 && vm.coverage.distinctArcs >= 2;
    const type = multiView
      ? "estimated_multi_view"
      : "estimated_single_image";
    const meanSharp =
      captures.reduce((s, c) => s + (c.sharpness ?? 0), 0) / captures.length;
    const accs = captures
      .map((c) => c.hAccuracy)
      .filter((v): v is number => v != null);
    const confidence = computeConfidence({
      reconstructionType: type,
      distinctArcs: vm.coverage.distinctArcs,
      meanSharpness: meanSharp,
      meanGpsAccuracyM: accs.length ? accs.reduce((a, b) => a + b, 0) / accs.length : null,
      overlapRatio: vm.overlapRatio,
      captureCount: captures.length,
    });
    return {
      type,
      state: "ready",
      footprint,
      heightM: null, // never invented — unknown until measured or admin-set
      floors: null,
      buildingType: "unknown",
      roofType: "unknown",
      metrics: {
        footprintMethod: method,
        footprintRadiusM: Math.round(radiusM * 10) / 10,
        distinctArcs: vm.coverage.distinctArcs,
        coveredArcs: vm.coverage.covered,
        overlapRatio: Math.round(vm.overlapRatio * 100) / 100,
        meanPairDistM: vm.meanPairDistM,
        meanSharpness: Math.round(meanSharp * 10) / 10,
        captureCount: captures.length,
      },
      confidence,
    };
  },
};

/* ---------------------- optional remote engine ---------------------- */

export const remoteReconstructionEngine: ReconstructionEngine = {
  id: "remote-photogrammetry",
  name: "Remote photogrammetry / neural service",
  available: () => Boolean(process.env.RECON_API_URL),
  async reconstruct(input: ReconstructionInput) {
    const url = process.env.RECON_API_URL;
    if (!url) throw new EngineNotConfigured("Reconstruction");
    // Documented contract (docs/3D_RECONSTRUCTION.md):
    // POST {kind, buildingId, captures:[{url, lat, lng, heading, accuracy}]}
    // -> {type, footprint, heightM, floors, buildingType, roofType,
    //     modelUrl, modelFormat, textureUrl, lod, confidence}
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(process.env.RECON_API_KEY
          ? { Authorization: `Bearer ${process.env.RECON_API_KEY}` }
          : {}),
      },
      body: JSON.stringify({
        kind: process.env.RECON_ENGINE === "neural" ? "neural" : "photogrammetry",
        buildingId: input.buildingId,
        captures: input.captures.map((c) => ({
          lat: c.lat,
          lng: c.lng,
          heading: c.heading,
          accuracy: c.hAccuracy,
        })),
      }),
    });
    if (!res.ok) {
      throw new Error(`Remote reconstruction failed: HTTP ${res.status}`);
    }
    const j = (await res.json()) as Record<string, unknown>;
    if (!j.footprint) throw new Error("Remote engine returned no footprint");
    const type = (j.type as ReconstructionOutput["type"]) ?? "photogrammetry";
    const fallback = await estimationEngine.reconstruct(input);
    return {
      type,
      state: "ready",
      footprint: j.footprint as Footprint,
      heightM: (j.heightM as number) ?? null,
      floors: (j.floors as number) ?? null,
      buildingType: (j.buildingType as string) ?? "unknown",
      roofType: (j.roofType as string) ?? "unknown",
      modelUrl: j.modelUrl as string | undefined,
      modelFormat: j.modelFormat as string | undefined,
      textureUrl: j.textureUrl as string | undefined,
      lod: j.lod,
      metrics: { remote: true, ...(j.metrics as object ?? {}) },
      confidence:
        typeof j.confidence === "number"
          ? Math.min(0.95, Math.max(0.05, j.confidence))
          : fallback.confidence,
    };
  },
};

/** Ordered registry — first available engine that fits the data wins. */
export function selectReconstructionEngine(captureCount: number): {
  primary: ReconstructionEngine;
  fallback: ReconstructionEngine;
} {
  const remote = remoteReconstructionEngine;
  if (remote.available() && captureCount >= 2) {
    return { primary: remote, fallback: estimationEngine };
  }
  return { primary: estimationEngine, fallback: estimationEngine };
}

/* ----------------------- building detection ----------------------- */

export interface BuildingDetectionInput {
  center: Pt;
  captures: EnrichedCapture[];
}
export interface BuildingDetectionResult {
  buildingFound: boolean;
  /** Optional remote hints; null = unknown (never invented). */
  heightM: number | null;
  floors: number | null;
  buildingType: string;
  roofType: string;
  engine: string;
}

export interface BuildingDetectionEngine {
  id: string;
  available(): boolean;
  detect(
    input: BuildingDetectionInput,
  ): Promise<BuildingDetectionResult>;
}

/**
 * Built-in anchor detector: a capture cluster *is* a building anchor.
 * It never invents height/floors/type — those stay "unknown" unless a
 * configured remote vision service (DETECTION_API_URL) reports them.
 */
export const anchorDetectionEngine: BuildingDetectionEngine = {
  id: "built-in-anchor",
  available: () => true,
  async detect() {
    return {
      buildingFound: true,
      heightM: null,
      floors: null,
      buildingType: "unknown",
      roofType: "unknown",
      engine: this.id,
    };
  },
};

export const remoteDetectionEngine: BuildingDetectionEngine = {
  id: "remote-vision",
  available: () => Boolean(process.env.DETECTION_API_URL),
  async detect(input: BuildingDetectionInput) {
    const url = process.env.DETECTION_API_URL;
    if (!url) throw new EngineNotConfigured("Building detection");
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(process.env.DETECTION_API_KEY
          ? { Authorization: `Bearer ${process.env.DETECTION_API_KEY}` }
          : {}),
      },
      body: JSON.stringify({
        center: input.center,
        captures: input.captures.map((c) => ({
          lat: c.lat,
          lng: c.lng,
          heading: c.heading,
        })),
      }),
    });
    if (!res.ok) throw new Error(`Detection service HTTP ${res.status}`);
    const j = (await res.json()) as Record<string, unknown>;
    return {
      buildingFound: Boolean(j.buildingFound ?? true),
      heightM: (j.heightM as number) ?? null,
      floors: (j.floors as number) ?? null,
      buildingType: (j.buildingType as string) ?? "unknown",
      roofType: (j.roofType as string) ?? "unknown",
      engine: this.id,
    };
  },
};

export function selectDetectionEngine(): BuildingDetectionEngine {
  return remoteDetectionEngine.available()
    ? remoteDetectionEngine
    : anchorDetectionEngine;
}
