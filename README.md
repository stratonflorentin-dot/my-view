# MyView Maps

A **private, multi-tenant, contributor-driven 3D mapping platform**. Create
map projects, invite people around a location with a secure scan link
(`https://YOURDOMAIN.com/scan/ABC123` — works in any phone browser, no app,
no installs); they capture photographs (and video) guided turn-by-turn; an
asynchronous pipeline validates GPS and image quality, groups captures per
building, and produces labeled 3D representations that appear on a
professional 2D/3D map. Approved contributions become map objects exposed
through a real, key-protected Map API with an embeddable viewer and a
JavaScript SDK.

Built as a **standalone platform** — no external branding, business logic or
database is assumed. Clean REST APIs are exposed for integration with other
systems (fleet, GIS, smart-city, navigation, …).

## The core workflow

```
Owner: /dashboard → Create project → Scan Links → Create scan link → Copy
Friend: opens /scan/ABC123 on phone → GPS → guided photos → details → Submit
Server: GPS + fence validation → storage → background processing → submission
Owner: Submissions tab → Approve → object appears on /map (and via API)
```

## Quick start

```bash
cp .env.example .env.local   # then set real secrets
npm install
npx drizzle-kit push         # create schema
npm run dev
```

Optional: the **Python AI service** (real image analysis, grouping, and
optional YOLO/COLMAP integration) lives in `python-service/` — see its
README. The platform runs fully without it.

## What's real, what's pluggable (honest by design)

| Capability | Status |
|---|---|
| Auth (admin/contributor/viewer), roles, sessions | ✅ real |
| **Map projects, multi-tenancy, member roles** | ✅ real |
| **Scan links** (project-scoped, geo-fence circle/rect/polygon, expiry, caps, require-login, media toggles, approval/auto-publish, revoke) | ✅ real |
| GPS capture + honest accuracy grading + server-side fence enforcement | ✅ real |
| Photo/video upload, file validation, signed URLs, offline queue + resume | ✅ real |
| EXIF extraction, sharpness/blur analysis, aHash duplicates | ✅ real (`sharp` + Python service) |
| Capture grouping → building creation (project-scoped) | ✅ real (geodesic) |
| **Submissions + review workflow** (approve → map object, request imagery, reject) | ✅ real |
| **Custom forms** (real estate / logistics / agriculture templates, JSON-validated) | ✅ real |
| **Generic map objects** (buildings, locations, roads, landmarks, POIs — GeoJSON) | ✅ real |
| **Single-photo estimate** (`estimated_single_image`) | ✅ real geometry, honest label + confidence |
| **Multi-view estimate** (`estimated_multi_view`) | ✅ real (hull/arc/overlap metrics + confidence) |
| Photogrammetry / neural / gaussian-splatting mesh | 🔌 `ReconstructionEngine` registry — set `RECON_API_URL` or run `python-service` with COLMAP (contract in `3D_RECONSTRUCTION.md`) |
| Building object detection (height, floors, type) | 🔌 `BuildingDetectionEngine` — anchor detector built-in; YOLO via Python service |
| 3D map (satellite, dark, terrain, extrusion buildings, coverage) | ✅ real (MapLibre GL JS, keyless tiles) |
| Versioning (immutable, owner-selectable active version), audit | ✅ real |
| **Developer platform**: API keys (`mk_public_`/`mk_secret_`), scopes, rate limits, usage analytics | ✅ real |
| **Map API** `/api/v1/*` — real database responses, tenant-isolated | ✅ real |
| **JavaScript SDK** (`sdk/mymap.js`) + **embeddable map** (`/embed/{projectId}`) | ✅ real |
| **Webhooks** (HMAC-signed, retried, logged) | ✅ real |
| Plans/quotas scaffolding (no payment required) | ✅ schema + enforcement points |

The system **never** presents a single photograph as an exact 3D scan, and
engines that are not configured report `unconfigured` — they are never faked.

## Documentation

- `TECHNICAL_AUDIT.md` — audit of the original codebase before restructuring
- `ARCHITECTURE.md` — system design and tech choices
- `SCAN_SYSTEM.md` — the friend scanning system end-to-end
- `DATABASE.md` — schema, multi-tenancy, geospatial strategy
- `API.md` — endpoint reference (also live at `/api/docs`, spec at `/api/openapi.json`)
- `DEVELOPER_GUIDE.md` — owner/developer workflows, replacing platform pieces
- `sdk/README.md` — JavaScript SDK
- `3D_RECONSTRUCTION.md` — engine contract for plugging in photogrammetry/neural services
- `python-service/README.md` — FastAPI CV service
- `SECURITY.md` — threat model and controls
- `DEPLOYMENT.md` — production notes
- `ENVIRONMENT.md` — all environment variables
- `CONTRIBUTING.md` — development workflow

## License

Proprietary — built as an independent, integration-ready platform.
