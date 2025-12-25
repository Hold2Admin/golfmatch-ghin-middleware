# GolfMatch GHIN Middleware — Roadmap

**Last Updated:** December 25, 2025  
**Status:** Phase 1 Complete; Phase 2 Planned (Nightly GHIN Sync)

---

## Phase 1 ✅ (Completed)

### Courses Feature
- ✅ Mock data: Cedar Ridge GC (GHIN-54321, Boulder CO) with 4 tees (Blue M/W defaults, White M/W), all with complete 18-hole baselines
- ✅ Endpoint: `GET /api/v1/courses/state/:state` — List courses by state
- ✅ Endpoint: `GET /api/v1/courses/:ghinCourseId/tees` — Fetch tees with isDefault flag, ratings, slope, par, yardage
- ✅ Endpoint: `GET /api/v1/courses/:ghinCourseId/holes?teeId=:teeId&gender=:gender` — Fetch 18-hole baseline for tee+gender
- ✅ Database schema: Courses, Tees, CourseDefaults, HoleDefaults, HoleOverrides, TeeRatings (all defined, exported)
- ✅ Documentation: MIDDLEWARE-ARCHITECTURE.md with full integration guide

### Players Feature (Mock)
- ✅ Mock data: Clayton Cobb (GHIN 1234567, M, HI 9.4), Michael Draskin (2345678, M, +1.0), Ryan Kayton (3456789, M, 2.3)
- ✅ Endpoint: `POST /api/v1/players/search` — GHIN member lookup (returns gender, handicap index, club, status, etc.)
- ✅ Documentation: Full player integration flow, gender-based tee selection

---

## Phase 2 🔄 (Planned — Nightly GHIN Sync)

### Course Data Synchronization
- [ ] Background job scheduler (nightly, e.g., 2 AM UTC)
- [ ] Live GHIN API client integration (replace mock ghinClient)
- [ ] SHA256 change detection for course/tee/hole data
- [ ] Upsert procedures:
  - `usp_CreateCourseWithDefaults` — Insert new course + auto-populate defaults
  - `usp_AddTeeForCourseWithRatings` — Add tee variant with ratings
  - `usp_ReplaceHoleDefaultsByGender` — Atomically replace hole defaults
  - `usp_ApplyHoleDefaultsToAllTeesByGender` — Auto-populate non-default tees
- [ ] Logging & alerting (Application Insights) for sync success/failure
- [ ] Rollback strategy if GHIN API data is invalid
- [ ] Rate limiting to respect GHIN API quotas

### Deliverables
- Nightly job runs autonomously; middleware always serves fresh course data
- No manual intervention needed for course updates
- Change detection prevents unnecessary DB writes

---

## Phase 3 📋 (Future — Player Index Caching)

### Player Handicap Index Synchronization
- [ ] Background job to sync active players' index from GHIN API
- [ ] Redis cache with IsUpdated flag (not fixed TTL)
  - Check flag daily; if not updated, reuse cached index
  - If updated, pull fresh from GHIN API
- [ ] Endpoint: `POST /api/v1/players/refresh` — On-demand player index update
- [ ] Rate limiting & quota management for GHIN player API calls
- [ ] Fallback to live GHIN API on cache miss
- [ ] Logging for cache hits/misses

### Deliverables
- Player index cached efficiently without blind expiration
- Fore Play can refresh player data on-demand or rely on daily cache sync
- Minimizes live GHIN API calls for frequently-used players

---

## Testing & Integration

### Phase 1 Testing (Current — Courses Standalone)
**No golfmatch-api integration needed.** Test endpoints directly via REST client.

**Setup:**
```bash
npm run dev
./scripts/gm.ps1
Set-GmKey
```

**Test Courses Feature:**
```bash
# List Colorado courses
gmx-local /api/v1/courses/state/CO
# Expected: Cedar Ridge (GHIN-54321) + others

# Fetch tees for Cedar Ridge
gmx-local /api/v1/courses/GHIN-54321/tees
# Expected: Blue M (default), Blue W (default), White M, White W
# with isDefault: true/false flags, ratings, slope, yardage

# Fetch hole baseline (Blue tee, Male)
gmx-local "/api/v1/courses/GHIN-54321/holes?teeId=GHIN-TEE-1001&gender=M"
# Expected: 18 holes with par, handicap, yardage
```

**Test Players Feature:**
```bash
# Search player by GHIN number
gmx-local /api/v1/players/search -Method POST -Body '{"ghinNumber":"1234567"}'
# Expected: Clayton Cobb (M, HI 9.4)

gmx-local /api/v1/players/search -Method POST -Body '{"ghinNumber":"2345678"}'
# Expected: Michael Draskin (M, HI +1.0)
```

### Phase 2+ Integration (golfmatch-api)
**When Phase 2 is complete,** golfmatch-api will:

1. Call `GET /api/v1/players/search` → get player gender
2. Call `GET /api/v1/courses/state/:state` → list available courses
3. Call `GET /api/v1/courses/:courseId/tees` → fetch tees for player's gender
4. Call `GET /api/v1/courses/:courseId/holes?teeId=:teeId&gender=:gender` → fetch hole baselines
5. Upsert course/tees/defaults/holes into golfmatch-api's own `golfdb` tables
6. Use cached data for all future rounds

**No live GHIN API calls per-user—all data cached locally.**

**Integration Design Document:** To be created in Phase 2 (TBD).

---

## Known Decisions

1. **Courses feature is complete** — no additional work needed for Phase 1
2. **Players search is mock-only** — real GHIN API integration in Phase 3
3. **Player handicap INDEX cached** (Phase 3, uses IsUpdated flag)
4. **Gender-based tee selection critical** — always filter by player gender
5. **No live GHIN calls per-user** — all data cached locally; nightly sync keeps it fresh

---

## Next Steps

1. ✅ **Test Phase 1 endpoints** (standalone, no integration) ← You are here
2. [ ] **Design Phase 2 nightly sync** (GHIN API integration, upsert procedures)
3. [ ] **Create Phase 2 integration guide** (how golfmatch-api calls and caches)
4. [ ] **Plan Phase 3** (player index caching with IsUpdated flag)

