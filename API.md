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
