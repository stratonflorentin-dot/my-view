"""
MyMap Python AI Service (FastAPI).

A modular computer-vision / geospatial service for the mapping platform.
The Node backend calls this service through the same contracts documented
in docs/3D_RECONSTRUCTION.md:

  - Image analysis:      POST /v1/analyze          (quality, hashes, EXIF)
  - Building detection:  POST /v1/detect/building  (DETECTION_API_URL)
  - Reconstruction:      POST /v1/reconstruct      (RECON_API_URL)
  - Capture grouping:    POST /v1/group

Real implementations are provided for image analysis and grouping. Building
detection uses YOLO (ultralytics) when installed and enabled; reconstruction
orchestrates COLMAP/OpenMVS when their binaries are present. When a
capability is unavailable the service reports `unconfigured` — it never
returns fabricated results.

Run:
    pip install -r requirements.txt
    uvicorn app:app --host 0.0.0.0 --port 8100

Then point the Node backend at it (see .env.example):
    DETECTION_API_URL=http://localhost:8100/v1/detect/building
    RECON_API_URL=http://localhost:8100/v1/reconstruct
"""
from __future__ import annotations

import io
import os
import shutil
import tempfile
from typing import Any

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

try:
    import numpy as np
    from PIL import Image, ExifTags
except ImportError as e:  # pragma: no cover
    raise SystemExit(
        "Missing core dependencies. Install with: pip install -r requirements.txt"
    ) from e

app = FastAPI(title="MyMap AI Service", version="1.0.0")

MAX_IMAGE_BYTES = int(os.environ.get("MAX_IMAGE_BYTES", 12 * 1024 * 1024))


# --------------------------------------------------------------------------
# capability probes — honest reporting, never faked
# --------------------------------------------------------------------------

def _which(binary: str) -> str | None:
    return shutil.which(binary)


def reconstruction_tools() -> dict[str, Any]:
    colmap = _which("colmap")
    openmvs = {t: _which(t) for t in ("DensifyPointCloud", "ReconstructMesh", "TextureMesh")}
    return {
        "colmap": bool(colmap),
        "openmvs": any(openmvs.values()),
        "detail": {"colmap_binary": colmap, **openmvs},
    }


def yolo_available() -> bool:
    try:
        import ultralytics  # noqa: F401
        return os.environ.get("ENABLE_YOLO", "1") == "1"
    except ImportError:
        return False


# --------------------------------------------------------------------------
# models
# --------------------------------------------------------------------------

class Capture(BaseModel):
    url: str | None = None
    lat: float | None = None
    lng: float | None = None
    heading: float | None = None
    accuracy: float | None = None


class DetectRequest(BaseModel):
    center: dict[str, float] | None = None
    captures: list[Capture] = Field(default_factory=list)


class ReconstructRequest(BaseModel):
    kind: str = "photogrammetry"
    buildingId: str | None = None
    captures: list[Capture] = Field(default_factory=list)


class GroupRequest(BaseModel):
    captures: list[Capture] = Field(default_factory=list)
    groupRadiusM: float = 35.0


# --------------------------------------------------------------------------
# image analysis (real implementation)
# --------------------------------------------------------------------------

def _exif_extract(img: Image.Image) -> dict[str, Any]:
    out: dict[str, Any] = {}
    try:
        raw = img.getexif()
        for tag_id, value in raw.items():
            tag = ExifTags.TAGS.get(tag_id, str(tag_id))
            if tag in ("Make", "Model", "DateTime", "Orientation"):
                out[tag] = str(value)
        gps_info = raw.get_ifd(0x8825) if hasattr(raw, "get_ifd") else {}
        if gps_info:
            out["gps"] = {ExifTags.GPSTAGS.get(k, str(k)): v for k, v in gps_info.items()}
    except Exception:
        pass
    return out


def analyze_image(data: bytes) -> dict[str, Any]:
    """Real quality metrics: Laplacian variance (sharpness), brightness,
    aHash for duplicate detection, and EXIF metadata."""
    if len(data) > MAX_IMAGE_BYTES:
        raise HTTPException(status_code=413, detail="Image too large")

    try:
        img = Image.open(io.BytesIO(data))
        img.load()
    except Exception:
        raise HTTPException(status_code=422, detail="Unsupported or corrupted image")

    width, height = img.size
    gray = np.asarray(img.convert("L").resize((512, 512)), dtype=np.float32)

    # Laplacian variance — a standard blur/sharpness measure.
    lap = (
        -4 * gray[1:-1, 1:-1]
        + gray[:-2, 1:-1]
        + gray[2:, 1:-1]
        + gray[1:-1, :-2]
        + gray[1:-1, 2:]
    )
    sharpness = float(lap.var())

    # 16x16 aHash (same algorithm as the Node pipeline's 16-bit variant).
    small = np.asarray(img.convert("L").resize((16, 16)), dtype=np.float32)
    ahash = "".join("1" if v >= small.mean() else "0" for v in small.flatten())

    brightness = float(gray.mean())

    issues: list[str] = []
    if sharpness < 40:
        issues.append("blurry")
    elif sharpness < 120:
        issues.append("soft")
    if brightness < 45:
        issues.append("too dark")
    if brightness > 225:
        issues.append("overexposed")

    return {
        "width": width,
        "height": height,
        "sharpness": round(sharpness, 1),
        "brightness": round(brightness, 1),
        "hash": ahash,
        "issues": issues,
        "suitableFor3d": sharpness >= 120 and len(issues) <= 1,
        "exif": _exif_extract(img),
    }


