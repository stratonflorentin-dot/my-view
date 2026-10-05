import "server-only";
import sharp from "sharp";

export type ImageMeta = {
  width: number;
  height: number;
  format: string;
  exif: {
    gps?: { lat: number; lng: number; alt?: number };
    timestamp?: string;
    make?: string;
    model?: string;
    focalLength?: number;
    orientation?: number;
  };
};

type ExifGpsValue = { value?: [number, number, number] } | undefined;
type ExifRecord = {
  GPSInfo?: Record<string, ExifGpsValue & { value2?: string }>;
  DateTimeOriginal?: string;
  DateTime?: string;
  Make?: string;
  Model?: string;
  FocalLength?: number;
  Orientation?: number;
};

/** Extract dimensions + available EXIF. EXIF is informational only — the
 *  location recorded by the app is the authoritative capture location. */
export async function extractImageMeta(
  buf: Buffer,
): Promise<ImageMeta> {
  const s = sharp(buf, { failOn: "error" });
  const { width, height, format, exif } = await s.metadata();
  const e = (exif ?? {}) as ExifRecord;
  const g = e.GPSInfo;
  const gpsNum = (v?: ExifGpsValue) => {
    if (!v?.value) return undefined;
    const [d, m, s2] = v.value;
    return d * 3600 + m * 60 + s2;
  };
  let gps: { lat: number; lng: number; alt?: number } | undefined;
  if (g?.latitude && g?.longitude) {
    const lat = gpsNum(g.latitude);
    const lng = gpsNum(g.longitude);
    if (lat != null && lng != null) {
      const latRef = (g.latitudeRef?.value2 as string) ?? "N";
      const lngRef = (g.longitudeRef?.value2 as string) ?? "E";
      gps = {
        lat: latRef === "S" ? -lat / 3600 : lat / 3600,
        lng: lngRef === "W" ? -lng / 3600 : lng / 3600,
        alt: g.altitude?.value ? g.altitude.value[0] : undefined,
      };
    }
  }
  const dt = e.DateTimeOriginal ?? e.DateTime;
  return {
    width: width ?? 0,
    height: height ?? 0,
    format: format ?? "unknown",
    exif: {
      gps,
      timestamp: dt
        ? new Date(dt.replace(" ", "T")).toISOString()
        : undefined,
      make: e.Make,
      model: e.Model,
      focalLength: e.FocalLength,
      orientation: e.Orientation,
    },
  };
}

export type QualityReport = {
  /** Laplacian variance — higher means sharper. */
  sharpness: number;
  brightness: number;
  contrast: number;
  blur: "none" | "mild" | "severe";
  tooDark: boolean;
  tooBright: boolean;
  ok: boolean;
  issues: string[];
};

/** Real image-quality analysis on a downsampled grayscale buffer. */
export async function analyzeImageQuality(
  buf: Buffer,
): Promise<QualityReport> {
  const { data } = await sharp(buf)
    .greyscale()
    .resize(128, 128, { fit: "fill" })
    .raw()
    .toBuffer({ resolveWithObject: true });
  const w = 128;
  const idx = (x: number, y: number) => data[y * w + x];
  let sum = 0;
  let sumSq = 0;
  let lapSum = 0;
  let lapSumSq = 0;
  let n = 0;
  for (let y = 1; y < w - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const c = idx(x, y);
      const l =
        idx(x - 1, y) + idx(x + 1, y) + idx(x, y - 1) + idx(x, y + 1) - 4 * c;
      sum += c;
      sumSq += c * c;
      lapSum += l;
      lapSumSq += l * l;
      n++;
    }
  }
  const mean = sum / n;
  const variance = sumSq / n - mean * mean;
  const lapMean = lapSum / n;
  const sharpness = lapSumSq / n - lapMean * lapMean;
  const brightness = mean;
  const contrast = Math.sqrt(Math.max(0, variance));

  const issues: string[] = [];
  const blur: QualityReport["blur"] =
    sharpness < 40 ? "severe" : sharpness < 120 ? "mild" : "none";
  if (blur !== "none") issues.push("Image is blurry — move steadier");
  if (brightness < 45) issues.push("Image is too dark");
  if (brightness > 225) issues.push("Image is overexposed");

  return {
    sharpness: Math.round(sharpness * 10) / 10,
    brightness: Math.round(brightness),
    contrast: Math.round(contrast * 10) / 10,
    blur,
    tooDark: brightness < 45,
    tooBright: brightness > 225,
    ok: issues.length === 0,
    issues,
  };
}

/**
 * Average-hash duplicate detection: 16x16 grayscale, each pixel bit is 1 if
 * >= the mean. Represented as a 256-char binary string — the exact same
 * algorithm runs in the browser (canvas) for client-side pre-checks.
 */
export async function aHash(buf: Buffer): Promise<string> {
  const { data } = await sharp(buf)
    .greyscale()
    .resize(16, 16, { fit: "fill" })
    .raw()
    .toBuffer({ resolveWithObject: true });
  let sum = 0;
  for (let i = 0; i < data.length; i++) sum += data[i];
  const mean = sum / data.length;
  let bits = "";
  for (let i = 0; i < data.length; i++) bits += data[i] >= mean ? "1" : "0";
  return bits;
}

export function hamming(a: string, b: string): number {
  if (a.length !== b.length) return Math.max(a.length, b.length);
  let d = 0;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) d++;
  return d;
}

/** Duplicate threshold for the 256-bit hash. */
export const DUPLICATE_HAMMING_MAX = 22;

export async function makeThumbnail(
  buf: Buffer,
  maxDim = 560,
  quality = 72,
): Promise<Buffer> {
  return sharp(buf)
    .resize(maxDim, maxDim, { fit: "inside" })
    .jpeg({ quality })
    .toBuffer();
}
