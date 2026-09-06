# USGA course TTL working-set (feature branch)

**Branch:** `feature/usga-course-ttl-working-set`  
**Status:** quiet window open 2026-09-06 (Hold2 off course; tournament tomorrow not on Fore Play; aeration week).  
**Updated:** 2026-09-06 afternoon

See golfmatch `docs/USGA-COURSE-DATA-ARCHITECTURE-PROPOSAL.md`.

## Env flags

| Variable | Default | Cutover value | Meaning |
|---|---|---|---|
| `GHIN_COURSE_CACHE_MODE` | `legacy` | `day-ttl` | Day-boundary `ExpiresAt`; expired = miss |
| `GHIN_RECONCILIATION_SCHEDULE_MODE` | `first-sunday-2am-central` | `disabled` | Stops monthly full-catalog recon scheduler |
| `GHIN_COURSE_DAY_TTL_ZONE` | `America/New_York` | (optional) | Next-midnight expiry zone |
| `GHIN_ALLOW_FULL_RECON` | unset | `1` recovery only | Required to run full-catalog recon while `day-ttl` is on |

## Code landed

- [x] `courseCachePolicy.js`, coalesce `getOrFetchCourse`, webhook invalidate+refetch
- [x] Scheduler `disabled` mode
- [x] `GET /api/v1/courses/:ghinCourseId/working-set`
- [x] Full recon blocked under `day-ttl` unless `GHIN_ALLOW_FULL_RECON=1`

## Remaining (middleware)

- [ ] Flip prod env after merge + playtest
- [ ] Expired-row purge job
- [ ] Partner course-webhook delivery audit
