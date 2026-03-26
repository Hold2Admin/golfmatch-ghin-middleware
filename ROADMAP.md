# GolfMatch GHIN Middleware — Roadmap

**Last Updated:** March 26, 2026  
**Status:** Runtime read-path cutover is validated; state-partition backfill and CacheDB -> GolfDB bulk projection are proven; stage 1 CacheDB batching is the next middleware milestone

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

## Phase 2 🔄 (Current — Catalog Scale Hardening)

### Runtime Cutover and Catalog Population
- [x] Audit GHIN-backed gameplay/admin reads in Golf Match
- [x] Remove remaining middleware runtime-read dependencies for course/tee/hole serving
- [x] Prove mirror-first reads use `GhinRuntime*` tables end-to-end
- [x] Add state-partition course discovery/backfill for unknown GHIN catalog coverage
- [x] Validate split pipeline: stage 1 GHIN -> CacheDB, stage 2 CacheDB -> GolfDB
- [x] Implement and prove CacheDB -> GolfDB bulk projector on real state runs
- [ ] Replace stage 1 per-course CacheDB writes with set-based bulk CacheDB writer
- [ ] Resume broader-state and national backfill with the new stage 1 writer
- [ ] Keep migration `025_drop_golfdb_ghin_mock_tables.sql` deferred until the validation/cleanup window passes

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
5. CacheDB -> GolfDB bulk projection stays as the stage 2 model; the remaining scale fix is a bulk stage 1 CacheDB writer.
6. Player caching/live handicap pulls are intentionally deferred until after catalog population is scale-safe.

---

## Next Steps

1. [ ] Implement the stage 1 bulk CacheDB writer for `GHIN_Courses`, `GHIN_Tees`, and `GHIN_Holes`
2. [ ] Re-run broader-state backfill proving with the new stage 1 writer
3. [ ] Validate cleanup-window criteria before considering migration 025
4. [ ] Implement Phase 3 live handicap pulls/player caching

