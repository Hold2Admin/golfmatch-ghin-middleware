# GolfMatch GHIN Middleware — Roadmap

**Last Updated:** April 16, 2026  
**Status:** Runtime read-path cutover, webhook/reconciliation automation, score posting/readback, staging webhook ingress, and inbox-driven GPA approval are validated. Unknown-coverage catalog fill now has an explicit all-states delta-check execution path, while stage 1 CacheDB writer redesign remains deferred future scaling work rather than the current gate. Production middleware is now isolated on a dedicated Linux App Service plan, `ASP-RGGolfMatch-ghin-middleware-s1` (`Standard S1`), after the old shared-plan startup instability was retired.

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

## Phase 2 🔄 (Current — Staging Readiness Support)

### Approval-Track Runtime Support
- [x] Audit GHIN-backed gameplay/admin reads in Golf Match
- [x] Remove remaining middleware runtime-read dependencies for course/tee/hole serving
- [x] Prove mirror-first reads use `GhinRuntime*` tables end-to-end
- [x] Add state-partition course discovery/backfill for unknown GHIN catalog coverage
- [x] Add all-states `--delta-check` mode for unknown-coverage catalog fill without checkpoint mutation
- [x] Validate split pipeline: stage 1 GHIN -> CacheDB, stage 2 CacheDB -> GolfDB
- [x] Implement and prove CacheDB -> GolfDB bulk projector on real state runs
- [x] Prove large-state staging imports beyond the earlier 999-course concern and separate audit handoff into `manualActionQueue` vs `irrecoverableFailures`
- [x] Prove normalized score posting via `/api/v1/scores/post`
- [x] Prove normalized score readback via `/api/v1/scores/search` and `/api/v1/scores/:scoreId`
- [x] Prove staging webhook ingress after App Service third-party access enablement
- [x] Prove tokenized GPA callback registration and real inbox-driven approval flow
- [x] Document staging course/tee drift as a real-data sync concern, not a runtime-contract blocker
- [ ] Keep migration `025_drop_golfdb_ghin_mock_tables.sql` deferred until the validation/cleanup window passes
- [ ] Support the remaining staging checklist work from a stable middleware boundary

### Deferred Scaling Track
- [ ] Replace stage 1 per-course CacheDB writes with set-based bulk CacheDB writer
- [ ] Resume broader-state and national backfill only when that scaling work becomes active again

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
5. CacheDB -> GolfDB bulk projection stays as the stage 2 model.
6. Bulk stage 1 CacheDB writer redesign is deferred scaling work, not the current release gate.
7. Player caching/live handicap pulls are intentionally deferred until after the current staging-readiness path and evidence capture are complete.
8. Production middleware hosting is now a dedicated-plan concern, not a shared-plan concern with `golfmatch-api` and `golfmatch-web`.

---

## Next Steps

1. [ ] Keep the middleware boundary stable while staging checklist validation continues in Golf Match
2. [ ] Capture any additional staging data-quality findings without introducing hidden runtime fallbacks
3. [ ] Validate cleanup-window criteria before considering migration 025
4. [ ] Revisit the stage 1 bulk CacheDB writer only when catalog-scale tuning becomes active work again
5. [ ] Implement Phase 3 live handicap pulls/player caching after the current staging-readiness path is closed

