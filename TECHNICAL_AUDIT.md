# Technical Audit — Independent 3D Mapping Platform

Date: 2026-10-05. Scope: full inspection of the existing codebase ("MyWorld 3D Map", a Next.js 16 + Drizzle + PostgreSQL project) before restructuring. Nothing was removed; everything below was verified by reading the source.

## 1. What already exists and WORKS (real, not mocked)

| Area | Evidence | Status |
|---|---|---|
| Auth | `src/lib/auth.ts` — bcrypt + JWT (jose) session cookie, roles admin/contributor/viewer, register/login/logout/me routes | Real |
| Contributor links | `contributorLinks` table + `src/lib/links.ts` — unguessable 10-char tokens, expiry, submission caps, one-time use, revoke | Real |
| GPS capture | `src/lib/gps.ts` — honest accuracy grading, server-side validation (client GPS never trusted), radius geo-fence | Real |
| Uploads | `src/app/api/captures/route.ts` — magic-byte validation, size caps, local object storage abstraction (`ObjectStorage` interface), signed URLs with HMAC + expiry | Real |
| Image analysis | `src/lib/image.ts` — sharp: EXIF extraction, Laplacian sharpness/blur, brightness, aHash duplicate detection, thumbnails | Real |
| Capture pipeline | `src/lib/pipeline/pipeline.ts` — capture.process (validate → quality → duplicates → thumbnail → group), building.reconstruct, building.publish, video.process | Real |
| Grouping | Geodesic nearest-anchor grouping into `buildings` (35 m radius) | Real |
| Reconstruction | `src/lib/pipeline/engines.ts` — `ReconstructionEngine` + `BuildingDetectionEngine` registries. Built-in geometric estimation engine produces **honest labeled estimates** (`estimated_single_image` / `estimated_multi_view`) with documented confidence scores (`src/lib/confidence.ts`). Remote photogrammetry/neural adapter via `RECON_API_URL` — reports `unconfigured`, never fakes | Real / pluggable |
| Versioning | `buildingVersions` immutable rows, owner-selectable active version | Real |
| Background jobs | `src/lib/pipeline/worker.ts` — Postgres-backed queue, priorities, retries, logs | Real |
| 3D map | `src/components/map/MapView.tsx` — MapLibre GL, satellite/dark/terrain basemaps (keyless Esri/CARTO fallback + optional MapTiler), fill-extrusion 3D buildings, coverage grid tiers, 2D/3D toggle, viewport-scoped GeoJSON (`/api/map/features`) | Real |
| Contributor UX | `src/components/ContributeFlow.tsx` (957 lines) — mobile-first guided 8-arc building photography, compass + GPS-course heading, client-side quality/duplicate pre-checks, **offline queue in localStorage with auto-resume**, upload status polling | Real |
| Review workflow | Admin dashboard + `/api/buildings/[id]/actions` — approve/reject/request-imagery | Real |
| Audit log | `auditLogs` table, recorded on mutations | Real |
| Rate limiting | `src/lib/rate-limit.ts` | Real |
| Tests | `tests/core.test.ts` (vitest) — geo, GPS, confidence, links, auth | Real |
| Docs | README, ARCHITECTURE, API, 3D_RECONSTRUCTION, DATABASE, SECURITY, DEPLOYMENT, ENVIRONMENT, CONTRIBUTING | Exist |

## 2. Partially implemented (works but does not meet spec)

- **Single-tenant**: there is one global map. No `projects` table, no ownership, no per-user isolation. Links/buildings are global; only role=admin gates the dashboard.
- **Scan links**: circle geo-fence only (no polygon/rectangle); no require-login, allow-photos, building-vs-area modes, custom forms, require-approval, or auto-publish options; not tied to a project.
- **Map objects**: buildings only. No generic objects (locations, roads, landmarks, POIs) with point/line/polygon geometry.
- **Submissions**: captures + sessions exist, but there is no first-class *submission* entity carrying the location form (name, category, address, floors, phone, …) that an admin reviews before it becomes a map object.
- **Coverage**: coverage grid tiers exist on the map; no project-level coverage/quality summary endpoint.
- **API surface**: internal same-origin routes only (`/api/*` with session auth). No public versioned API, no API keys, no scopes, no usage tracking.

## 3. Missing entirely (to be built)

1. Map **projects** with multi-tenant ownership, members, and visibility (private/invitation_only/shared/public/api_only).
2. **Developer platform**: API keys (`mk_public_…`/`mk_secret_…`), scopes, `/api/v1/*` public API, usage analytics, developer dashboard, plans/quotas scaffolding.
3. **Custom forms** (flexible JSON-schema forms per project — no schema changes per field).
4. **Submissions** review queue feeding generic **map objects**.
5. **Embeddable maps** (`/embed/{projectId}`) and shareable link routes.
6. **Webhooks** (signed, retried, logged) for scan/building/location/model events.
7. **JavaScript SDK** (real fetch client over the public API).
8. **Python AI service** (FastAPI): real CV endpoints (quality, hashing, EXIF, grouping), optional building detection, photogrammetry orchestration adapter — matching the existing engine contracts (`RECON_API_URL`, `DETECTION_API_URL`).
9. Scan-link UX entry `/scan/{token}` (alias of the contribute flow) with the extended link configuration.

## 4. External dependencies required

| Need | Current | Required |
|---|---|---|
| Map provider | Keyless Esri/CARTO/Terrarium (working); optional MapTiler key | None mandatory |
| Object storage | Local filesystem driver behind `ObjectStorage` interface | S3-compatible driver optional (`STORAGE_DRIVER=s3`) |
| Real photogrammetry | Remote adapter ready; **new Python service included** in this repo (`python-service/`) | COLMAP/OpenMVS binaries or GPU service — optional, reported honestly when absent |
| Database | PostgreSQL (PostGIS migration script ready in `scripts/migrations/0001_postgis.sql`) | PostGIS recommended for production |
| Python AI service | Absent before this audit | FastAPI service (Pillow/numpy CV now; YOLO/COLMAP optional) |

## 5. What requires GPU

Only real photogrammetry (COLMAP/OpenMVS/NeRF/Gaussian splatting) and neural building detection. The platform runs fully without them (estimation engine + honest labels); the Python service detects tool availability at runtime and reports `unconfigured` rather than faking output.

## 6. Database changes required (implemented in this restructuring)

New tables: `projects`, `project_members`, `forms`, `submissions`, `map_objects`, `api_keys`, `api_usage`, `plans`, `webhooks`, `webhook_deliveries`.
Extended: `contributor_links` (project, fence polygon/rect, per-link permissions), `capture_sessions` (project, kind), `buildings` (project, submission, object refs), `processing_jobs` (new job types).

## 7. Risk notes

- `node_modules` was absent — dependencies reinstalled before build.
- No `test` script in package.json (vitest present) — added.
- Schema is drizzle-kit pushed; existing data is preserved via nullable `project_id` columns ("legacy" rows remain admin-visible).
