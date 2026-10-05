"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";

/**
 * Contributor capture experience (mobile-first).
 *
 * Phases: welcome → identity → locating → capture → done.
 *
 * Real behaviours:
 *  - live GPS with honest accuracy grading (never claims cm-level)
 *  - compass-guided 8-arc capture (device orientation, GPS-course fallback)
 *  - client-side image quality analysis (Laplacian sharpness, brightness)
 *  - client-side aHash duplicate detection (same algorithm as the server)
 *  - offline queue persisted in localStorage; uploads resume automatically
 *  - per-capture server status polling (received → processed)
 */

const ARCS = [
  "Front",
  "Front-right",
  "Right",
  "Rear-right",
  "Rear",
  "Rear-left",
  "Left",
  "Front-left",
] as const;

type Phase = "loading" | "welcome" | "identity" | "locating" | "capture" | "details" | "done";

type LinkInfo = {
  label: string | null;
  scope: "global" | "area" | "location";
  fenceType: "circle" | "polygon" | "rectangle";
  centerLat: number | null;
  centerLng: number | null;
  radiusM: number;
  polygon?: unknown;
  requireGps: boolean;
  minGpsAccuracyM: number | null;
  allowPhotos: boolean;
  allowVideo: boolean;
  allowBuildingScan: boolean;
  allowAreaScan: boolean;
  requireApproval: boolean;
  oneTime: boolean;
  maxSubmissions: number | null;
  usedSubmissions: number;
};

type FormDef = {
  id: string;
  name: string;
  fields: {
    key: string;
    label: string;
    type: string;
    required?: boolean;
    options?: string[];
    placeholder?: string;
  }[];
} | null;

type SessionInfo = {
  sessionId: string;
  remaining: number | null;
  requestedImagery: string | null;
  allowVideo: boolean;
};

type Gps = {
  lat: number;
  lng: number;
  altitude: number | null;
  hAccuracy: number | null;
  heading: number | null;
  ts: number;
};

type QueuedCapture = {
  id: string;
  kind: "photo" | "video";
  mime: string;
  base64: string;
  gps: Gps;
  hash: string | null;
  quality: { sharpness: number; brightness: number } | null;
  createdAt: number;
  status: "queued" | "uploading" | "uploaded" | "processed" | "rejected" | "failed";
  serverId?: string;
  error?: string;
};

const norm360 = (d: number) => ((d % 360) + 360) % 360;
const haversineM = (a: number, b: number, c: number, d: number) => {
  const R = 6371008.8;
  const toR = (x: number) => (x * Math.PI) / 180;
  const dp = toR(c - a);
  const dl = toR(d - b);
  const s =
    Math.sin(dp / 2) ** 2 +
    Math.cos(toR(a)) * Math.cos(toR(c)) * Math.sin(dl / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
};

/** Real image-quality analysis on a 64×64 downsample (client mirror). */
function analyzeClient(src: CanvasImageSource, sw: number, sh: number) {
  const w = 64;
  const h = 64;
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d");
  if (!ctx) return { sharpness: 0, brightness: 128, issues: ["cannot analyze"] as string[] };
  ctx.drawImage(src, 0, 0, sw, sh, 0, 0, w, h);
  const d = ctx.getImageData(0, 0, w, h).data;
  const g = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++)
    g[i] = 0.2126 * d[i * 4] + 0.7152 * d[i * 4 + 1] + 0.0722 * d[i * 4 + 2];
  let sum = 0;
  let lap = 0;
  let lapSq = 0;
  let n = 0;
  for (let y = 1; y < h - 1; y++)
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const l = g[i - 1] + g[i + 1] + g[i - w] + g[i + w] - 4 * g[i];
      sum += g[i];
      lap += l;
      lapSq += l * l;
      n++;
    }
  const mean = sum / n;
  const lm = lap / n;
  const sharpness = lapSq / n - lm * lm;
  const issues: string[] = [];
  if (sharpness < 40) issues.push("blurry");
  else if (sharpness < 120) issues.push("soft");
  if (mean < 45) issues.push("too dark");
  if (mean > 225) issues.push("overexposed");
  return { sharpness: Math.round(sharpness), brightness: Math.round(mean), issues };
}

function aHashClient(src: CanvasImageSource, sw: number, sh: number): string {
  const s = 16;
  const c = document.createElement("canvas");
  c.width = s;
  c.height = s;
  const ctx = c.getContext("2d");
  if (!ctx) return "";
  ctx.drawImage(src, 0, 0, sw, sh, 0, 0, s, s);
  const d = ctx.getImageData(0, 0, s, s).data;
  const g: number[] = [];
  for (let i = 0; i < s * s; i++)
    g.push(0.2126 * d[i * 4] + 0.7152 * d[i * 4 + 1] + 0.0722 * d[i * 4 + 2]);
  const mean = g.reduce((a, b) => a + b, 0) / g.length;
  return g.map((v) => (v >= mean ? "1" : "0")).join("");
}

