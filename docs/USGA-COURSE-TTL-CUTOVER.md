# USGA course TTL working-set (feature branch)

Default behavior is unchanged until env flags are flipped after merge.

## Env flags

| Variable | Default | Cutover value | Meaning |
|---|---|---|---|
| `GHIN_COURSE_CACHE_MODE` | `legacy` | `day-ttl` | Day-boundary `ExpiresAt` (Romeo day-cache); expired = miss |
| `GHIN_RECONCILIATION_SCHEDULE_MODE` | `first-sunday-2am-central` | `disabled` | Stops monthly full-catalog recon scheduler |
| `GHIN_COURSE_DAY_TTL_ZONE` | `America/New_York` | (optional) | Timezone for next-midnight expiry |

## New endpoint

`GET /api/v1/courses/:ghinCourseId/working-set?refresh=0&mirror=1`

Coalesced on-demand hydrate via `getOrFetchCourse`.

## Webhook

`POST /webhooks/ghin/course` now invalidates (`ExpiresAt=now`) then coalesced refetch for that Course ID only.
