# GolfMatch GHIN Middleware — Architecture & Integration Guide

**Last Updated:** March 28, 2026  
**Project:** `golfmatch-ghin-middleware` (Node.js 20.x + Express)  
**Status:** Active development — mirror-first runtime cutover, state-partition backfill, cache-to-mirror sync automation, additive course-name/schema hardening, full sandbox-accessible catalog projection into golfdb runtime, and the normalized GHIN score-posting plus score-readback boundary are validated; approval-track work is now centered on staging-readiness follow-through, not more runtime cutover speculation

---

## 1. Project Purpose

The **GHIN Middleware** is a dedicated API layer that bridges **Fore Play (golfmatch-api)** with the **GHIN course management system**. It is **not** a replacement for Fore Play's core database; it is a **satellite service** that:

1. **Caches GHIN course/tee/hole data** locally in Azure SQL (`golfdb-ghin-cache` — Phase 1.5+)
2. **Exposes normalized endpoints** for Fore Play to fetch course baselines and player handicaps
3. **Runs webhook-triggered and callback-driven sync** (with scheduled reconciliation safety net)
4. **Eliminates per-user GHIN API calls** during search/play workflows (cost optimization)
5. **Supports future direct GHIN API integration** without changing Fore Play's architecture

**Key Principle:** Fore Play never calls GHIN directly. All GHIN data flows through middleware.

**Phase 1.5+ Architecture Change (March 2026):** Migrated from single-database design to **two-database architecture**:
- **`golfdb`** — Fore Play canonical application database (UserProfiles, GlobalRoster, Events, Courses, Tees, course metadata)
- **`golfdb-ghin-cache`** — Separate production GHIN cache database (GHIN_Courses, GHIN_Tees, GHIN_Holes with extended schema)
- **Runtime mirror in golfdb** — `GhinRuntimeCourses`, `GhinRuntimeTees`, `GhinRuntimeHoles` are the locked runtime serving model for GHIN-backed course reads
- **Bridge table note** — `GhinCourseMapping` exists from earlier design and is retained pending audit before any cleanup/removal

### Current validated progress (Updated Mar 27, 2026)

- Cache DB seed and smoke flow validated with real GHIN course `1385` (search -> tees -> holes).
- Course location normalization was corrected: read `CourseCity` / `CourseState` from GHIN payload and normalize state `US-XX` -> `XX`.
- Cache refresh now preserves city/state correctly for the validated seed course.
- Internal callback sync is implemented and validated: middleware sends normalized payloads to `POST /api/internal/ghin-import-callback`, and golfdb mirror writes are atomic/idempotent.
- Webhook lifecycle is validated in sandbox (`ensure`, `test`, `status`, `list`) and scheduled reconciliation is implemented as the safety-net path.
- Reconciliation now repairs manual CacheDB drift correctly and backfills deterministic managed hash fields on no-op matches.
- Seed path now initializes the same deterministic hash fields as reconciliation, so fresh seeds and later syncs are parity-safe.
- Additive schema hardening is complete: `ShortCourseName` is now persisted in both cache and golfdb runtime mirror, while `CourseName` is the composed runtime/app label `<FacilityName> - <ShortCourseName>`.
- Representative multi-course verification completed in both DBs for `14914`, `14917`, and `10820`.
- Known explicit source-data blocker remains `14916`: GHIN omits hole `Allocation`, and middleware intentionally fails fast rather than synthesizing invalid data.
- State-partition discovery/backfill is implemented to enumerate unknown GHIN course IDs before sync.
- The pipeline is now split cleanly: stage 1 validates and writes canonical GHIN data into CacheDB, and stage 2 bulk-projects CacheDB rows into golfdb runtime tables.
- Multi-state proving confirmed the stage 2 bulk projector is fast enough.
- Full sandbox-accessible catalog loading is now proven for the approval track: CacheDB holds the sandbox-accessible course set, the default `all-US` backfill scope was widened to current GHIN US jurisdictions, and bulk projection into an empty golfdb runtime target completed successfully.
- Sandbox course-discovery limitations are understood and explicitly treated as sandbox behavior limits, not active middleware defects.
- Bulk stage 1 CacheDB writer work remains a future scaling task, but it is no longer a gate before the standalone staging-readiness checklist path.
- Score readback/search is now proven end to end for the approval track: Golf Match consumes middleware `/api/v1/scores/search` and `/api/v1/scores/:scoreId` to power the Profile `Handicap` scoring-record experience and scorecard deep-link path.
- Live sandbox contract capture is now documented as authoritative for score readback: GHIN score search currently returns a top-level `Scores` wrapper, while GHIN score detail currently returns a nested `scores` object. Golf Match app-side normalization was corrected against those real payloads rather than assumed naming consistency.

---

## 2. Integration with golfmatch-api (Fore Play)

### 2.1 Current Workflow (Phase 1.5+)

```
Fore Play Frontend (Vite @ localhost:5173)
  ↓
golfmatch-api (Node.js @ localhost:5000 or Azure)
  ↓
Call Middleware Endpoints:
  • POST /api/v1/courses/search            (search by name/city/state/country)
  • GET /api/v1/courses/:ghinCourseId      (full course snapshot)
  • GET /api/v1/courses/state/:state       (list courses by state)
  • GET /api/v1/courses/:courseId/tees     (fetch tees for a course)
  • GET /api/v1/courses/:courseId/holes    (fetch hole baselines for tee+gender)
  • GET /api/v1/scores/search              (official GHIN scoring-record search)
  • GET /api/v1/scores/:scoreId            (official GHIN single-score readback)
  ↓
golfmatch-ghin-middleware (Azure App Service)
  ↓
┌─ Azure SQL: golfdb (Fore Play canonical DB) ─────────┬─ Azure SQL: golfdb-ghin-cache (Production GHIN Cache) ─┐
│                                                        │                                                         │
├─ Courses table                                        │ ├─ GHIN_Courses (courseId, facilityId, facilityName,   │
├─ Tees table (per-gender variants)                     │ │        state, country, cachedAt, expiresAt, ...) ✓  │
├─ CourseDefaults table (gender-aware defaults)         │ ├─ GHIN_Tees (teeId, courseId, teeName,              │
├─ HoleDefaults table (default tee hole baselines)      │ │        teeSetSide[F9|B9|All18], courseRating18,     │
├─ HoleOverrides table (non-default tee customizations) │ │        courseRatingF9, courseRatingB9,              │
├─ GhinCourseMapping (bridge: GHIN IDs ↔ Golf Match IDs)│ │        slopes per side, par/yardage, cachedAt, ...) │
├─ UserProfiles (metadata + GPA consent tracking)       │ ├─ GHIN_Holes (teeId, holeNumber, par, handicap,      │
└─ GlobalRoster (metadata + identity verification)      │ │        yardage)                                      │
                                                        │ └─ Indexes: state, facility, courseId, teeSetSide,    │
                                                        │           expiry (TTL), gender, ...                    │
                                                        └────────────────────────────────────────────────────────┘
```

**Key Change (Phase 1.5):** Separate cache DB isolates GHIN data from Golf Match core tables.
**Key Runtime Decision (Mar 25, 2026):** GHIN-backed gameplay reads are served from golfdb mirror tables (`GhinRuntimeCourses`, `GhinRuntimeTees`, `GhinRuntimeHoles`), not direct middleware runtime reads.

### 2.2 Endpoints for golfmatch-api

