# USGA course TTL working-set (feature branch)

**Branch:** `feature/usga-course-ttl-working-set`  
**Status:** code on branch, pushed; **defaults leave prod unchanged** until flags flip after merge.  
**Updated:** 2026-09-06

See also golfmatch `docs/USGA-COURSE-DATA-ARCHITECTURE-PROPOSAL.md` (full done/remaining checklist).

## Env flags

| Variable | Default | Cutover value | Meaning |
|---|---|---|---|
| `GHIN_COURSE_CACHE_MODE` | `legacy` | `day-ttl` | Day-boundary `ExpiresAt` (Romeo day-cache); expired = miss |
| `GHIN_RECONCILIATION_SCHEDULE_MODE` | `first-sunday-2am-central` | `disabled` | Stops monthly full-catalog recon scheduler |
| `GHIN_COURSE_DAY_TTL_ZONE` | `America/New_York` | (optional) | Timezone for next-midnight expiry |

## Code landed

- [x] `src/services/courseCachePolicy.js`
- [x] `getOrFetchCourse` coalesce + freshness in `courseSyncService.js`
- [x] Webhook: invalidate then refetch (`src/routes/webhooks.js`)
- [x] Scheduler explicit `disabled` (`reconciliationScheduler.js`)
- [x] `GET /api/v1/courses/:ghinCourseId/working-set`

## Remaining (middleware side)

- [ ] Prod env: set `day-ttl` + recon `disabled` after merge
- [ ] Under day-ttl: ensure recon/full-sweep paths do not keep writing national catalog as freshness authority
- [ ] Expired-row purge job (touched working-set only retained)
- [ ] Partner course-webhook delivery audit (ops)

## New endpoint

`GET /api/v1/courses/:ghinCourseId/working-set?refresh=0&mirror=1`

Coalesced on-demand hydrate via `getOrFetchCourse`.

## Webhook

`POST /webhooks/ghin/course` invalidates (`ExpiresAt=now`) then coalesced refetch for that Course ID only.