function hamming(a: string, b: string) {
  if (!a || !b || a.length !== b.length) return 999;
  let d = 0;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) d++;
  return d;
}

function drawCompass(heading: number | null, covered: Set<number>, target: number | null) {
  const el = document.getElementById("compass-needle") as SVGPathElement | null;
  const sectors = document.querySelectorAll<SVGPathElement>("[data-sector]");
  sectors.forEach((p) => {
    const i = Number(p.dataset.sector);
    p.style.fill = covered.has(i)
      ? "var(--ok)"
      : i === target
        ? "var(--accent)"
        : "var(--line)";
    p.style.opacity = String(covered.has(i) ? 0.85 : i === target ? 0.9 : 0.4);
  });
  if (el && heading != null) {
    el.setAttribute("transform", `rotate(${heading} 100 100)`);
  }
}

export default function ContributeFlow({ token }: { token: string }) {
  const [phase, setPhase] = useState<Phase>("loading");
  const [link, setLink] = useState<LinkInfo | null>(null);
  const [formDef, setFormDef] = useState<FormDef>(null);
  const [linkError, setLinkError] = useState<string | null>(null);
  const [resumeSessionId, setResumeSessionId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [gps, setGps] = useState<Gps | null>(null);
  const [heading, setHeading] = useState<number | null>(null);
  const [online, setOnline] = useState(true);
  const [queue, setQueue] = useState<QueuedCapture[]>([]);
  const [flash, setFlash] = useState<string | null>(null);
  const [guidance, setGuidance] = useState<string>("Aim at the building and capture.");
  const [recording, setRecording] = useState(false);
  const [recSecs, setRecSecs] = useState(0);
  // Details/submission step state.
  const [objName, setObjName] = useState("");
  const [category, setCategory] = useState("");
  const [description, setDescription] = useState("");
  const [address, setAddress] = useState("");
  const [customValues, setCustomValues] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submissionStatus, setSubmissionStatus] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const watchRef = useRef<number | null>(null);
  const gpsRef = useRef<Gps | null>(null);
  gpsRef.current = gps;
  const queueRef = useRef(queue);
  queueRef.current = queue;
  const uploadingRef = useRef(false);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const say = useCallback((msg: string) => {
    setFlash(msg);
    clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setFlash(null), 4200);
  }, []);

  /* ------------------------------ link check ------------------------------ */
  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const r = await fetch(`/api/contribute/validate?token=${encodeURIComponent(token)}`);
        const j = await r.json();
        if (!alive) return;
        if (!j.ok) {
          setLinkError(j.message ?? "This mapping link is not valid.");
          setPhase("welcome");
          return;
        }
        setLink(j.link);
        setFormDef(j.form ?? null);
        setResumeSessionId(j.lastSessionId ?? null);
        setPhase("welcome");
      } catch {
        setLinkError("Could not reach the map server.");
        setPhase("welcome");
      }
    })();
    return () => {
      alive = false;
    };
  }, [token]);

  /* ------------------------------ start session ------------------------------ */
  const startSession = async (resume?: string) => {
    const r = await fetch("/api/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        token,
        name: name.trim() || "Anonymous",
        deviceInfo: {
          ua: navigator.userAgent,
          platform: navigator.platform,
        },
        sessionId: resume,
      }),
    });
    const j = await r.json();
    if (!r.ok || j.sessionId == null) throw new Error(j.message ?? "Session failed");
    setSession({
      sessionId: j.sessionId,
      remaining: j.remaining ?? null,
      requestedImagery: j.requestedImagery ?? null,
      allowVideo: j.link?.allowVideo ?? true,
    });
  };

  const beginMapping = async () => {
    try {
      await startSession(resumeSessionId ?? undefined);
      restoreQueue();
      setPhase("locating");
    } catch (e) {
      say(e instanceof Error ? e.message : "Could not start session");
    }
  };

  /* ------------------------------ GPS watch ------------------------------ */
  useEffect(() => {
    if (phase !== "locating" && phase !== "capture") return;
    if (!("geolocation" in navigator)) {
      say("This device has no location support.");
      return;
    }
    watchRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        setGps({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          altitude: pos.coords.altitude,
          hAccuracy: pos.coords.accuracy,
          heading: pos.coords.speed != null && pos.coords.speed > 0.4 ? pos.coords.heading : null,
          ts: pos.timestamp,
        });
      },
      () => {},
      { enableHighAccuracy: true, maximumAge: 1500, timeout: 20000 },
    );
    return () => {
      if (watchRef.current != null) navigator.geolocation.clearWatch(watchRef.current);
    };
  }, [phase, say]);

  /* ------------------------------ compass ------------------------------ */
  useEffect(() => {
    if (phase !== "capture") return;
    let last = Date.now();
    const onOrient = (e: DeviceOrientationEvent) => {
      const wk = (e as unknown as { webkitCompassHeading?: number }).webkitCompassHeading;
      let h: number | null = null;
      if (typeof wk === "number" && Number.isFinite(wk)) h = wk;
      else if (e.absolute && e.alpha != null) h = norm360(360 - e.alpha);
      if (h != null) setHeading(h);
      else if (gpsRef.current?.heading != null) setHeading(gpsRef.current.heading);
    };
    const ev = (
      "ondeviceorientationabsolute" in window
        ? "deviceorientationabsolute"
        : "deviceorientation"
    ) as "deviceorientation" | "deviceorientationabsolute";
    window.addEventListener(ev, onOrient as EventListener, true);
    const g = setInterval(() => {
      last = Date.now();
      void last;
    }, 10000);
    return () => {
      window.removeEventListener(ev, onOrient as EventListener, true);
      clearInterval(g);
    };
  }, [phase]);

  /* ------------------------------ online state ------------------------------ */
  useEffect(() => {
    const on = () => {
      setOnline(true);
      say("Back online — uploading queued captures…");
    };
    const off = () => setOnline(false);
    setOnline(navigator.onLine);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, [say]);

  /* ------------------------------ offline queue ------------------------------ */
  const qkey = session ? `mwmq_${session.sessionId}` : null;

  const persistQueue = useCallback(
    (items: QueuedCapture[]) => {
      if (qkey) {
        try {
          localStorage.setItem(qkey, JSON.stringify(items));
        } catch {
          // Quota exceeded: keep only the newest 10 pending items.
          try {
            const slim = items.slice(-10);
            localStorage.setItem(qkey, JSON.stringify(slim));
          } catch {
            /* give up persisting — in-memory queue still works */
          }
        }
      }
    },
    [qkey],
  );

  const restoreQueue = useCallback(() => {
    if (!qkey) return;
    try {
      const raw = localStorage.getItem(qkey);
      if (!raw) return;
      const items = (JSON.parse(raw) as QueuedCapture[]).filter(
        (i) => i.status !== "processed" && i.status !== "rejected",
      );
      // Anything "uploading"/"uploaded" without a server decision restarts queued.
      setQueue(
        items.map((i) =>
          i.status === "uploading" || i.status === "uploaded"
            ? { ...i, status: i.serverId ? "uploaded" : "queued" }
            : i,
        ),
      );
    } catch {
      /* corrupt queue */
    }
  }, [qkey]);

  useEffect(() => {
    if (session && queue.length) persistQueue(queue);
  }, [queue, session, persistQueue]);

  /* ------------------------------ upload pump ------------------------------ */
  const uploadNext = useCallback(async () => {
    if (uploadingRef.current || !session) return;
    const next = queueRef.current.find(
      (i) => (i.status === "queued" || i.status === "failed") && !i.serverId,
    );
    if (!next || !navigator.onLine) return;
    uploadingRef.current = true;
    setQueue((q) => q.map((i) => (i.id === next.id ? { ...i, status: "uploading", error: undefined } : i)));
    try {
      const r = await fetch("/api/captures", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: session.sessionId,
          kind: next.kind,
          mime: next.mime,
          base64: next.base64,
          gps: next.gps,
        }),
      });
      const j = await r.json();
      if (!r.ok) {
        setQueue((q) =>
          q.map((i) =>
            i.id === next.id ? { ...i, status: "failed", error: j.error ?? "Upload failed" } : i,
          ),
        );
        say(j.error ?? "Upload failed");
      } else {
        setQueue((q) =>
          q.map((i) =>
            i.id === next.id
              ? { ...i, status: "uploaded", serverId: j.captureId }
              : i,
          ),
        );
      }
    } catch {
      setQueue((q) =>
        q.map((i) =>
          i.id === next.id ? { ...i, status: "failed", error: "Network error" } : i,
        ),
      );
    } finally {
      uploadingRef.current = false;
    }
  }, [session, say]);

  useEffect(() => {
    if (!session || phase !== "capture") return;
    const iv = setInterval(() => {
      if (navigator.onLine) void uploadNext();
      // Poll server status for uploaded captures.
      const pending = queueRef.current.filter((i) => i.status === "uploaded" && i.serverId);
      for (const p of pending) {
        void fetch(`/api/captures/${p.serverId}`)
          .then((r) => (r.ok ? r.json() : null))
          .then((j) => {
            if (!j) return;
            setQueue((q) =>
              q.map((i) =>
                i.id === p.id
                  ? { ...i, status: j.status === "rejected" ? "rejected" : j.status === "processed" ? "processed" : "uploaded" }
                  : i,
              ),
            );
          })
          .catch(() => {});
      }
    }, 2500);
    return () => clearInterval(iv);
  }, [session, phase, uploadNext]);

  /* ------------------------------ camera ------------------------------ */
  const startCamera = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment", width: { ideal: 1600 } },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => {});
      }
    } catch {
      say("Camera unavailable — you can still pick photos from your gallery.");
    }
  }, [say]);

  useEffect(() => {
    if (phase === "capture") void startCamera();
    return () => {
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      recorderRef.current?.state !== "inactive" && recorderRef.current?.stop();
    };
  }, [phase, startCamera]);

  const takePhoto = () => {
    const v = videoRef.current;
    if (!v || !v.videoWidth) {
      say("Camera not ready yet — try again in a second.");
      return;
    }
    const g = gpsRef.current;
    if (!g) {
      say("Waiting for a GPS fix…");
      return;
    }
    if (g.hAccuracy != null && g.hAccuracy > 40) {
      say("GPS accuracy is currently insufficient. Please wait or move to an area with better GPS reception.");
      return;
    }
    if (
      link &&
      link.scope !== "global" &&
      link.centerLat != null &&
      link.centerLng != null
    ) {
      const d = haversineM(g.lat, g.lng, link.centerLat, link.centerLng);
      if (d > link.radiusM + 25) {
        say("You are outside the allowed mapping area for this link.");
        return;
      }
    }

    const c = document.createElement("canvas");
    const scale = Math.min(1, 1600 / Math.max(v.videoWidth, v.videoHeight));
    c.width = Math.round(v.videoWidth * scale);
    c.height = Math.round(v.videoHeight * scale);
    const ctx = c.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(v, 0, 0, c.width, c.height);

    const quality = analyzeClient(c, c.width, c.height);
    const hash = aHashClient(c, c.width, c.height);

    // Client duplicate guard (server re-checks with its own aHash).
    if (hash) {
      const dup = queueRef.current.find(
        (i) => i.hash && hamming(hash, i.hash) <= 22,
      );
      if (dup) {
        say("That looks like a duplicate of a capture you already took.");
        return;
      }
    }

    c.toBlob(
      (blob) => {
        if (!blob) return;
        const fr = new FileReader();
        fr.onload = () => {
          const b64 = String(fr.result).split(",")[1];
          const item: QueuedCapture = {
            id: crypto.randomUUID(),
            kind: "photo",
            mime: "image/jpeg",
            base64: b64,
            gps: g,
            hash,
            quality: { sharpness: quality.sharpness, brightness: quality.brightness },
            createdAt: Date.now(),
            status: navigator.onLine ? "queued" : "queued",
          };
          setQueue((q) => [...q, item]);
          if (quality.issues.includes("blurry"))
            say("Image quality is low — steady the phone for the next shot.");
          else if (quality.issues.length)
            say(quality.issues.join(" · "));
          else
            say("Captured. Move around the building for the next angle.");
        };
        fr.readAsDataURL(blob);
      },
      "image/jpeg",
      0.8,
    );
  };

  const pickFile = (file: File) => {
    if (!file.type.startsWith("image/")) {
      say("Please choose a photo.");
      return;
    }
    const g = gpsRef.current;
    if (!g) {
      say("Waiting for a GPS fix…");
      return;
    }
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const c = document.createElement("canvas");
      const scale = Math.min(1, 1600 / Math.max(img.width, img.height));
      c.width = Math.round(img.width * scale);
      c.height = Math.round(img.height * scale);
      const ctx = c.getContext("2d");
      if (!ctx) return;
      ctx.drawImage(img, 0, 0, c.width, c.height);
      const quality = analyzeClient(c, c.width, c.height);
      const hash = aHashClient(c, c.width, c.height);
      c.toBlob(
        (blob) => {
          URL.revokeObjectURL(url);
          if (!blob) return;
          const fr = new FileReader();
          fr.onload = () => {
            const b64 = String(fr.result).split(",")[1];
            setQueue((q) => [
              ...q,
              {
                id: crypto.randomUUID(),
                kind: "photo",
                mime: "image/jpeg",
                base64: b64,
                gps: g,
                hash,
                quality: { sharpness: quality.sharpness, brightness: quality.brightness },
                createdAt: Date.now(),
                status: "queued",
              },
            ]);
            say("Photo queued for upload.");
          };
          fr.readAsDataURL(blob);
        },
        "image/jpeg",
        0.8,
      );
    };
    img.src = url;
  };

  const startRecording = async () => {
    if (!streamRef.current) {
      say("Camera not ready — try again.");
      return;
    }
    try {
      const rec = new MediaRecorder(streamRef.current);
      const chunks: Blob[] = [];
      rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      rec.onstop = () => {
        setRecording(false);
        const blob = new Blob(chunks, { type: rec.mimeType || "video/webm" });
        if (blob.size > 25 * 1024 * 1024) {
          say("Clip too large for this connection — try under 30 seconds.");
          return;
        }
        const g = gpsRef.current;
        if (!g) return;
        const fr = new FileReader();
        fr.onload = () => {
          const b64 = String(fr.result).split(",")[1];
          setQueue((q) => [
            ...q,
            {
              id: crypto.randomUUID(),
              kind: "video",
              mime: rec.mimeType || "video/webm",
              base64: b64,
              gps: g,
              hash: null,
              quality: null,
              createdAt: Date.now(),
              status: "queued",
            },
          ]);
          say("Video queued for upload.");
        };
        fr.readAsDataURL(blob);
      };
      rec.start();
      recorderRef.current = rec;
      setRecording(true);
      setRecSecs(0);
      const t0 = Date.now();
      const iv = setInterval(() => {
        const s = Math.floor((Date.now() - t0) / 1000);
        setRecSecs(s);
        if (s >= 30) {
          clearInterval(iv);
          rec.state !== "inactive" && rec.stop();
        }
      }, 500);
    } catch {
      say("Video recording is not supported on this device.");
    }
  };

  const stopRecording = () => {
    recorderRef.current?.state !== "inactive" && recorderRef.current?.stop();
  };

  /* ------------------------------ guidance ------------------------------ */
  const coveredArcs = new Set(
    queue
      .filter((i) => i.kind === "photo" && i.gps.heading != null)
      .map((i) => Math.floor(norm360(i.gps.heading!) / 45) % 8),
  );
  const targetArc = [0, 1, 2, 3, 4, 5, 6, 7].find((a) => !coveredArcs.has(a)) ?? null;

  useEffect(() => {
    if (phase !== "capture") return;
    if (coveredArcs.size === 0)
      setGuidance("Aim at the building from its front and capture the first photo.");
    else if (targetArc != null)
      setGuidance(
        `Good — ${coveredArcs.size}/8 sides captured. Move to the ${ARCS[targetArc]} side and keep the building inside the frame.`,
      );
    else
      setGuidance(
        "All sides captured. Add a few more overlapping photos from about 10 m away for a stronger reconstruction — or finish.",
      );
    drawCompass(heading, coveredArcs, targetArc);
  }, [phase, coveredArcs, heading, targetArc]);

  const grade =
    gps?.hAccuracy == null
      ? null
      : gps.hAccuracy <= 3
        ? { label: "Excellent", cls: "badge-ok" }
        : gps.hAccuracy <= 10
          ? { label: "Good", cls: "badge-ok" }
          : gps.hAccuracy <= 20
            ? { label: "Acceptable", cls: "badge-warn" }
            : { label: "Poor", cls: "badge-bad" };

  const done = queue.filter((i) => i.status === "processed").length;
  const processing = queue.filter(
    (i) => i.status === "uploaded" || i.status === "uploading",
  ).length;

  /* ------------------------------ submission ------------------------------ */
  const submitDetails = async () => {
    if (!session) return;
    setSubmitting(true);
    try {
      const formData: Record<string, string> = { ...customValues };
      const r = await fetch("/api/submissions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: session.sessionId,
          kind: link?.allowAreaScan && queue.length > 8 ? "area" : "building",
          name: objName.trim() || undefined,
          category: category.trim() || undefined,
          description: description.trim() || undefined,
          address: address.trim() || undefined,
          formData,
          lat: gpsRef.current?.lat,
          lng: gpsRef.current?.lng,
        }),
      });
      const j = await r.json();
      if (!r.ok) {
        const fields = j.fieldErrors
          ? Object.values(j.fieldErrors as Record<string, string>).join(", ")
          : "";
        say(`Submission failed: ${j.error ?? "error"}${fields ? ` — ${fields}` : ""}`);
        return;
      }
      setSubmissionStatus(j.submission?.status ?? "pending");
      setPhase("done");
    } catch {
      say("Could not submit — check your connection. Your captures are safe.");
    } finally {
      setSubmitting(false);
    }
  };

  /* ------------------------------ render ------------------------------ */
  if (phase === "loading") {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-[var(--bg)]">
        <p className="text-sm text-[var(--muted)]">Checking your mapping link…</p>
      </div>
    );
  }

  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col bg-[var(--bg)] text-[var(--fg)]">
      {/* status strip */}
      <div className="flex items-center gap-2 border-b border-[var(--line)] bg-[var(--bg-2)] px-4 py-2.5 text-[11px]">
        <span className="font-display font-semibold">
          {link?.label ?? "Mapping session"}
        </span>
        <span className="ml-auto flex items-center gap-2">
          {gps && (
            <span className={`mwm-badge ${grade?.cls ?? "badge-muted"}`}>
              GPS ±{Math.round(gps.hAccuracy ?? 0)} m {grade?.label}
            </span>
          )}
          <span className={`mwm-badge ${online ? "badge-ok" : "badge-bad"}`}>
            {online ? "Online" : "Offline"}
          </span>
        </span>
      </div>

      {flash && (
        <div className="border-b border-[var(--line)] bg-[var(--accent-soft)] px-4 py-2 text-[12px] text-[var(--accent)]">
          {flash}
        </div>
      )}

      <div className="flex flex-1 flex-col gap-4 p-4">
        {/* WELCOME */}
        {phase === "welcome" && (
          <>
            <h1 className="font-display text-2xl font-semibold leading-snug">
              Help build the 3D map
            </h1>
            <p className="text-[13.5px] leading-relaxed text-[var(--muted)]">
              You've been invited to contribute photographs of this area.
              Everything you capture is processed into a private 3D map — your
              photos are stored privately and never published without review.
            </p>
            {linkError && (
              <p className="mwm-badge badge-bad !my-4 w-full justify-center">
                {linkError}
              </p>
            )}
            {!linkError && (
              <>
                <div className="mwm-panel space-y-1.5 p-3 text-[12.5px]">
                  <p>
                    <span className="text-[var(--muted)]">Scope: </span>
                    {link?.scope === "global"
                      ? "Any location"
                      : link
                        ? `Around the marked area (±${Math.round(link.radiusM)} m)`
                        : "—"}
                  </p>
                  <p>
                    <span className="text-[var(--muted)]">Video: </span>
                    {link?.allowVideo ? "allowed" : "not allowed on this link"}
                  </p>
                  {link?.maxSubmissions != null && (
                    <p>
                      <span className="text-[var(--muted)]">Limit: </span>
                      {link.maxSubmissions - link.usedSubmissions} submissions
                      remaining
                    </p>
                  )}
                  {resumeSessionId && (
                    <p className="text-[var(--accent)]">
                      A previous session was found — it will be resumed.
                    </p>
                  )}
                </div>
                <label className="text-[12px] text-[var(--muted)]">Your name (optional)</label>
                <input
                  className="mwm-input"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Amina"
                  maxLength={80}
                />
                <button type="button" className="mwm-primary mt-1" onClick={beginMapping}>
                  Start Mapping
                </button>
              </>
            )}
          </>
        )}

        {/* LOCATING */}
        {phase === "locating" && (
          <>
            <h1 className="font-display text-xl font-semibold">Getting your position…</h1>
            <div className="mwm-panel flex items-center gap-3 p-4">
              <div className="gps-dot">
                <span />
              </div>
              <div className="text-[12.5px]">
                {gps ? (
                  <>
                    <p className="tabular">
                      {gps.lat.toFixed(6)}, {gps.lng.toFixed(6)}
                    </p>
                    <p className="text-[var(--muted)]">
                      accuracy ±{Math.round(gps.hAccuracy ?? 0)} m
                      {gps.altitude != null && ` · ${Math.round(gps.altitude)} m alt`}
                    </p>
                  </>
                ) : (
                  <p className="text-[var(--muted)]">
                    Waiting for a GPS fix. Open sky helps.
                  </p>
                )}
              </div>
            </div>
            {gps && gps.hAccuracy != null && gps.hAccuracy > 20 && (
              <p className="mwm-badge badge-warn w-full justify-center">
                GPS accuracy is currently insufficient. Please wait or move to an
                area with better GPS reception.
              </p>
            )}
            <button
              type="button"
              className="mwm-primary"
              disabled={!gps}
              onClick={() => setPhase("capture")}
            >
              Begin capture
            </button>
          </>
        )}

        {/* CAPTURE */}
        {phase === "capture" && session && (
          <>
            {/* compass */}
            <div className="mwm-panel relative mx-auto h-40 w-40 p-1">
              <svg viewBox="0 0 200 200" className="h-full w-full">
                {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => {
                  const a0 = ((i * 45 - 22.5 - 90) * Math.PI) / 180;
                  const a1 = (((i + 1) * 45 - 22.5 - 90) * Math.PI) / 180;
                  const r = 88;
                  const d = `M 100 100 L ${100 + r * Math.cos(a0)} ${100 + r * Math.sin(a0)} A ${r} ${r} 0 0 1 ${100 + r * Math.cos(a1)} ${100 + r * Math.sin(a1)} Z`;
                  return <path key={i} data-sector={i} d={d} />;
                })}
                <circle cx="100" cy="100" r="30" fill="var(--panel-solid)" stroke="var(--line)" />
                <path
                  id="compass-needle"
                  d="M100 44 L108 100 L100 112 L92 100 Z"
                  fill="var(--accent)"
                />
                <text x="100" y="26" textAnchor="middle" fontSize="13" fill="var(--muted)">N</text>
                {heading != null && (
                  <text x="100" y="105" textAnchor="middle" fontSize="14" fill="var(--fg)" className="tabular">
                    {Math.round(heading)}°
                  </text>
                )}
              </svg>
              <p className="absolute -bottom-2 left-1/2 -translate-x-1/2 whitespace-nowrap rounded bg-[var(--panel-solid)] px-2 text-[10px] text-[var(--muted)]">
                {coveredArcs.size}/8 sides
              </p>
            </div>

            <p className="rounded-lg bg-[var(--hover)] px-3 py-2 text-center text-[12.5px] leading-snug">
              {guidance}
            </p>
            {session.requestedImagery && (
              <p className="rounded-lg bg-[var(--accent-soft)] px-3 py-2 text-[12px] text-[var(--accent)]">
                The map owner asked: {session.requestedImagery}
              </p>
            )}

            {/* camera */}
            <div className="relative overflow-hidden rounded-xl border border-[var(--line)] bg-black">
              <video
                ref={videoRef}
                playsInline
                muted
                className="h-64 w-full object-cover"
              />
              <label className="absolute bottom-3 left-3 cursor-pointer rounded-md bg-black/60 px-2.5 py-1.5 text-[11px] font-semibold text-white">
                📁 Pick photo
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) pickFile(f);
                    e.target.value = "";
                  }}
                />
              </label>
              {session.allowVideo && (
                <button
                  type="button"
                  onClick={recording ? stopRecording : startRecording}
                  className={`absolute bottom-3 right-3 rounded-md px-2.5 py-1.5 text-[11px] font-semibold ${
                    recording ? "bg-[var(--bad)] text-white" : "bg-black/60 text-white"
                  }`}
                >
                  {recording ? `Stop video ${recSecs}s / 30s` : "● Video"}
                </button>
              )}
            </div>

            <button
              type="button"
              onClick={takePhoto}
              className="mwm-primary !py-3 !text-sm"
            >
              Capture photo
            </button>

            {/* queue */}
            <div className="mwm-panel p-3">
              <div className="flex items-center justify-between text-[11px] text-[var(--muted)]">
                <span>
                  {queue.length} in queue · {done} processed · {processing} in transit
                </span>
                {!online && (
                  <span className="text-[var(--warn)]">Waiting for connection</span>
                )}
              </div>
              <ul className="mt-2 max-h-40 space-y-1 overflow-y-auto">
                {queue.map((i) => (
                  <li key={i.id} className="flex items-center gap-2 text-[11.5px]">
                    <span
                      className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                        i.status === "processed"
                          ? "bg-[var(--ok)]"
                          : i.status === "rejected" || i.status === "failed"
                            ? "bg-[var(--bad)]"
                            : i.status === "queued"
                              ? "bg-[var(--muted)]"
                              : "bg-[var(--warn)]"
                      }`}
                    />
                    <span className="capitalize">
                      {i.kind}{" "}
                      {i.quality && `· sharp ${i.quality.sharpness}`}
                    </span>
                    <span className="ml-auto tabular text-[var(--muted)] capitalize">
                      {i.status === "failed" ? i.error : i.status}
                    </span>
                  </li>
                ))}
              </ul>
            </div>

            <button
              type="button"
              className="mwm-ghost"
              onClick={() => {
                if (processing > 0) say("Please wait for uploads to finish first.");
                else if (!queue.length) say("Take at least one photo before finishing.");
                else setPhase("details");
              }}
            >
              Finish
            </button>
          </>
        )}

        {/* DETAILS (location form + custom form) */}
        {phase === "details" && session && (
          <>
            <h1 className="font-display text-xl font-semibold">
              Tell us about this place
            </h1>
            <p className="text-[12.5px] text-[var(--muted)]">
              {queue.filter((i) => i.status !== "rejected").length} photos attached ·
              position ±{Math.round(gps?.hAccuracy ?? 0)} m
            </p>

            <label className="text-[12px] text-[var(--muted)]">Name / title</label>
            <input
              className="mwm-input"
              value={objName}
              onChange={(e) => setObjName(e.target.value)}
              placeholder="e.g. Kariakoo Shop No. 4"
              maxLength={200}
            />

            <label className="text-[12px] text-[var(--muted)]">Category</label>
            <select
              className="mwm-input"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
            >
              <option value="">Select a category…</option>
              {[
                "building", "house", "shop", "school", "church", "warehouse",
                "landmark", "business", "construction", "property", "infrastructure", "other",
              ].map((c) => (
                <option key={c} value={c}>
                  {c.charAt(0).toUpperCase() + c.slice(1)}
                </option>
              ))}
            </select>

            <label className="text-[12px] text-[var(--muted)]">Address (optional)</label>
            <input
              className="mwm-input"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="Street / area / district"
              maxLength={500}
            />

            <label className="text-[12px] text-[var(--muted)]">Description (optional)</label>
            <textarea
              className="mwm-input"
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Anything useful for the map owner…"
              maxLength={4000}
            />

            {formDef?.fields?.length ? (
              <>
                <p className="mt-2 font-display text-[13px] font-semibold">
                  {formDef.name}
                </p>
                {formDef.fields.map((f) => (
                  <div key={f.key}>
                    <label className="text-[12px] text-[var(--muted)]">
                      {f.label}
                      {f.required && " *"}
                    </label>
                    {f.type === "select" ? (
                      <select
                        className="mwm-input"
                        value={customValues[f.key] ?? ""}
                        onChange={(e) =>
                          setCustomValues((v) => ({ ...v, [f.key]: e.target.value }))
                        }
                      >
                        <option value="">Choose…</option>
                        {(f.options ?? []).map((o) => (
                          <option key={o} value={o}>
                            {o}
                          </option>
                        ))}
                      </select>
                    ) : f.type === "textarea" ? (
                      <textarea
                        className="mwm-input"
                        rows={2}
                        value={customValues[f.key] ?? ""}
                        placeholder={f.placeholder}
                        onChange={(e) =>
                          setCustomValues((v) => ({ ...v, [f.key]: e.target.value }))
                        }
                      />
                    ) : (
                      <input
                        className="mwm-input"
                        type={f.type === "number" ? "number" : "text"}
                        value={customValues[f.key] ?? ""}
                        placeholder={f.placeholder}
                        onChange={(e) =>
                          setCustomValues((v) => ({ ...v, [f.key]: e.target.value }))
                        }
                      />
                    )}
                  </div>
                ))}
              </>
            ) : null}

            <button
              type="button"
              className="mwm-primary mt-2"
              disabled={submitting}
              onClick={() => void submitDetails()}
            >
              {submitting ? "Submitting…" : "Submit contribution"}
            </button>
            <button
              type="button"
              className="mwm-ghost"
              onClick={() => setPhase("capture")}
            >
              Back to camera
            </button>
          </>
        )}

        {/* DONE */}
        {phase === "done" && (
          <>
            <div className="mx-auto mt-8 flex h-16 w-16 items-center justify-center rounded-full bg-[var(--ok)]/15 ring-1 ring-[var(--ok)]/40">
              <svg viewBox="0 0 24 24" className="h-8 w-8 text-[var(--ok)]" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="m5 13 4 4L19 7" />
              </svg>
            </div>
            <h1 className="mt-4 text-center font-display text-2xl font-semibold">
              Contribution received
            </h1>
            <p className="mt-2 text-center text-[13.5px] text-[var(--muted)]">
              {done} of {queue.length} captures fully processed.{" "}
              {queue.length - done > 0 &&
                "The rest will finish processing shortly — you can close this page safely."}
            </p>
            <div className="mwm-panel mt-4 p-3 text-center text-[12.5px]">
              {submissionStatus === "approved" ? (
                <p className="text-[var(--ok)]">
                  This scan is published to the map automatically. Thank you!
                </p>
              ) : (
                <p>
                  Your submission is now{" "}
                  <span className="font-semibold">awaiting review</span> by the map
                  owner. You can close this page — everything is saved.
                </p>
              )}
            </div>
            <div className="mt-6 flex gap-2">
              <Link href="/" className="mwm-ghost flex-1">
                Back to site
              </Link>
            </div>
          </>
        )}
      </div>

      <footer className="px-4 pb-4 pt-2 text-center text-[10.5px] text-[var(--muted)]">
        GPS is graded, never faked — phone accuracy is typically ±3–20 m.
        Overlapping photos make stronger 3D.
      </footer>
    </div>
  );
}