#### Search Courses (Primary)
```
POST /api/v1/courses/search

Request Body:
{
  "courseName": "hangman",
  "state": "WA"
}

Response:
{
  "results": [
    {
      "ghinCourseId": "1385",
      "courseName": "Hangman Valley Golf Course",
      "city": "Spokane",
      "state": "WA"
    }
  ],
  "totalResults": N
}
```

#### Fetch Full Course Snapshot
```
GET /api/v1/courses/:ghinCourseId
```

#### List Courses by State
```
GET /api/v1/courses/state/:state

Response:
{
  "results": [
    {
      "ghinCourseId": "GHIN-54321",
      "courseName": "Cedar Ridge Golf Club",
      "city": "Boulder",
      "state": "CO",
      "holes": 18
    }
  ],
  "totalResults": N
}
```

#### Fetch Tees for a Course
```
GET /api/v1/courses/:ghinCourseId/tees

Response:
{
  "courseId": "GHIN-54321",
  "tees": [
    {
      "ghinTeeId": "GHIN-TEE-1001",
      "teeName": "Blue",
      "gender": "M",
      "courseRating": 71.4,
      "slope": 136,
      "par": 72,
      "yardage": 6400,
      "isDefault": true
    },
    {
      "ghinTeeId": "GHIN-TEE-1002",
      "teeName": "Blue",
      "gender": "W",
      "courseRating": 70.1,
      "slope": 125,
      "par": 72,
      "yardage": 5900,
      "isDefault": true
    },
    {
      "ghinTeeId": "GHIN-TEE-1003",
      "teeName": "White",
      "gender": "M",
      "courseRating": 69.8,
      "slope": 132,
      "par": 72,
      "yardage": 6100,
      "isDefault": false
    }
  ]
}
```

#### Fetch Hole Baselines for a Tee+Gender
```
GET /api/v1/courses/:ghinCourseId/holes?teeId=:teeId&gender=:gender

Response:
{
  "courseId": "GHIN-54321",
  "teeId": "GHIN-TEE-1001",
  "gender": "M",
  "holes": [
    { "holeNumber": 1, "par": 4, "handicap": 9, "yardage": 380 },
    { "holeNumber": 2, "par": 4, "handicap": 3, "yardage": 410 },
    ...
    { "holeNumber": 18, "par": 5, "handicap": 4, "yardage": 520 }
  ]
}
```

### 2.3 Player Search Endpoint

Fore Play uses player search to verify GHIN membership, fetch handicap index, and associate golfers with their official GHIN records.

#### Search Players by GHIN Number or Name
```
POST /api/v1/players/search

Request Body:
{
  "ghinNumber": "1234567"                    // exact GHIN member number
  // OR
  "firstName": "Clayton",
  "lastName": "Cobb"                         // fuzzy name match (future)
}

Response:
{
  "players": [
    {
      "ghinNumber": "1234567",
      "firstName": "Clayton",
      "lastName": "Cobb",
      "email": "clayton@example.com",
      "clubName": "Cedar Ridge Golf Club",
      "clubId": "12345",
      "associationId": "MGA",                 -- USGA regional association
      "handicapIndex": "9.4",                 -- most recent (as of last revision)
      "lowHandicapIndex": 8.2,
      "trendIndicator": "+",                  -- increasing (+), stable (=), decreasing (-)
      "lastRevisionDate": "2025-12-20T08:00:00Z",
      "gender": "M",                          -- 'M' or 'W' — drives tee selection
      "status": "active"
    }
  ]
}
```

**Mock Players (for testing):**
1. **Clayton Cobb** (GHIN 1234567) — Male, Cedar Ridge GC, HI 9.4
2. **Michael Draskin** (GHIN 2345678) — Male, Swan Lake GC, HI +1.0 (scratch golfer)
3. **Ryan Kayton** (GHIN 3456789) — Male, Forty Niners GC, HI 2.3

See [src/mocks/ghinData.js](src/mocks/ghinData.js) for full mock data.

**Integration with Course Selection:**
- Fore Play calls `/api/v1/players/search` with GHIN number → receives player gender
- Uses player gender to pre-select default tee when fetching `/api/v1/courses/:courseId/tees`
- Example: If Clayton (M) selects Cedar Ridge, fetch Blue M tee defaults automatically

### 2.4 Integration Flow in golfmatch-api

**Current Runtime Workflow (mirror-first):**
1. **User enters GHIN number** → calls middleware `POST /api/v1/players/search`
   - Returns: gender, handicap index, association, etc.
   - golfmatch-api stores this in `Players` table (or session)
2. **User searches courses** → calls middleware `POST /api/v1/courses/search`
  - Returns: matching courses (course/city/state)
3. **User selects course** → gameplay path reads from golfdb mirror (`GhinRuntime*` tables)
  - Middleware remains sync/normalization boundary, not the gameplay runtime read source
4. **If course is stale/missing in mirror**, sync path is triggered (callback/webhook/reconciliation implemented)
  - Middleware fetches from GHIN and normalizes deterministic payload
  - Golf Match API upserts mirror rows atomically
5. **User selects tee** → golfmatch-api returns mirror tee options
   - Returns: tees for Cedar Ridge; **pre-filter to player's gender** (e.g., show Blue M + White M for males)
6. **Fore Play creates Round** with:
   - Player: Clayton Cobb (GHIN 1234567, HI 9.4, M)
  - Course: mirrored GHIN course row (`GhinCourseId`)
  - Tee: mirrored GHIN tee row (`GhinTeeId`)
   - Hole baselines: 18 holes with par/handicap

**Current implementation note:** automated callback/webhook/reconciliation sync into golfdb mirror tables is implemented and validated, and GHIN-backed gameplay/admin reads now resolve from `GhinRuntime*` rather than middleware runtime reads. The next middleware implementation step is replacing per-course CacheDB writes with a set-based stage 1 bulk writer so full-catalog backfill can run at national scale.

---

## 3. Player Search & GHIN Integration

### 3.1 Player Data Model

The middleware caches GHIN player records to provide:
- **Handicap verification** for Fore Play course handicap calculations
- **Gender classification** for tee selection (critical for gender-appropriate course baselines)
- **Trend analysis** to track player improvement/regression
- **Association tracking** for regional rules and competitions

**Player Record (from GHIN API):**
```
ghinNumber      NVARCHAR(20)    -- Unique GHIN member ID
firstName       NVARCHAR(100)   -- Given name
lastName        NVARCHAR(100)   -- Family name
email           NVARCHAR(255)   -- Contact (optional)
clubName        NVARCHAR(100)   -- Home club
clubId          NVARCHAR(50)    -- Club GHIN ID
associationId   NVARCHAR(50)    -- Regional association (MGA, SCGA, etc.)
handicapIndex   DECIMAL(5,1)    -- Current handicap index (e.g., 9.4)
lowHandicapIndex DECIMAL(5,1)   -- Lowest HI achieved (career best)
trendIndicator  CHAR(1)         -- '+' = increasing, '=' = stable, '-' = decreasing
lastRevisionDate DATETIME2       -- When HI was last updated by GHIN
gender          CHAR(1)         -- 'M' or 'W' — PRIMARY driver of tee selection
status          NVARCHAR(50)    -- 'active', 'inactive', 'suspended'
```

### 3.2 Current Player Search Endpoint

**Existing Implementation:** [src/routes/players.js](src/routes/players.js)

