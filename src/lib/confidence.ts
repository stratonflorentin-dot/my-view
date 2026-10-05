/**
 * Deterministic reconstruction-confidence scoring, in [0, 1].
 *
 * The score is a documented function of *measured* inputs only — it never
 * claims more than the data supports:
 *
 *   single-view estimate:  base 0.22
 *   multi-view estimate:   base 0.34
 *   photogrammetry:        base 0.55 (engine provides its own term)
 *   + view coverage:  up to +0.26 (distinct compass arcs / 8, weighted)
 *   + sharpness:      up to +0.14 (mean sharpness normalized at 400)
 *   + GPS term:       −0.10 × min(1, meanHAccuracy / 15m)
 *   + overlap:        up to +0.12 (mean pairwise GPS overlap ratio)
 *   clamped to [0.05, 0.9] — we never report full certainty from phone data.
 */

export type ConfidenceInputs = {
  reconstructionType:
    | "estimated_single_image"
    | "estimated_multi_view"
    | "photogrammetry"
    | "neural"
    | "manual";
  distinctArcs: number;
  meanSharpness: number;
  meanGpsAccuracyM: number | null;
  overlapRatio: number | null;
  captureCount: number;
};

export function computeConfidence(i: ConfidenceInputs): number {
  const base =
    i.reconstructionType === "estimated_single_image"
      ? 0.22
      : i.reconstructionType === "estimated_multi_view"
        ? 0.34
        : 0.55;

  const views = Math.min(i.distinctArcs / 8, 1) * 0.26;
  const sharp = Math.min(Math.max(i.meanSharpness, 0) / 400, 1) * 0.14;
  const gpsPenalty =
    i.meanGpsAccuracyM == null ? 0.05 : Math.min(i.meanGpsAccuracyM / 15, 1) * 0.1;
  const overlap = (i.overlapRatio ?? 0) * 0.12;

  let s = base + views + sharp - gpsPenalty + overlap;
  if (i.captureCount === 1) s = Math.min(s, 0.4); // one photo can never look "solid"
  return Math.round(Math.min(0.9, Math.max(0.05, s)) * 1000) / 1000;
}

export function confidenceLabel(c: number): {
  label: string;
  tone: "low" | "mid" | "high";
} {
  if (c < 0.35) return { label: "Low confidence", tone: "low" };
  if (c < 0.6) return { label: "Medium confidence", tone: "mid" };
  return { label: "High confidence", tone: "high" };
}
