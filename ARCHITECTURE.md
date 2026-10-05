# Architecture

## Stack (and why)

| Layer | Choice | Rationale |
|---|---|---|
| Framework | Next.js (App Router) + TypeScript | Unified server/client, route handlers for REST API, server components for authed pages |
| Database | PostgreSQL + Drizzle ORM | Proper relational + temporal data; prepared statements (SQL-injection safe); target PostGIS (see DATABASE.md) |
| Map engine | **MapLibre GL JS** | Open-source WebGL: `fill-extrusion` 3D buildings, pitch/rotation, keyless raster satellite (Esri World Imagery, maxzoom 17 + transparent labels overlay) and keyless DEM terrain (Terrarium). CesiumJS requires vendor tokens for imagery/terrain and is globe-scale oriented; Leaflet is 2D-only; Google/Mapbox lock private data into vendor clouds. |
| Object storage | Filesystem `ObjectStorage` impl | Interface-first: `src/lib/storage` defines the contract; an S3-compatible driver drops in via `STORAGE_DRIVER` |
| Image processing | `sharp` | Real EXIF, downsampled Laplacian sharpness/brightness, aHash duplicate detection, thumbnails |
| Background jobs | Postgres-backed queue + in-process worker | `processing_jobs` table is the queue; a persistent worker (started at server boot via `instrumentation.ts`) claims jobs, with retries, logs and admin-visible failures. Swap for a distributed claim-token worker in multi-node deployments. |
| Auth | JWT (HS256, `jose`) in httpOnly cookie + `bcryptjs` | Stateless sessions, role claims; rate-limited auth endpoints |

## Module map

```
src/
  app/
    page.tsx                  landing
    map/                      main 2D/3D map (access-gated)
    contribute/[token]/       mobile contributor experience
    admin/                    dashboard + per-building review
    login, register           auth UI
    api/                      REST API (see API.md)
  components/
    map/                      MapView (MapLibre), controls, shell, building panel
    ContributeFlow.tsx        guided capture + offline queue
    admin/AdminDashboard.tsx  operations console
  lib/
    db/                       drizzle client
    schema.ts (src/db)        all tables
    auth.ts                   session, roles, audit helpers
    gps.ts                    fix validation/grading, scope checks
    geo.ts                    geodesy, hulls, footprints, arc coverage
    image.ts                  sharp pipeline (metadata/quality/ahash/thumbs)
    confidence.ts             deterministic confidence scoring
    links.ts                  token generation + link policy checks
    storage/                  ObjectStorage + HMAC signed URLs
    rate-limit.ts             in-memory limiter
    config.ts                 settings (env + DB overlay)
    pipeline/
      engines.ts              ReconstructionEngine / BuildingDetectionEngine registry
      pipeline.ts             job handlers (capture → group → reconstruct → publish)
      worker.ts               queue worker
  instrumentation.ts          starts the worker on server boot
scripts/                      demo seeder, PostGIS migration
docs via root *.md
```

## Data flow

```
Contributor phone
  ├─ GPS watch (graded, honest)          ──┐
  ├─ camera capture + client quality      ──┤  queued locally (offline-safe)
  └─ upload (compressed JPEG/clip + GPS) ──┘
        │
        ▼
POST /api/captures
  validate session+link (server-side) · GPS grade · scope · magic bytes
  store file (object storage) · insert capture + gps_fix · enqueue job
        │
        ▼  worker (async)
capture.process
  extract EXIF · sharpness/brightness · aHash duplicate check
  thumbnail · group → nearest building (18 m) or create building
        │
        ▼
building.reconstruct
  detect (anchor / remote vision) · reconstruct (estimation / remote engine)
  insert immutable version · update building.currentVersion
        │
        ▼
building.publish → map viewport query returns it (bbox-scoped)
```

## Key invariants

- **Server is the source of truth.** The client never claims permissions;
  every link check, scope check and permission check re-runs on the server.
- **Immutable versions.** Reconstructing never destroys data; history is
  browsable and comparable in the review UI.
- **Viewport-only loading.** `/api/map/features` filters by bbox; the browser
  never pulls the whole table.
- **Honest labels.** Every model carries `reconstruction_type`, `engine`,
  `confidence` and `state`; estimated ≠ reconstructed.