```
POST /api/v1/players/search

Request:
{
  "ghinNumber": "1234567"
}

Response (200 OK):
{
  "players": [
    {
      "ghinNumber": "1234567",
      "firstName": "Clayton",
      "lastName": "Cobb",
      "email": "clayton@example.com",
      "clubName": "Cedar Ridge Golf Club",
      "clubId": "12345",
      "associationId": "MGA",
      "handicapIndex": "9.4",
      "lowHandicapIndex": 8.2,
      "trendIndicator": "+",
      "lastRevisionDate": "2025-12-20T08:00:00Z",
      "gender": "M",
      "status": "active"
    }
  ]
}

Error (404):
{
  "error": {
    "code": "GHIN_PLAYER_NOT_FOUND",
    "message": "Player not found in GHIN system"
  }
}
```

### 3.3 Mock Players (Development & Testing)

**File:** [src/mocks/ghinData.js](src/mocks/ghinData.js)

| GHIN # | Name | Gender | Club | HI | Status |
|--------|------|--------|------|----|----|
| 1234567 | Clayton Cobb | M | Cedar Ridge GC | 9.4 | active |
| 2345678 | Michael Draskin | M | Swan Lake GC | +1.0 (scratch) | active |
| 3456789 | Ryan Kayton | M | Forty Niners GC | 2.3 | active |

All mock players are registered at their home clubs and have active GHIN status. Use these for testing tee selection (all are male, so Blue M / White M tees apply).

### 3.4 Player-Tee Integration

**Key Relationship:**
- **Player gender** determines which tees are available during course selection
- **Default tee per course & gender** is pre-selected (e.g., Blue M for males)
- **Course handicap** is calculated from player's handicap index + slope rating of selected tee

**Example Flow:**
```
User: Clayton Cobb (GHIN 1234567, M, HI 9.4)
↓
Course: Cedar Ridge (GHIN-54321)
↓
Fetch Tees:
  • Blue M (default)  — 71.4 rating, 136 slope → Course HI = 9 + 0 = 9
  • Blue W (available but for females)
  • White M           — 69.8 rating, 132 slope → Course HI = 9 + (-0.5) = 8.5
  • White W (available but for females)
↓
Display to Clayton: [Blue M (default), White M]
Clayton selects Blue M
↓
Fetch Holes: /api/v1/courses/GHIN-54321/holes?teeId=GHIN-TEE-1001&gender=M
↓
Result: 18 holes with par/handicap for Blue M
```

### 3.5 Handicap Index Cache (Future)

**Phase 3 Plan:** Implement Redis cache for recent player lookups
- TTL: 24 hours (respects GHIN nightly updates)
- Keyed by GHIN number
- Fallback: Direct GHIN API call if cache miss
- Benefit: Eliminate repeated live GHIN API calls for frequently-used players

```
REDIS KEY: ghin:player:{ghinNumber}
VALUE:     { ghinNumber, firstName, lastName, gender, handicapIndex, ... }
TTL:       86400 (24 hours)
```

---

## 3.6 Phase 1.5 — Production Cache DB Architecture (March 2026)

### Purpose & Rationale

**Phase 1.5** introduces a **two-database architecture** to support production GHIN data caching at scale:
- **`golfdb`** (primary app DB): Hosts Golf Match canonical tables (UserProfiles, GlobalRoster, Events, Courses, Tees, course metadata)
- **`golfdb-ghin-cache`** (separate cache DB): Hosts production GHIN data (GHIN_Courses, GHIN_Tees, GHIN_Holes with extended schema)
- **`GhinRuntime*` mirror tables in golfdb**: Runtime serving model for GHIN-backed course/tee/hole reads
- **`GhinCourseMapping`** (legacy bridge candidate): retained pending explicit audit before cleanup/removal

**Benefits:**
1. **Data isolation:** GHIN cache can be refreshed/rebuilt independently without affecting Golf Match core tables
2. **Scalability:** Cache DB can be scaled separately for read-heavy GHIN queries (thousands of course lookups daily)
3. **TTL enforcement:** Extended schema supports automatic expiry (CachedAt + 24h TTL)
4. **Production-ready:** Extended schema matches live USGA API responses (TeeSetSide awareness, F9/B9/18H ratings)
5. **Deterministic location mapping:** cache writes map `CourseCity`/`CourseState` from GHIN payload and normalize `US-XX` to `XX`
6. **Non-breaking:** Phase 1.5 is additive; Phase 1 mock data in golfdb coexists during cutover

### Two-Database Data Model

#### golfdb-ghin-cache Schema (Production GHIN Cache)

**Table: GHIN_Courses**
```sql
CREATE TABLE GHIN_Courses (
  CourseId              VARCHAR(50) PRIMARY KEY,
  FacilityId            VARCHAR(50) NULL,       -- NEW: Facility identifier from USGA
  FacilityName          NVARCHAR(200) NULL,     -- NEW: Facility name (e.g., "Cedar Ridge Golf Club")
  CourseName            NVARCHAR(200) NOT NULL, -- App-facing composed label (e.g., "Bethpage State Park - Green")
  ShortCourseName       NVARCHAR(200) NULL,     -- Raw GHIN sub-course name (e.g., "Green")
  City                  NVARCHAR(100) NULL,
  State                 NVARCHAR(50) NULL,
  Country               NVARCHAR(50) NULL,
  CachedAt              DATETIME2 DEFAULT GETUTCDATE(),
  ExpiresAt             AS DATEADD(HOUR, 24, CachedAt) PERSISTED, -- NEW: 24-hour TTL
  CacheSource           VARCHAR(50) DEFAULT 'USGA_API',   -- NEW: Source of cache (for audit)
  CreatedAt             DATETIME2 DEFAULT GETUTCDATE(),
  UpdatedAt             DATETIME2 DEFAULT GETUTCDATE(),
  
  INDEX IX_GHIN_Courses_State (State),
  INDEX IX_GHIN_Courses_Facility (FacilityId),
  INDEX IX_GHIN_Courses_ExpiresAt (ExpiresAt)
);
```

**Table: GHIN_Tees** (Extended Schema)
```sql
CREATE TABLE GHIN_Tees (
  TeeId                 VARCHAR(50) PRIMARY KEY,
  CourseId              VARCHAR(50) NOT NULL,
  TeeName               NVARCHAR(50) NOT NULL,
  BaseTeeName           NVARCHAR(100) NULL,     -- Normalized name (e.g., "Blue")
  TeeSetSide            VARCHAR(10) NOT NULL,   -- NEW: 'F9' (front 9) | 'B9' (back 9) | 'All18'
  Gender                CHAR(1) NOT NULL,       -- 'M' or 'W'
  IsDefault             BIT DEFAULT 0,
  
  -- Full 18-hole ratings (when TeeSetSide='All18')
  CourseRating18        DECIMAL(4,1) NULL,
  SlopeRating18         INT NULL,
  Par18                 INT NULL,
  Yardage18             INT NULL,
  
  -- Front 9 ratings (when TeeSetSide='F9' or 'All18')
  CourseRatingF9        DECIMAL(4,1) NULL,
  SlopeRatingF9         INT NULL,
  ParF9                 INT NULL,
  YardageF9             INT NULL,
  
  -- Back 9 ratings (when TeeSetSide='B9' or 'All18')
  CourseRatingB9        DECIMAL(4,1) NULL,
  SlopeRatingB9         INT NULL,
  ParB9                 INT NULL,
  YardageB9             INT NULL,
  
  CachedAt              DATETIME2 DEFAULT GETUTCDATE(),
  ExpiresAt             AS DATEADD(HOUR, 24, CachedAt) PERSISTED,
  CreatedAt             DATETIME2 DEFAULT GETUTCDATE(),
  UpdatedAt             DATETIME2 DEFAULT GETUTCDATE(),
  
  CONSTRAINT FK_GHIN_Tees_Course FOREIGN KEY (CourseId) REFERENCES GHIN_Courses(CourseId),
  INDEX IX_GHIN_Tees_CourseId (CourseId),
  INDEX IX_GHIN_Tees_TeeSetSide (TeeSetSide),
  INDEX IX_GHIN_Tees_Gender (Gender),
  INDEX IX_GHIN_Tees_ExpiresAt (ExpiresAt)
);
```

