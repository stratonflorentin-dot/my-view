/**
 * GPS validation. Ordinary phone GPS is not centimeter-level — this module
 * grades accuracy honestly and never claims precision it cannot deliver.
 */

export type GpsGrade = {
  level: "excellent" | "good" | "acceptable" | "poor";
  accepted: boolean;
  message: string;
};

export function gradeGps(hAccuracyM: number | null, maxM = 20): GpsGrade {
  if (hAccuracyM == null || Number.isNaN(hAccuracyM)) {
    return {
      level: "poor",
      accepted: false,
      message: "No GPS fix available. Please wait for a satellite fix.",
    };
  }
  if (hAccuracyM <= 3)
    return { level: "excellent", accepted: true, message: "Excellent GPS fix." };
  if (hAccuracyM <= 10)
    return { level: "good", accepted: true, message: "Good GPS fix." };
  if (hAccuracyM <= maxM)
    return {
      level: "acceptable",
      accepted: true,
      message: `GPS fix is acceptable (±${Math.round(hAccuracyM)} m).`,
    };
  return {
    level: "poor",
    accepted: false,
    message:
      "GPS accuracy is currently insufficient. Please wait or move to an area with better GPS reception.",
  };
}

export type GpsFixInput = {
  lat: number;
  lng: number;
  altitude?: number | null;
  hAccuracy?: number | null;
  vAccuracy?: number | null;
  heading?: number | null;
  source?: string;
};

export function validateFix(
  fix: GpsFixInput,
  maxM = 20,
): { ok: boolean; grade: GpsGrade; errors: string[] } {
  const errors: string[] = [];
  if (
    !Number.isFinite(fix.lat) ||
    !Number.isFinite(fix.lng) ||
    Math.abs(fix.lat) > 90 ||
    Math.abs(fix.lng) > 180
  ) {
    errors.push("Invalid coordinates");
  }
  if (fix.hAccuracy != null && (fix.hAccuracy < 0 || fix.hAccuracy > 999)) {
    errors.push("Invalid accuracy value");
  }
  const grade = gradeGps(fix.hAccuracy ?? null, maxM);
  if (errors.length) {
    return {
      ok: false,
      grade: { ...grade, accepted: false },
      errors,
    };
  }
  return { ok: true, grade, errors };
}

/** Is the capture inside the contributor link's geographic scope? */
export function inScope(
  fix: { lat: number; lng: number },
  scope: {
    scope: "global" | "area" | "location";
    centerLat: number | null;
    centerLng: number | null;
    radiusM: number;
  },
  haversine: (a: number, b: number, c: number, d: number) => number,
): boolean {
  if (scope.scope === "global") return true;
  if (scope.centerLat == null || scope.centerLng == null) return true;
  const d = haversine(fix.lat, fix.lng, scope.centerLat, scope.centerLng);
  return d <= scope.radiusM;
}
