# API

REST + JSON. Live reference: **`/api/docs`** · Machine spec: **`/api/openapi.json`**.

Auth: `httpOnly` session cookie (`mwm_session`, 12 h JWT). Contributor flows
are token-based and unauthenticated by design.

## Auth

| Method | Path | Notes |
|---|---|---|
| POST | `/api/auth/login` | `{email, password}` → cookie. Rate-limited. |
| POST | `/api/auth/register` | Creates **viewer** accounts only. |
| POST | `/api/auth/logout` | Clears cookie. |
| GET | `/api/auth/me` | Current user or `{user:null}`. |

## Contributor links (admin)

| Method | Path | Notes |
|---|---|---|
| GET | `/api/links` | List all. |
| POST | `/api/links` | `{label, scope, centerLat, centerLng, radiusM, allowVideo, maxSubmissions, oneTime, expiresInDays}` → `{contributeUrl}`. Token: 10 chars from `ABCDEFGHJKLMNPQRSTUVWXYZ23456789`. |
| POST | `/api/links/{id}` | `{action: revoke\|restore\|delete}`. |

## Contributor flow (no account)

| Method | Path | Notes |
|---|---|---|
| GET | `/api/contribute/validate` | `?token=*** Returns link policy + resumable session id. Public, rate-limited. |
| POST | `/api/sessions` | `{token, name, deviceInfo, sessionId?}` → session. Link re-validated server-side; location-scoped links attach outstanding imagery requests. |
| POST | `/api/captures` | `{sessionId, kind, mime, base64, gps{lat,lng,altitude,hAccuracy,vAccuracy,heading,source,deviceTs}}`. Server checks: link alive, video permission, coordinate validity, GPS accuracy (>2× threshold rejected), **geographic scope**, magic bytes, size. Enqueues processing. |
| GET | `/api/captures/{id}` | Progress: `received → processed\|rejected`, quality, GPS grade. |

## Map & catalog

| Method | Path | Notes |
|---|---|---|
| GET | `/api/map/features` | `?bbox=minLng,minLat,maxLng,maxLat&kinds=buildings,captures,coverage` → GeoJSON FeatureCollections, **viewport-scoped only**. |
| GET | `/api/buildings` | `?q=&status=&limit=&offset=` |
| GET | `/api/buildings/{id}` | Dossier: building, all versions, captures (signed URLs), sessions. |
| POST | `/api/buildings/{id}/actions` | Admin: `approve`, `reject`, `reprocess`, `request_imagery` (creates a location-scoped follow-up link and returns its URL), `rename`, `delete`. |
| GET | `/api/search` | In-platform: name / id / coordinate prefix. (Place geocoding is client-side OSM Nominatim.) |
| GET | `/api/files/{key}` | `?exp=&sig=` HMAC-signed downloads. |

## Admin operations

| Method | Path | Notes |
|---|---|---|
| GET | `/api/stats` | Dashboard counts + recent activity. |
| GET | `/api/jobs` | Queue (filter `?status=`). |
| POST | `/api/jobs/{id}/retry` | Re-queue a failed job. |
| GET | `/api/jobs/{id}/logs` | Processing log. |
| GET/POST | `/api/users` | List / create accounts (any role). |
| GET/PUT | `/api/settings` | Platform name, visibility, GPS threshold, multi-view minimum. |
| GET | `/api/audit` | Audit trail. |

## Projects & multi-tenancy

| Method | Path | Notes |
|---|---|---|
| GET/POST | `/api/projects` | List own/member projects · create (name, visibility, center). |
| GET/PATCH/DELETE/PUT | `/api/projects/{id}` | Detail+stats · update · archive · add member. Authorization via `src/lib/tenancy.ts` (owner > editor > contributor > viewer). |
| GET/POST/DELETE | `/api/forms` | Custom form definitions per project (templates: `real_estate`, `logistics`, `agriculture`). |
| GET/POST/PATCH/DELETE | `/api/objects` | Generic map objects (GeoJSON Point/LineString/Polygon). |
| GET/POST | `/api/submissions` | Review queue (`?projectId=&status=`) · finalize a capture session into a submission (custom-form validated server-side). |
| PATCH | `/api/submissions/{id}` | `approve` (creates map object) / `reject` / `needs_imagery` / `note`. |
| GET/POST | `/api/keys` | API keys. The raw secret is returned **exactly once** at creation. |
| POST/GET | `/api/keys/{id}` | `rename`/`rotate`/`restrict`/`expire`/`revoke`/`restore` + usage stats. |
| GET/POST/PATCH/DELETE | `/api/webhooks` | Project webhooks (HMAC-signed deliveries, retries). |

## Public Map API (`/api/v1`) — API-key auth

`Authorization: Bearer mk_secret_…` (server) or `mk_public_…` (browser,
read-only, origin-restricted). Keys are scoped to exactly one project;
cross-project access is impossible. Every call is recorded for usage
analytics and rate-limited per key/plan.

| Method | Path | Scope |
|---|---|---|
| GET | `/api/v1/maps` | `maps:read` |
| GET | `/api/v1/maps/{mapId}` | `maps:read` |
| GET | `/api/v1/maps/{mapId}/buildings` | `buildings:read` |
| GET | `/api/v1/maps/{mapId}/locations` | `locations:read` |
| GET | `/api/v1/maps/{mapId}/models` | `models:read` |
| GET | `/api/v1/maps/{mapId}/coverage` | `maps:read` |
| GET | `/api/v1/buildings/{buildingId}` | `buildings:read` |
| GET | `/api/v1/locations/{locationId}` | `locations:read` |
| GET | `/api/v1/models/{modelId}` | `models:read` |

Scopes: `maps:*`, `buildings:*`, `locations:*`, `models:*`,
`analytics:read` (`:read`/`:write` on each resource). All responses are
real database rows — no fixtures. JavaScript client: `sdk/mymap.js`
(`sdk/README.md`).