**Table: GHIN_Holes**
```sql
CREATE TABLE GHIN_Holes (
  TeeId                 VARCHAR(50) NOT NULL,
  HoleNumber            INT NOT NULL,          -- 1..18
  Par                   INT NOT NULL,          -- 3, 4, or 5
  Handicap              INT NOT NULL,          -- 1..18 (handicap allocation)
  Yardage               INT NOT NULL,
  
  PRIMARY KEY (TeeId, HoleNumber),
  CONSTRAINT FK_GHIN_Holes_Tee FOREIGN KEY (TeeId) REFERENCES GHIN_Tees(TeeId),
  CONSTRAINT CK_GHIN_Holes_HoleNumber CHECK (HoleNumber BETWEEN 1 AND 18),
  INDEX IX_GHIN_Holes_TeeId (TeeId)
);
```

#### golfdb Schema Extensions (Phase 1.5)

**UserProfiles Additions** (GPA Consent Tracking)
```sql
ALTER TABLE UserProfiles ADD
  GHINRevisionDate      NVARCHAR(50) NULL,     -- GHIN last revision date from API
  GHINLowIndex          DECIMAL(5,1) NULL,     -- Lowest handicap index on record
  GHINClubId            NVARCHAR(50) NULL,     -- Home club GHIN ID
  GHINAssociationId     NVARCHAR(50) NULL,     -- Regional association (MGA, SCGA, etc.)
  GHINConsentStatus     NVARCHAR(20) DEFAULT 'none',  -- NEW: none | pending | approved | inactive | rejected
  GHINConsentRequestedAt DATETIME2 NULL,       -- When consent request was sent
  GHINConsentUpdatedAt  DATETIME2 NULL,        -- Last consent state change
  INDEX IX_UserProfiles_GHINConsent (GHINConsentStatus);
```

**GlobalRoster Additions** (Identity Verification Only — No Consent)
```sql
ALTER TABLE GlobalRoster ADD
  GHINRevisionDate      NVARCHAR(50) NULL,
  GHINLowIndex          DECIMAL(5,1) NULL,
  GHINClubId            NVARCHAR(50) NULL,
  GHINAssociationId     NVARCHAR(50) NULL,
  GHINIdentityVerified  BIT DEFAULT 0,         -- NEW: Verified flag (no consent flow)
  GHINIdentityVerifiedAt DATETIME2 NULL,       -- Verification timestamp
  INDEX IX_GlobalRoster_GHINVerified (GHINIdentityVerified);
```

**Events Additions**
```sql
ALTER TABLE Events ADD
  IsTournament          BIT DEFAULT 0;         -- NEW: Marks tournament events subject to GHIN handicap rules
```

**New Bridge Table: GhinCourseMapping**
```sql
CREATE TABLE GhinCourseMapping (
  GhinCourseMappingId   INT PRIMARY KEY IDENTITY(1,1),
  GhinCourseId          VARCHAR(50) NOT NULL,  -- ID from golfdb-ghin-cache
  GhinTeeId             VARCHAR(50) NULL,      -- ID from golfdb-ghin-cache (optional)
  GolfMatchCourseId     INT NOT NULL,          -- FK to golfdb Courses
  GolfMatchTeeId        INT NULL,              -- FK to golfdb Tees (optional)
  CreatedAt             DATETIME2 DEFAULT GETUTCDATE(),
  UpdatedAt             DATETIME2 DEFAULT GETUTCDATE(),
  
  CONSTRAINT FK_GhinCourseMapping_Course FOREIGN KEY (GolfMatchCourseId) REFERENCES Courses(CourseId),
  CONSTRAINT FK_GhinCourseMapping_Tee FOREIGN KEY (GolfMatchTeeId) REFERENCES Tees(TeeId),
  CONSTRAINT CK_GhinCourseMapping_CourseMapping CHECK (
    (GhinTeeId IS NULL AND GolfMatchTeeId IS NULL) OR 
    (GhinTeeId IS NOT NULL AND GolfMatchTeeId IS NOT NULL)
  ),
  
  UNIQUE (GhinCourseId, GhinTeeId),
  INDEX IX_GhinCourseMapping_GolfMatchCourse (GolfMatchCourseId),
  INDEX IX_GhinCourseMapping_GolfMatchTee (GolfMatchTeeId),
  INDEX IX_GhinCourseMapping_Reverse (GolfMatchCourseId, GhinCourseId)
);
```

### Authorization Model Separation

**Phase 1.5 Design Decision:** Separate authorization models for two user classes:

