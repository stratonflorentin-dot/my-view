# MyWorld 3D Map

A **private, contributor-driven 3D mapping platform**. Invite people around a
location with a secure link; they capture photographs (and video) with their
phones; an asynchronous pipeline validates GPS and image quality, groups
captures per building, and produces labeled 3D representations that appear on
a professional 2D/3D map. The map grows with every contribution.

Built as a **standalone platform** — no external branding, business logic or
database is assumed. Clean REST APIs are exposed for future integration with
other systems (fleet, GIS, smart-city, navigation, …).

## Quick start

```bash
cp .env.example .env.local   # then set real secrets
npm install
npx drizzle-kit push         # create schema
npm run dev
```

Seed a demo fleet of buildings (4-angle capture → multi-view estimate, plus a
single-photo estimate) and an admin account:

```bash
bash scripts/seed-demo.sh
```

Demo login: `admin@myworld.local` / `admin1234`
Demo contributor link: `/contribute/KX7M2Q4V9R`

## What's real, what's pluggable (honest by design)

| Capability | Status |
|---|---|
| Auth (admin/contributor/viewer), roles, sessions | ✅ real |
| Contributor links (token, scope, expiry, caps, revoke) | ✅ real |
| GPS capture + honest accuracy grading | ✅ real |
| Photo/video upload, file validation, signed URLs | ✅ real |
| EXIF extraction, sharpness/blur analysis, aHash duplicates | ✅ real (`sharp`) |
| Capture grouping → building creation | ✅ real (geodesic) |
| **Single-photo estimate** (`estimated_single_image`) | ✅ real geometry, honest label + confidence |
| **Multi-view estimate** (`estimated_multi_view`) | ✅ real (hull/arc/overlap metrics + confidence) |
| Photogrammetry / neural / gaussian-splatting mesh | 🔌 `ReconstructionEngine` registry — set `RECON_API_URL` (contract in `3D_RECONSTRUCTION.md`) |
| Building object detection (height, floors, type) | 🔌 `BuildingDetectionEngine` — anchor detector built-in; remote vision via `DETECTION_API_URL` |
| 3D map (satellite, dark, terrain, extrusion buildings, coverage) | ✅ real (MapLibre GL JS, keyless tiles) |
| Versioning, admin review, imagery requests, audit | ✅ real |
| Offline capture queue + resume | ✅ real (localStorage + re-upload) |

The system **never** presents a single photograph as an exact 3D scan, and
engines that are not configured report `unconfigured` — they are never faked.

## Documentation

- `ARCHITECTURE.md` — system design and tech choices
- `DATABASE.md` — schema, geospatial strategy, migrations
- `API.md` — endpoint reference (also live at `/api/docs`, spec at `/api/openapi.json`)
- `3D_RECONSTRUCTION.md` — engine contract for plugging in photogrammetry/neural services
- `SECURITY.md` — threat model and controls
- `DEPLOYMENT.md` — production notes
- `ENVIRONMENT.md` — all environment variables
- `CONTRIBUTING.md` — development workflow

## License

Proprietary — built as an independent, integration-ready platform.
