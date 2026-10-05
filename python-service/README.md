# MyMap Python AI Service

FastAPI computer-vision service for the mapping platform. Modular: each
capability can be swapped for a different implementation without touching
the Node backend.

## Capabilities

| Endpoint | Purpose | Status |
|---|---|---|
| `GET /health` | Capability report | Real |
| `POST /v1/analyze` | Image quality (Laplacian sharpness), brightness, aHash duplicate hash, EXIF | Real (Pillow + numpy) |
| `POST /v1/group` | Geodesic clustering of captures into building groups | Real |
| `POST /v1/detect/building` | Building detection | Optional — YOLO if `ultralytics` installed; otherwise reports `unconfigured` |
| `POST /v1/reconstruct` | Photogrammetry orchestration (COLMAP/OpenMVS) | Optional — probes for binaries; reports `unconfigured` when absent |

The service never fabricates results: unavailable capabilities return
`{"unconfigured": true, "reason": …}`.

## Run

```bash
cd python-service
pip install -r requirements.txt
uvicorn app:app --host 0.0.0.0 --port 8100
```

## Wire into the platform

Set in `.env.local` (Node backend):

```
DETECTION_API_URL=http://localhost:8100/v1/detect/building
RECON_API_URL=http://localhost:8100/v1/reconstruct
```

The Node pipeline's `ReconstructionEngine` / `BuildingDetectionEngine`
registries will call this service automatically (contracts in
`docs/3D_RECONSTRUCTION.md`).

## Replacing components

- Swap YOLO for any detector: edit `detect_building()` (keep the response shape).
- Swap COLMAP for NeRF / Gaussian splatting: edit `reconstruct()` — output
  must include `footprint` and, when available, `modelUrl` (GLB/glTF),
  `heightM`, `floors`, `confidence`.