| Aspect | App Users (UserProfiles) | Club Members (GlobalRoster) |
|--------|--------------------------|----------------------------|
| **Consent Model** | GPA consent required (none → pending → approved \| inactive \| rejected) | No consent (identity verification only) |
| **Verification** | (via UserProfiles.UserID FK) | GHINIdentityVerified + timestamp |
| **Email Approval Flow** | Yes (request_golfer_product_access via USGA API) | No (GHIN#+LastName match only) |
| **Use Case** | App users granted access to live handicap index | Club members in rosters (unlinked, GHIN# known) |
| **Fallback Policy** | Position A enforcement: consent required for live index | Position A enforcement: identity verification required for dynamic indexes |

### Phase 1.5 Migration Suite

**Location:** `c:\dev\golf-match-local-cache\sql\migrations\` + cache DB migrations

| Migration | Target | Status | Purpose |
|-----------|--------|--------|---------|
| **023_phase15_ghin_schema_extensions.sql** | golfdb | Executed + verified (Mar 24, 2026) | Add metadata + consent/verification + tournament flag |
| **024_golfdb_ghin_course_mapping.sql** | golfdb | Executed + verified (Mar 24, 2026; FK syntax patched to `ON DELETE NO ACTION`) | Create GhinCourseMapping bridge table |
| **026_create_golfdb_ghin_runtime_mirror_tables.sql** | golfdb | Executed + verified (Mar 25, 2026) | Create GhinRuntimeCourses/Tees/Holes runtime mirror tables + indexes |
| **027_add_shortcoursename_to_ghin_runtime_courses.sql** | golfdb | Executed + verified (Mar 25, 2026) | Add `ShortCourseName` to runtime mirror courses and backfill existing rows |
| **001_create_ghin_cache_tables.sql** | golfdb-ghin-cache | Executed + verified (Mar 24, 2026) | Create production GHIN cache schema |
| **002_add_shortcoursename_to_ghin_cache_courses.sql** | golfdb-ghin-cache | Executed + verified (Mar 25, 2026) | Add `ShortCourseName` to cache courses and backfill existing rows |
| **025_drop_golfdb_ghin_mock_tables.sql** (deferred) | golfdb | Blocked | Drop mock tables after cache DB goes live |

**Execution Sequence (Mandatory Order):**
1. ✅ Migration 023 applied to golfdb — metadata + consent/verification columns live
2. ✅ Migration 024 applied to golfdb — GhinCourseMapping bridge live
3. ✅ Cache DB migration 001 applied to golfdb-ghin-cache — GHIN_Courses/Tees/Holes live
4. ✅ **Middleware wiring updated** — `src/services/database.js`, `src/config/secrets.js`, and `src/services/ghinClient.js` now route course queries to cache DB with runtime env resolution
5. ✅ **Cache DB seeded** — Real GHIN course (`courseId=1385`) inserted and queryable
6. ✅ **Local integration smoke** — search/course/tees/holes flow validated on localhost
7. ✅ **Location normalization validated** — cache now stores normalized city/state from GHIN `CourseCity`/`CourseState`
8. ✅ **Runtime mirror migration executed** — `GhinRuntimeCourses` / `GhinRuntimeTees` / `GhinRuntimeHoles` are live in golfdb
9. ✅ **Automated mirror sync validated** — callback/webhook/reconciliation path now upserts mirror rows atomically
10. ✅ **Course-name hardening executed** — `ShortCourseName` added and backfilled in cache + runtime mirror
11. ⏳ **Runtime read-path cutover verification next** — prove GHIN-backed gameplay/admin reads use `GhinRuntime*`
12. Run migration 025 (golfdb, after cutover verification) — drop mock tables

**See the Golf Match implementation record in `c:\dev\golf-match-local-cache\docs\GHIN-INTEGRATION-PLAN.md` for detailed execution runbook with cutover checkpoints and verification queries.**

---

## 4. Database Schema (golfdb + golfdb-ghin-cache)

This section keeps legacy golfdb schema context for compatibility analysis. Runtime serving for GHIN-backed course data is the `GhinRuntime*` mirror model.

### Core Tables

#### Courses
```sql
CREATE TABLE Courses (
  CourseID              INT PRIMARY KEY IDENTITY(1,1),
  CourseName            NVARCHAR(100) NOT NULL,
  City                  NVARCHAR(100) NULL,
  State                 NVARCHAR(50) NULL,
  SourceCourseKey       NVARCHAR(200) NULL,    -- GHIN ID (e.g., "GHIN-54321")
  Source                NVARCHAR(100) NULL,    -- 'GHIN', 'PGA', etc.
  LastVerified          DATETIME2 NULL,
  ExternalHash          CHAR(64) NULL,         -- SHA256 of GHIN data for change detection
  LastUpdatedUtc        DATETIME2 NOT NULL     -- SYSUTCDATETIME()
);
```

#### Tees
```sql
CREATE TABLE Tees (
  TeeID                 INT PRIMARY KEY IDENTITY(1,1),
  CourseID              INT NOT NULL,
  TeeName               NVARCHAR(50) NOT NULL, -- 'Blue', 'Blue (M)', etc.
  BaseTeeName           NVARCHAR(100) NULL,    -- normalized name for grouping
  
  CONSTRAINT FK_Tees_CourseID FOREIGN KEY (CourseID) REFERENCES Courses(CourseID),
  INDEX IX_Tees_CourseID (CourseID)
);
```

#### CourseDefaults
```sql
CREATE TABLE CourseDefaults (
  CourseID              INT NOT NULL,
  Gender                CHAR(1) NOT NULL,      -- 'M' or 'W'
  DefaultTeeID          INT NOT NULL,
  
  PRIMARY KEY (CourseID, Gender),
  CONSTRAINT FK_CourseDefaults_Course FOREIGN KEY (CourseID) REFERENCES Courses(CourseID),
  CONSTRAINT FK_CourseDefaults_Tee FOREIGN KEY (DefaultTeeID) REFERENCES Tees(TeeID)
);
```

#### TeeRatings
```sql
CREATE TABLE TeeRatings (
  TeeID                 INT NOT NULL,
  Gender                CHAR(1) NOT NULL,      -- 'M' or 'W'
  CourseRating          DECIMAL(4,1) NOT NULL,
  Slope                 INT NOT NULL,
  
  PRIMARY KEY (TeeID, Gender),
  CONSTRAINT FK_TeeRatings_Tee FOREIGN KEY (TeeID) REFERENCES Tees(TeeID)
);
```

#### HoleDefaults
```sql
CREATE TABLE HoleDefaults (
  DefaultTeeID          INT NOT NULL,
  HoleNumber            INT NOT NULL,          -- 1..18 or 1..9
  Par                   INT NOT NULL,          -- 3, 4, or 5
  Handicap              INT NOT NULL,          -- 1..18
  Gender                CHAR(1) NOT NULL,      -- 'M' or 'W'
  
  PRIMARY KEY (DefaultTeeID, HoleNumber, Gender),
  CONSTRAINT FK_HoleDefaults_Tee FOREIGN KEY (DefaultTeeID) REFERENCES Tees(TeeID),
  CONSTRAINT CK_HoleDefaults_HoleNumber CHECK (HoleNumber BETWEEN 1 AND 18)
);
```

#### HoleOverrides
```sql
CREATE TABLE HoleOverrides (
  TeeID                 INT NOT NULL,
  HoleNumber            INT NOT NULL,          -- 1..18
  Par                   INT NULL,              -- NULL = inherit from defaults
  Handicap              INT NULL,              -- NULL = inherit from defaults
  Gender                CHAR(1) NOT NULL,      -- 'M' or 'W'
  
  PRIMARY KEY (TeeID, HoleNumber, Gender),
  CONSTRAINT FK_HoleOverrides_Tee FOREIGN KEY (TeeID) REFERENCES Tees(TeeID),
  CONSTRAINT CK_HoleOverrides_HoleNumber CHECK (HoleNumber BETWEEN 1 AND 18)
);
```

### Key Relationships

1. **Default Tee Selection:**
   - `CourseDefaults` links each `(CourseID, Gender)` → `DefaultTeeID`
   - Fore Play respects this mapping to pre-select the default tee for a player's gender

2. **Hole Baseline Inheritance:**
   - Query effective hole data for a tee+gender using `usp_GetEffectiveHoleData(@TeeID, @Gender)`:
     - First, find the `DefaultTeeID` for the player's gender
     - Load `HoleDefaults` for that default tee+gender (18 rows)
     - Overlay any `HoleOverrides` for the selected tee+gender
     - Result: 18 holes with par/handicap (overrides take precedence)

3. **Gender Fallback:**
   - If no Women's `CourseDefaults` exist, Women players fall back to Men's defaults
   - If no Women's `HoleDefaults` exist, Women players use Men's hole definitions

---

## 4. Current Endpoints (Middleware)

### Health & Status
```
GET /api/v1/health
Response: { "status": "ok" }
```

### Players
```
POST /api/v1/players/search
  Body: { "ghinNumber": "1234567" }
  Response: {
    "players": [
      {
        "ghinNumber": "1234567",
        "firstName": "Clayton",
        "lastName": "Cobb",
        "gender": "M",
        "handicapIndex": "9.4",
        "clubName": "Cedar Ridge Golf Club",
        ...
      }
    ]
  }
```

### Courses
```
GET /api/v1/courses/state/:state
  Response: { "results": [...], "totalResults": N }

GET /api/v1/courses/:ghinCourseId/tees
  Response: { "courseId": "...", "tees": [...] }

GET /api/v1/courses/:ghinCourseId/holes?teeId=:teeId&gender=:gender
  Response: { "courseId": "...", "teeId": "...", "gender": "M", "holes": [...] }
```

See [src/routes/courses.js](src/routes/courses.js) for full implementation.

---

## 5. Mock Data (Development & Testing)

**File:** [src/mocks/ghinData.js](src/mocks/ghinData.js)

### 5.1 Mock Players

| GHIN # | First Name | Last Name | Gender | Club | Assoc. | HI | Low HI | Trend | Status |
|--------|-----------|-----------|--------|------|--------|----|----|-----|----|
| 1234567 | Clayton | Cobb | M | Cedar Ridge GC | MGA | 9.4 | 8.2 | + | active |
| 2345678 | Michael | Draskin | M | Swan Lake GC | MGA | +1.0 | -0.5 | = | active |
| 3456789 | Ryan | Kayton | M | Forty Niners GC | MGA | 2.3 | 1.8 | - | active |

**Usage:**
- Clayton (9.4 HI, M): Intermediate player, trending worse
- Michael (+1.0 HI, M): Scratch golfer, very competitive
- Ryan (2.3 HI, M): Strong amateur, improving steadily

Test player search via:
```bash
POST /api/v1/players/search
{ "ghinNumber": "1234567" }  # Returns Clayton Cobb
```

### 5.2 Mock Course & Tees

**Current Test Course:**
- **Cedar Ridge Golf Club** (GHIN-54321)
- Location: Boulder, CO, USA
- Holes: 18
- Tees:
  - **Blue M (default)**: 71.4 rating, 136 slope, 6400 yards, 18 holes ✓ full baseline
  - **Blue W (default)**: 70.1 rating, 125 slope, 5900 yards, 18 holes ✓ full baseline
  - **White M**: 69.8 rating, 132 slope, 6100 yards, 18 holes ✓ full baseline
  - **White W**: 68.3 rating, 120 slope, 5450 yards, 18 holes ✓ full baseline

All tees have complete 18-hole par/handicap baselines for end-to-end testing.

**Test Course Selection Workflow:**
```bash
# 1. Search for Clayton
POST /api/v1/players/search
{ "ghinNumber": "1234567" }
# → Gender: M

# 2. List CO courses
GET /api/v1/courses/state/CO
# → Cedar Ridge (GHIN-54321) listed

# 3. Fetch tees (pre-filters to men's tees for Clayton)
GET /api/v1/courses/GHIN-54321/tees
# → Blue M (default), White M (alternatives)

# 4. Fetch hole baseline (Clayton selects Blue M)
GET /api/v1/courses/GHIN-54321/holes?teeId=GHIN-TEE-1001&gender=M
# → 18 holes with par/handicap: [4,9,380], [4,3,410], ... [5,4,520]
```

---

## 6. GHIN API Integration Status & Future

### Phase 1 (Complete)
- ✅ Middleware authenticates to USGA sandbox via `POST /users/login.json` (email/password from Key Vault)
- ✅ Live player lookup wired and validated (`GET /api/v1/players/:ghinNumber`)
- ✅ Live course lookup wired and validated (`GET /api/v1/courses/:ghinCourseId`, `/tees`, `/holes`)
- ✅ Outbound allowlist gate implemented in `usaGhinApiClient` with explicit deny behavior
- ✅ Phase 1 smoke tests completed end-to-end (player + course paths)

### Phase 1.5 (Core Runtime + Sync Foundation — March 2026)
- ✅ **Two-database architecture designed** — golfdb (app) + golfdb-ghin-cache (production GHIN data)
- ✅ **Extended cache schema authored** — GHIN_Courses/Tees/Holes with TeeSetSide awareness, F9/B9/18H ratings, 24h TTL
- ✅ **GhinCourseMapping bridge table designed** — maps GHIN IDs ↔ Golf Match IDs (no cross-DB FK)
- ✅ **Metadata + consent/verification columns designed** — UserProfiles (GPA consent), GlobalRoster (identity verification only)
- ✅ **Migration suite executed** — 023 + 024 + 026 + 027 on golfdb and 001 + 002 on golfdb-ghin-cache
- ✅ **Middleware integration complete** — cache DB routing and secret-name compatibility fixes are in place
- ✅ **Cache DB population validated** — real seeded/reconciled course paths work end-to-end
- ✅ **Mirror sync automation validated** — callback, webhook lifecycle, and reconciliation safety net are live
- ✅ **Course naming model hardened** — `FacilityName` + raw `ShortCourseName` + composed runtime `CourseName`
- ✅ **Runtime read-path cutover validated in Golf Match** — GHIN-backed runtime reads are proven on `GhinRuntimeCourses` / `GhinRuntimeTees` / `GhinRuntimeHoles`
- ✅ **Score-posting boundary validated** — `/api/v1/scores/post`, `/api/v1/scores/search`, and `/api/v1/scores/:scoreId` are wired through normalized middleware route/service/client layers, and posting-season lookup plus upstream rejection normalization are active

**See the Golf Match implementation record in `c:\dev\golf-match-local-cache\docs\GHIN-INTEGRATION-PLAN.md` for complete migration suite details, execution sequence, and cutover checkpoints.**

### Phase 2 (Current — Staging Readiness Support)
- 🔄 Keep the middleware boundary stable while Golf Match completes the remaining approval-track gaps:
  1. Use `/api/v1/scores/post` as the sole public score-post entrypoint and `/api/v1/scores/search` plus `/api/v1/scores/:scoreId` for follow-on diagnostics/readback
  2. Keep posting-season checks, allowlist enforcement, and explicit upstream error normalization intact; do not add hidden fallbacks
  3. Support the remaining staging-readiness work that still lives in Golf Match product surfaces: scoring-record UX, golfer-state validation, and evidence capture
  4. Keep migration 025 deferred until there is an explicit cleanup go/no-go decision

### Phase 3 (Planned — Player Handicap Sync)
- 🔄 Implement player handicap caching and refresh:
  1. Accept list of GHIN numbers from golfmatch-api via background sync job
  2. Call live GHIN player API to fetch handicap index, trend, gender, status
  3. Cache player records in Redis (TTL: 24 hours) to minimize live API calls
  4. Expose `POST /api/v1/players/:ghinNumber/refresh` endpoint for on-demand updates
  5. Periodically re-sync active players (those created rounds in last 30 days)
  6. Monitor API rate limits; throttle requests if approaching GHIN's limits

**Player Sync Logic:**
```
Fore Play (golfmatch-api):
  ↓
Periodically (daily or on-demand):
  POST /api/v1/players/refresh
  { "ghinNumbers": ["1234567", "2345678", ...] }
  ↓
Middleware:
  • Check Redis cache for each player
  • For cache misses, call live GHIN API
  • Store fresh data in Redis + local SQL cache (Players table, if needed)
  • Return combined results to Fore Play
  ↓
Result:
  {
    "players": [
      {
        "ghinNumber": "1234567",
        "firstName": "Clayton",
        "gender": "M",
        "handicapIndex": "9.4",
        "lastSyncAt": "2025-12-25T15:00:00Z",
        "isCached": false,  // true if from Redis, false if from live GHIN
        ...
      }
    ]
  }
```

### Architecture Benefits
- **Single source of truth:** All course and player data from GHIN
- **Zero per-user latency:** Cached locally; no live API calls during play
- **Cost control:** Nightly batch sync vs. thousands of per-user API calls
- **Decoupled:** Fore Play unaffected by GHIN API changes; middleware absorbs volatility
- **Scalable:** Redis cache + SQL fallback handle concurrent requests

---

## 7. Deployment

### Local Development
```bash
npm install
npm run dev    # Runs on :5001 (PORT env var override supported)
```

Runtime mode is driven by GHIN sandbox credential presence:
- `GHIN_SANDBOX_EMAIL` + `GHIN_SANDBOX_PASSWORD` present -> LIVE mode
- Missing credentials -> MOCK mode

### Azure Deployment

**Key Change (Phase 1.5):** Middleware now connects to **two** Azure SQL databases.

- **Runtime:** Node.js 20.x on Linux App Service
- **Primary Database:** `golfdb` on `golfmatchserver.database.windows.net` (Fore Play canonical DB)
- **Cache Database:** `golfdb-ghin-cache` on `golfmatchserver.database.windows.net` (Production GHIN cache — separate logical DB)
- **Secrets:** Azure Key Vault (DefaultAzureCredential)
  - `APPLICATIONINSIGHTS_CONNECTION_STRING`
  - `GHIN-SANDBOX-EMAIL` / `GHIN-SANDBOX-PASSWORD`
  - `GHIN-API-BASE-URL`
  - `AZURE_SQL_USER` / `AZURE_SQL_PASSWORD` (both databases use same server + credentials)
  - `REDIS_PASSWORD` (Phase 3)
- **Cache:** Azure Redis (TLS, managed identity — Phase 3)
- **CI/CD:** GitHub Actions — Run From Package via Azure Blob Storage (see below)

**Middleware Connection String (for golfmatch-api):**
```
https://golfmatch-ghin-middleware.azurewebsites.net/api/v1
```

**Database Configuration in Middleware** (`src/services/database.js`):
```javascript
// Primary App DB (golfdb)
const appDb = sql.ConnectionPool({
  server: 'golfmatchserver.database.windows.net',
  database: 'golfdb',
  authentication: {
    type: 'azure-active-directory-msi-app-service'
  },
  options: {
    encrypt: true,
    trustServerCertificate: false
  }
});

// Phase 1.5+: Cache DB (golfdb-ghin-cache)
const cacheDb = sql.ConnectionPool({
  server: 'golfmatchserver.database.windows.net',
  database: 'golfdb-ghin-cache',
  authentication: {
    type: 'azure-active-directory-msi-app-service'
  },
  options: {
    encrypt: true,
    trustServerCertificate: false
  }
});

module.exports = { appDb, cacheDb };
```

### Schema-Tools Secret Rotation Runbook (Critical)

This is the historical issue that broke schema exports until credentials were rotated and Key Vault names were aligned.

**Where the scripts live:** `C:\dev\golf-match-local-cache\schema-tools`

**Scripts affected:**
- `Export-Schema-Full.js` (golfdb export)
- `Export-Schema-CodeObjects.js` (golfdb export)
- `Export-CacheDB-Schema-Full.js` (golfdb-ghin-cache export)
- `Export-CacheDB-Schema-CodeObjects.js` (golfdb-ghin-cache export)

**Credential resolution behavior:**
1. golfdb exporters call `api/shared/secretsLoader.js` and expect:
  - `AZURE-SQL-USER`
  - `AZURE-SQL-PASSWORD`
  - `AZURE-SQL-SERVER`
  - `AZURE-SQL-DATABASE`
2. cache DB exporters call `loadSecrets()` and then explicit cache lookups from Key Vault `https://golfmatch-secrets.vault.azure.net`.
3. cache DB exporters accept either secret naming style for compatibility:
  - hyphen style: `GHIN-CACHE-DB-SERVER`, `GHIN-CACHE-DB-NAME`, `GHIN-CACHE-DB-USER`, `GHIN-CACHE-DB-PASSWORD`
  - underscore style: `GHIN_CACHE_DB_SERVER`, `GHIN_CACHE_DB_NAME`, `GHIN_CACHE_DB_USER`, `GHIN_CACHE_DB_PASSWORD`

**Rotation checklist (do this exactly):**
1. Rotate SQL login password on Azure SQL for the login used by schema exports.
2. Immediately update Key Vault secrets:
  - `AZURE-SQL-PASSWORD` (for golfdb exporters)
  - `GHIN-CACHE-DB-PASSWORD` (for cache DB exporters)
3. Keep server/name/user secrets current for both target DBs.
4. Re-run both export paths to validate:
  - `node schema-tools/Export-Schema-Full.js`
  - `node schema-tools/Export-Schema-CodeObjects.js`
  - `node schema-tools/Export-CacheDB-Schema-Full.js`
  - `node schema-tools/Export-CacheDB-Schema-CodeObjects.js`

**Known failure signatures:**
- `Missing cache DB credentials from Key Vault (GHIN-CACHE-DB-SERVER/NAME/USER/PASSWORD).`
- SQL authentication failures after password rotation if Key Vault values were not updated in lockstep.

**Operational rule:** Treat SQL password rotation and Key Vault secret updates as one atomic change window. Do not rotate one without the other.

### CI/CD: Run From Package

The App Service SCM endpoint (`Kudu-Deny-All` at priority 1) is intentionally blocked to all public traffic as part of the VNet security posture. All Kudu-based deployment methods (`azure/webapps-deploy`, `az webapp deploy`) are permanently disabled by design.

**Deployment flow:**
1. GitHub Actions builds the app and creates a zip package
2. Uploads zip to `golfmatchstorage/deployments/` blob container via OIDC auth
3. Sets `WEBSITE_RUN_FROM_PACKAGE` app setting (plain blob URL, no SAS) via ARM
4. App Service system-assigned managed identity fetches zip directly from blob at startup — no Kudu involved

**Auth: OIDC (no secrets)**
- Service principal: `golfmatch-github-actions` (appId `4ac504e2-9f9d-4084-953c-047ce32ddea1`)
- Federated credential subject: `repo:Hold2Admin/golfmatch-ghin-middleware:ref:refs/heads/main`
- Required GitHub secrets: `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, `AZURE_SUBSCRIPTION_ID`
- **Not used:** `AZURE_WEBAPP_PUBLISH_PROFILE` (deleted)

**Role assignments:**
- `golfmatch-github-actions` SP → Storage Blob Data Contributor on `golfmatchstorage` (upload)
- `golfmatch-github-actions` SP → Contributor on `RG_GolfMatch` (set app settings via ARM)
- App Service system-assigned managed identity (`8844f213-...`) → Storage Blob Data Reader on `golfmatchstorage` (fetch zip at startup)

---

## 8. Security & Compliance

- **No .env.local in production:** All secrets from Key Vault
- **API Key Auth:** All requests require `X-API-Key` header (enforced by middleware)
- **IP Whitelist:** Middleware enforces CORS to allow only golfmatch-api
- **Managed Identity:** App Service uses Azure AD for seamless Key Vault + SQL auth
- **Read-Only SQL User:** Credentials in Key Vault have minimal permissions (no ddl/dml for production)
- **Encryption in Transit:** TLS 1.3 for all Azure connections

---

## 9. Stored Procedures (golfdb)

**Schema Export Location:** [db-schema/golfmatch/procedures/](db-schema/golfmatch/procedures/)

### Key Procedures

#### `usp_GetEffectiveHoleData`
Resolves par/handicap for a tee+gender, handling defaults and overrides.
```sql
EXEC usp_GetEffectiveHoleData @TeeID = 1, @Gender = 'M';
-- Returns: 18 rows with HoleNumber, Par, Handicap (overrides merged)
```

#### `usp_CreateCourseWithDefaults`
Upserts a new course and auto-populates default tees.
```sql
EXEC usp_CreateCourseWithDefaults @CourseName = 'Cedar Ridge', @City = 'Boulder', @State = 'CO';
```

#### `usp_AddTeeForCourseWithRatings`
Adds a new tee (or variant) with course ratings.
```sql
EXEC usp_AddTeeForCourseWithRatings
  @CourseID = 1,
  @TeeName = 'White',
  @MenCourseRating = 69.8,
  @MenSlope = 132,
  @WomenCourseRating = 68.3,
  @WomenSlope = 120;
```

#### `usp_ReplaceHoleDefaultsByGender`
Atomically replaces hole defaults for a gender (used in nightly sync).
```sql
EXEC usp_ReplaceHoleDefaultsByGender
  @CourseID = 1,
  @Gender = 'M',
  @NumHoles = 18,
  @ParString = '443453544534454344',
  @HandicapString = '6,10,2,14,1,18,15,9,5,8,12,17,11,3,16,7,13,4';
```

---

## 10. Key Files & Structure

```
golfmatch-ghin-middleware/
├── src/
│   ├── index.js                          -- Express server
│   ├── config/
│   │   └── secrets.js                    -- Key Vault integration
│   ├── mocks/
│   │   └── ghinData.js                   -- Test data (Cedar Ridge)
│   ├── routes/
│   │   ├── courses.js                    -- Endpoints (state, tees, holes)
│   │   ├── health.js                     -- Health check
│   │   └── players.js                    -- Player search
│   ├── services/
│   │   ├── ghinClient.js                 -- Gateway client (DB/cache + mock/live routing)
│   │   ├── usaGhinApiClient.js           -- Live USGA auth + allowlisted HTTP client
│   │   └── transformers/
│   │       └── courseTransformer.js      -- Response normalization
│   └── utils/
│       └── logger.js                     -- Structured logging
├── scripts/
│   ├── export-schema.js                  -- Schema dump tool (read-only)
│   └── gm.ps1                            -- PowerShell helper for testing
├── db-schema/
│   └── golfmatch/
│       ├── tables.csv                    -- Table definitions
│       ├── columns.csv                   -- Column metadata
│       ├── procedures.csv                -- Stored proc list
│       └── procedures/                   -- SQL definitions
├── .github/workflows/
│   └── deploy-middleware.yml             -- CI/CD pipeline
├── package.json
└── MIDDLEWARE-ARCHITECTURE.md             -- This file
```

---

## 11. Common Workflows

### Verify Player Exists & Get Tee Preferences
1. Call `POST /api/v1/players/search { "ghinNumber": "1234567" }`
2. Receive player record: gender, handicap index, club, status
3. Use gender to filter tee selection in course endpoint
4. Calculate course handicap from player's HI + tee slope rating

### Add a New Course (Nightly Sync)
1. Fetch from GHIN API: course name, location, tees, hole baselines
2. Call `usp_CreateCourseWithDefaults` → creates Courses row + default CourseDefaults
3. Call `usp_AddTeeForCourseWithRatings` for each additional tee variant
4. Call `usp_ReplaceHoleDefaultsByGender` to populate HoleDefaults

### Test Endpoints Locally (Mock Data)
```bash
# Start local middleware
npm run dev

# In PowerShell, load the helper
./scripts/gm.ps1
Set-GmKey

# Test Player Search
gmx-local /api/v1/players/search -Method POST -Body '{"ghinNumber":"1234567"}'
# Response: Clayton Cobb, gender M, HI 9.4, Cedar Ridge GC

# Test State Course Listing
gmx-local /api/v1/courses/state/CO
# Response: Cedar Ridge (GHIN-54321) + any other CO courses in mocks

# Test Tees for Course
gmx-local /api/v1/courses/GHIN-54321/tees
# Response: Blue M (default), Blue W (default), White M, White W

# Test Hole Baselines
gmx-local "/api/v1/courses/GHIN-54321/holes?teeId=GHIN-TEE-1001&gender=M"
# Response: 18 holes with par/handicap for Blue M

# End-to-end workflow:
# 1. Look up player (Clayton) → gender M
# 2. List CO courses → Cedar Ridge
# 3. Fetch tees → show Blue M + White M (filter for male)
# 4. Fetch holes for Blue M → 18-hole baseline
```

### Test Endpoints Locally (Live Sandbox)
```bash
# Start middleware with GHIN sandbox secrets available
npm run dev

# Verify runtime mode
gmx-local /api/v1/health
# Expect: ghinApiMode = LIVE

# Player smoke test
gmx-local /api/v1/players/10000257

# Course smoke test
gmx-local /api/v1/courses/6765
gmx-local /api/v1/courses/6765/tees
gmx-local "/api/v1/courses/6765/holes?teeId=357784&gender=M"
```

### Phase 1.5 Localhost Cache Smoke (Mar 24, 2026)
```bash
# Name-only search against local middleware (no state required)
POST /api/v1/courses/search { "courseName": "hangman" }
# -> 200, totalResults=1, first.courseId=1385

# Tees for seeded real course
GET /api/v1/courses/1385/tees
# -> 200, tees=11

# Hole baselines for returned tee/gender
GET /api/v1/courses/1385/holes?teeId=<ghinTeeId>&gender=<M|W>
# -> 200, holes=18
```

### Refresh Player Handicap (Future Phase 3)
```bash
# Sync one or more players from live GHIN API
POST /api/v1/players/refresh
{
  "ghinNumbers": ["1234567", "2345678", "3456789"]
}

# Response (with Redis caching):
{
  "players": [
    {
      "ghinNumber": "1234567",
      "firstName": "Clayton",
      "handicapIndex": "9.4",
      "isCached": false,           # true = from Redis, false = fresh from GHIN API
      "lastSyncAt": "2025-12-25T15:00:00Z"
    },
    ...
  ]
}
```

### Export Schema for Review
```bash
node scripts/export-schema.js
# Outputs CSVs + SQL procs to db-schema/golfmatch/
```

---

## 12. Troubleshooting

### Schema Export Fails
- **Issue:** Script can't connect to golfdb
- **Fix:** Verify Key Vault creds (`AZURE_SQL_USER`/`AZURE_SQL_PASSWORD`) have SELECT permissions on golfdb
- **Manual:** Run `EXEC usp_GetEffectiveHoleData @TeeID = 1, @Gender = 'M';` in SSMS

### Endpoints Return 502
- **Issue:** GHIN API auth/request error or transformer error
- **Fix:** Check middleware logs for upstream status/message; verify `GHIN_SANDBOX_EMAIL`, `GHIN_SANDBOX_PASSWORD`, and `GHIN_API_BASE_URL` are loaded; confirm `ghinApiMode` from `/api/v1/health`

### Fore Play Can't Call Middleware
- **Issue:** CORS or API key rejected
- **Fix:** Verify golfmatch-api is sending `X-API-Key` header and its IP is whitelisted in App Service networking

---

## 13. References

- **Repository:** https://github.com/Hold2Admin/golfmatch-ghin-middleware
- **Fore Play:** golfmatch-api (separate repo, calls middleware endpoints)
- **Database:** `golfdb` on `golfmatchserver.database.windows.net`
- **Azure Deployment:** App Service `golfmatch-ghin-middleware.azurewebsites.net`
- **Key Vault:** `golfmatch-secrets`

---

**Next Steps:**
1. Integrate middleware endpoints into golfmatch-api (call `/api/v1/courses/state/:state`, `/tees`, `/holes`)
2. Implement nightly GHIN API sync (Phase 2)
3. Add player handicap endpoint (Phase 3)
4. Monitor middleware health via Application Insights
