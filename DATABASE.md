# Database

PostgreSQL via Drizzle ORM. Schema: `src/db/schema.ts`, applied with
`npx drizzle-kit push` (development) — production should use versioned SQL
migrations (pattern: `scripts/migrations/`).

## Geospatial strategy

**Target: PostGIS.** The production migration
(`scripts/migrations/0001_postgis.sql`) creates `geometry(Point,4326)` /
`geometry(Polygon,4326)` columns with `GIST` indexes.

**This sandbox image ships PostgreSQL without the PostGIS extension**, so the
Drizzle schema stores coordinates as `double precision` (WGS84) and
footprints as GeoJSON `JSONB`. All spatial logic (bbox queries, haversine
grouping, coverage grid) is implemented in `src/lib/geo.ts` and works
identically on both schemas — swapping to PostGIS is a column/type change
plus replacing the bbox filter with `ST_Intersects`, no application-logic
rewrite.

## Tables

| Table | Purpose |
|---|---|
| `users` | Accounts: email, bcrypt hash, role (`admin`\|`contributor`\|`viewer`) |
| `contributor_links` | Public tokens (10-char, unambiguous alphabet — never DB ids), scope (`global`\|`area`\|`location`), center+radius, video permission, one-time, submission caps, expiry, revocation |
| `capture_sessions` | A contributor's run: link token, name, device info, start/finish |
| `captures` | One photo/video: storage key (not the bytes), mime, size, dimensions, EXIF (JSONB, informational), quality metrics (JSONB, measured), full GPS fields, status, duplicate flag, building assignment |
| `gps_fixes` | Discrete fix records with device + server timestamps, accuracy, heading, source |
| `buildings` | Mapped objects: center, altitude, status (`draft`\|`needs_review`\|`approved`\|`rejected`), verification, current version, imagery-request note |
| `building_versions` | **Immutable** reconstruction history: type, engine, state, confidence, footprint (GeoJSON), height/floors/type (nullable = unknown), model/texture URLs, LOD, inputs, metrics, error |
| `processing_jobs` | The queue: type, status, priority, input/output refs, retry count, error, log ref, timing |
| `audit_logs` | Every admin action: actor, action, entity, detail, IP |
| `map_settings` | Runtime settings overlay (platform name, visibility, thresholds) |

## Notes

- Files are **never** in the database — only storage keys; downloads require
  HMAC-signed URLs.
- `captures.gps_*` is the app-recorded location (authoritative). EXIF GPS is
  stored for provenance and the `exifMatch` distance is logged, never trusted.
- Indexes: `token` unique, session/building lookups, job status — add GIST
  geometry indexes per the PostGIS migration in production.