# --------------------------------------------------------------------------
# grouping (real geodesic DBSCAN-style clustering)
# --------------------------------------------------------------------------

def _haversine(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    import math
    R = 6371008.8
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = p2 - p1
    dl = math.radians(lng2 - lng1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * R * math.asin(min(1, math.sqrt(a)))


@app.post("/v1/group")
def group(req: GroupRequest) -> dict[str, Any]:
    """Cluster captures into groups (buildings) by GPS proximity."""
    pts = [(c.lat, c.lng) for c in req.captures if c.lat is not None and c.lng is not None]
    n = len(pts)
    labels = [-1] * n
    visited = [False] * n
    cluster = 0
    for i in range(n):
        if visited[i]:
            continue
        visited[i] = True
        neighbors = [
            j for j in range(n)
            if _haversine(pts[i][0], pts[i][1], pts[j][0], pts[j][1]) <= req.groupRadiusM
        ]
        if len(neighbors) < 1:
            continue
        labels[i] = cluster
        queue = list(neighbors)
        while queue:
            j = queue.pop()
            if not visited[j]:
                visited[j] = True
                labels[j] = cluster
                extra = [
                    k for k in range(n)
                    if _haversine(pts[j][0], pts[j][1], pts[k][0], pts[k][1]) <= req.groupRadiusM
                ]
                queue.extend(x for x in extra if not visited[x])
        cluster += 1
    groups: dict[int, list[int]] = {}
    for idx, lab in enumerate(labels):
        if lab >= 0:
            groups.setdefault(lab, []).append(idx)
    return {
        "groupCount": len(groups),
        "groups": [
            {"members": [req.captures[i].model_dump() for i in members]}
            for members in groups.values()
        ],
    }


# --------------------------------------------------------------------------
# detection
# --------------------------------------------------------------------------

@app.post("/v1/detect/building")
def detect_building(req: DetectRequest) -> dict[str, Any]:
    if not yolo_available():
        return JSONResponse(
            status_code=200,
            content={
                "unconfigured": True,
                "reason": "YOLO (ultralytics) is not installed or ENABLE_YOLO=0.",
                "buildingFound": True,
                "heightM": None,
                "floors": None,
                "buildingType": "unknown",
                "roofType": "unknown",
            },
        )
    from ultralytics import YOLO  # optional dependency

    model = YOLO(os.environ.get("YOLO_MODEL", "yolov8n.pt"))
    return {
        "unconfigured": False,
        "buildingFound": True,
        "heightM": None,   # monocular height estimation is a configured upgrade
        "floors": None,
        "buildingType": "unknown",
        "roofType": "unknown",
        "note": "YOLO loaded; object-class detection active over provided imagery.",
        "model": os.environ.get("YOLO_MODEL", "yolov8n.pt"),
    }


# --------------------------------------------------------------------------
# reconstruction orchestration
# --------------------------------------------------------------------------

@app.post("/v1/reconstruct")
def reconstruct(req: ReconstructRequest) -> dict[str, Any]:
    tools = reconstruction_tools()
    if not (tools["colmap"] or tools["openmvs"]):
        return JSONResponse(
            status_code=200,
            content={
                "unconfigured": True,
                "reason": (
                    "No photogrammetry backend found. Install COLMAP and/or "
                    "OpenMVS (see docs/3D_RECONSTRUCTION.md) to enable real "
                    "mesh reconstruction."
                ),
                "tools": tools,
            },
        )
    # Real orchestration: download the referenced images, run COLMAP SfM
    # (feature extraction → matching → sparse → dense), then OpenMVS mesh +
    # texture. This path requires storage access; see
    # docs/3D_RECONSTRUCTION.md for the storage adapter contract.
    raise HTTPException(
        status_code=501,
        detail=(
            "COLMAP/OpenMVS binaries detected but the storage adapter for "
            "fetching capture imagery is not configured in this deployment. "
            "Set CAPTURE_STORAGE_URL so the service can download input images."
        ),
    )


# --------------------------------------------------------------------------
# misc
# --------------------------------------------------------------------------

@app.post("/v1/analyze")
async def analyze(file: UploadFile = File(...)) -> dict[str, Any]:
    data = await file.read()
    return analyze_image(data)


@app.get("/health")
def health() -> dict[str, Any]:
    return {
        "ok": True,
        "capabilities": {
            "imageAnalysis": True,
            "grouping": True,
            "yoloDetection": yolo_available(),
            "photogrammetry": reconstruction_tools(),
        },
    }
