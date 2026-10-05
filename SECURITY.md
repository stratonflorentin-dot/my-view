# Security

## Threat model & controls

| Threat | Control |
|---|---|
| Credential stuffing / brute force | bcrypt (cost 10) + per-IP rate limiting on auth (`10/min`) |
| Session hijacking | Short-lived JWT in `httpOnly` + `SameSite=Lax` cookie (Secure in prod); no client-side tokens |
| Privilege escalation | Roles enforced **server-side** on every admin route (`requireRole`); client UI is cosmetic |
| Link abuse | 46-bit unambiguous tokens (no `0/O/1/I`), expiry, submission caps, one-time semantics, revocation — all validated server-side on every capture; internal UUIDs never appear in public URLs |
| Client-trusted permissions | None: link policy, video permission, geographic scope and GPS accuracy are re-checked in `POST /api/captures` |
| Malicious uploads | MIME + **magic-byte** validation, size caps (12 MB photo / 60 MB video), files served only via HMAC-signed, expiring URLs |
| Data exposure | Object storage is not web-public; contributor identity is name-only and not exposed on the public map; map visibility modes (`public` / `invite_only` / `private`) gate both UI and API |
| Injection | Drizzle parameterized queries only; no raw string SQL with user input; HTML rendered by React (no `dangerouslySetInnerHTML` with user data) |
| CSRF | `SameSite=Lax` cookies + JSON content-type checks |
| DoS on upload | Per-IP upload rate limit (`30/min`); worker concurrency is single-lane |
| Supply chain | Native deps limited (`sharp`, `pg`); no client-side eval of untrusted input |
| Auditability | Every admin action (link create/revoke, building approve/reject/delete, user create, visibility change, job retry) is written to `audit_logs` with actor + IP |
| Secrets | All in environment variables (`.env.example` documents each); dev fallbacks are labeled and must be replaced in prod |

## Known boundaries

- Rate limiter is in-memory (single node); front with Redis for multi-node.
- File storage is local disk; production should use S3-compatible storage
  behind the `ObjectStorage` interface (or a CDN).
- HTTPS termination is expected at the proxy (platform provides it).
