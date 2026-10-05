# Scan System

The friend-scanning system: a plain HTTPS web link that anyone can open on
a phone — no app, no Python, no account (unless the link requires one).

## The link

```
https://YOURDOMAIN.com/scan/ABC123
```

`/scan/{token}` and `/contribute/{token}` render the same mobile-first
guided capture flow (`src/components/ContributeFlow.tsx`). Tokens are
10-character, unambiguous-alphabet strings (~46 bits) — never internal ids.

## Data relationship (enforced in the database)

```
Map Project (projects)
  └─ Scan Link (contributor_links.project_id)
       └─ Scan Session (capture_sessions.project_id)
            ├─ Contributor (name / optional user)
            ├─ GPS fixes (gps_fixes) — device + server timestamps
            ├─ Photos / Videos (captures) → object storage
            ├─ Detected Buildings (buildings.project_id)
            ├─ Submission (submissions.project_id) — form + review state
            ├─ Map Object (map_objects.project_id) — created on approval
            └─ 3D Model (building_versions) → map geometry
```

Everything contributed through a link automatically belongs to the link's
project. The grouping pipeline only merges captures within the same
project, and server-side authorization re-checks project membership on
every request.

## Capture flow (what the friend experiences)

1. **Introduction** — what the link is, what happens to the data.
2. **GPS permission** — live fix with honest accuracy grading (±m shown).
3. **Guided photography** — 8 compass arcs (Front → Front-right → … →
   Front-left); the compass shows covered sides, guidance strings nudge:
   "Move around the building", "Capture another angle", "Image quality is
   too low", "GPS accuracy is poor".
4. **Video** — allowed only when the link permits (30 s max, browser codec).
5. **Location form** — name, category, address, description.
6. **Custom form** — the project's configured fields (no schema changes;
   JSON-validated on the server).
7. **Upload** — resumable queue (localStorage) that survives offline
   periods; statuses: Queued → Uploading → Uploaded → Processing →
   Completed / Failed.
8. **Submission** — server creates the reviewable submission; the final
   screen confirms receipt and shows whether review is required.

## Server-side validation (never client-trusted)

- Session/link re-validated on every upload (`checkLink`).
- GPS required (or not) per link; accuracy floor per link
  (`minGpsAccuracyM`) with hard reject beyond 2× threshold.
- Geo-fence enforced server-side: **circle**, **rectangle** or **polygon**
  (`src/lib/fence.ts` ray casting) — "You are outside the permitted
  scanning area."
- File validation: magic bytes (JPEG/PNG/MP4/WebM), size caps
  (12 MB image / 60 MB video).
- Duplicate detection server-side (aHash Hamming ≤ threshold).
- Custom form answers validated against the project's form definition.

## Link configuration (owner dashboard)

| Option | Effect |
|---|---|
| Link name / project | Label + owning map project |
| Target area | Global, area geo-fence, or single location |
| Fence shape | Circle (center+radius), rectangle (bbox), polygon |
| Expiration | Auto-expiry date |
| Max submissions | Hard cap, counted server-side |
| Require login | Only signed-in users can start a session |
| Require GPS / min accuracy | Location quality floor |
| Allow photos / video | Media toggles |
| Allow building / area scan | Session kind gating |
| Require approval | Submissions wait for owner review |
| Auto-publish | Approved status immediately (no review wait) |
| Revoke | Instant, checked on every request |

## Review flow

Owner sees submissions in the project dashboard:
**Approve** → creates a map object (building footprint when the pipeline
has grouped one) and fires `submission.approved` + `location.created`
webhooks. **Request imagery** → flags the submission and the building for
more photographs. **Reject** → recorded with a note; nothing is deleted.
