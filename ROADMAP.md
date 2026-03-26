# GolfMatch GHIN Middleware — Roadmap

**Last Updated:** March 25, 2026  
**Status:** Live GHIN connectivity, cache-to-mirror sync automation, and additive course-name/schema hardening are validated; runtime read-path cutover is next

---

## Phase 1 ✅ (Completed)

### Core Connectivity
- ✅ Live GHIN player lookup wired and validated
- ✅ Live GHIN course search/fetch/tees/holes paths wired and validated
- ✅ Middleware auth, endpoint allowlist, and normalized response shaping are in place

### Cache Foundation
- ✅ Separate cache DB (`golfdb-ghin-cache`) is live
- ✅ Real seeded course flows validated against cache (`1385` and expanded follow-up set)
- ✅ Course location normalization fixed (`CourseCity` / `CourseState`, `US-XX` -> `XX`)

---

## Phase 1.5 ✅ (Validated Checkpoint)

### Mirror Sync and Reconciliation
- ✅ Runtime mirror tables (`GhinRuntimeCourses`, `GhinRuntimeTees`, `GhinRuntimeHoles`) executed and verified
- ✅ Internal callback sync path validated into golfdb mirror
- ✅ Webhook lifecycle validated in sandbox
- ✅ Scheduled reconciliation safety net implemented
- ✅ Deterministic hashing/no-op detection implemented
- ✅ Reconciliation now repairs manual CacheDB drift and backfills missing managed hash fields
- ✅ Seed path now initializes the same managed hash fields as reconciliation

### Naming and Data Integrity
- ✅ `FacilityName` retained as raw GHIN facility name
- ✅ `ShortCourseName` added to cache and runtime mirror and backfilled
- ✅ `CourseName` standardized as composed runtime/app label `<FacilityName> - <ShortCourseName>`
- ✅ Representative verification completed for `14914`, `14917`, and `10820` in both DBs
- ✅ `14916` classified as upstream GHIN data-integrity defect; middleware intentionally fails fast instead of synthesizing missing hole allocation

---

## Phase 2 🔄 (Next — Runtime Read-Path Cutover)

### Golf Match Consumption Cutover
- [ ] Audit GHIN-backed gameplay/admin reads in Golf Match
- [ ] Remove remaining middleware runtime-read dependencies for course/tee/hole serving
- [ ] Prove mirror-first reads use `GhinRuntime*` tables end-to-end
- [ ] Build admin GHIN search/import UX on top of the validated mirror path
- [ ] Keep migration `025_drop_golfdb_ghin_mock_tables.sql` deferred until the validation window passes

---

## Phase 3 📋 (Future — Live Handicap Pulls and Player Caching)

### Player Runtime Data
- [ ] Implement live handicap pull flow for Golf Match games/trips
- [ ] Add player caching strategy for repeated GHIN lookups
- [ ] Add on-demand refresh path and error/status surfacing
- [ ] Monitor quota/rate-limit behavior under real usage

---

## Integration Direction

Golf Match should:

1. Use middleware as the only GHIN/USGA boundary.
2. Use middleware for sync, normalization, validation, and webhook/reconciliation handling.
3. Read GHIN-backed course/tee/hole runtime data from golfdb mirror tables.
4. Avoid direct middleware runtime reads for gameplay once cutover is complete.

---

## Known Decisions

1. Mirror-first runtime serving is locked.
2. Middleware remains the sync/normalization boundary, not the gameplay read authority.
3. No silent repair path is allowed for invalid GHIN course payloads.
4. Gender-based tee selection remains mandatory.
5. Player caching/live handicap pulls are intentionally deferred until after runtime read cutover.

---

## Next Steps

1. [ ] Verify runtime read-path cutover in Golf Match gameplay/admin flows
2. [ ] Build admin GHIN search/import UX
3. [ ] Validate cleanup-window criteria before considering migration 025
4. [ ] Implement Phase 3 live handicap pulls/player caching

