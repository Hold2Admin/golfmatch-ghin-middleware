# GolfMatch GHIN Middleware — Architecture & Integration Guide

**Last Updated:** December 25, 2025  
**Project:** `golfmatch-ghin-middleware` (Node.js 20.x + Express)  
**Status:** Active development — Fore Play integration ready

---

## 1. Project Purpose

The **GHIN Middleware** is a dedicated API layer that bridges **Fore Play (golfmatch-api)** with the **GHIN course management system**. It is **not** a replacement for Fore Play's core database; it is a **satellite service** that:

1. **Caches GHIN course/tee/hole data** locally in Azure SQL (`golfdb`)
2. **Exposes normalized endpoints** for Fore Play to fetch course baselines and player handicaps
3. **Syncs nightly from live GHIN API** (future) to keep cache current
4. **Eliminates per-user GHIN API calls** during search/play workflows (cost optimization)
5. **Supports future direct GHIN API integration** without changing Fore Play's architecture

**Key Principle:** Fore Play never calls GHIN directly. All GHIN data flows through middleware.

---

## 2. Integration with golfmatch-api (Fore Play)

### 2.1 Current Workflow

```
Fore Play Frontend (Vite @ localhost:5173)
  ↓
golfmatch-api (Node.js @ localhost:5000 or Azure)
  ↓
Call Middleware Endpoints:
  • GET /api/v1/courses/state/:state       (list courses by state)
  • GET /api/v1/courses/:courseId/tees     (fetch tees for a course)
  • GET /api/v1/courses/:courseId/holes    (fetch hole baselines for tee+gender)
  ↓
golfmatch-ghin-middleware (Azure App Service)
  ↓
Azure SQL: golfdb (Fore Play canonical DB)
  ├─ Courses table
  ├─ Tees table (per-gender variants)
  ├─ CourseDefaults table (gender-aware defaults)
  ├─ HoleDefaults table (default tee hole baselines)
  └─ HoleOverrides table (non-default tee customizations)
```

### 2.2 Endpoints for golfmatch-api

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

### 2.3 Integration Flow in golfmatch-api

**Course Selection Workflow:**
1. **User selects state** in Fore Play UI → calls middleware `/api/v1/courses/state/CO`
2. **User selects course** → calls middleware `/api/v1/courses/GHIN-54321/tees`
3. **User selects tee & gender** → calls middleware `/api/v1/courses/GHIN-54321/holes?teeId=GHIN-TEE-1001&gender=M`
4. **golfmatch-api upserts** into its canonical `Courses`, `Tees`, `CourseDefaults`, `HoleDefaults` tables
5. **Fore Play stores** player's selected tee & gender for future rounds

**Upsert Logic in golfmatch-api** (to be implemented):
```sql
-- Pseudo-code for golfmatch-api upsert flow
BEGIN TRANSACTION;

  -- 1. Insert/update Courses
  MERGE INTO dbo.Courses AS target
  USING (SELECT @ghinCourseId, @courseName, @city, @state, SYSUTCDATETIME()) AS source
  ON target.SourceCourseKey = source.ghinCourseId
  WHEN MATCHED THEN UPDATE ...
  WHEN NOT MATCHED THEN INSERT ...;

  -- 2. Insert/update Tees
  MERGE INTO dbo.Tees AS target
  USING (SELECT @courseId, @teeName, @baseTeeName) AS source
  ON target.CourseID = source.courseId AND target.TeeName = source.teeName
  WHEN MATCHED THEN UPDATE ...
  WHEN NOT MATCHED THEN INSERT ...;

  -- 3. Insert/update CourseDefaults (gender-aware)
  -- Mark default tees from middleware isDefault flag
  DELETE FROM dbo.CourseDefaults WHERE CourseID = @courseId;
  INSERT INTO dbo.CourseDefaults (CourseID, Gender, DefaultTeeID)
  SELECT @courseId, 'M', @defaultMenTeeId
  UNION ALL
  SELECT @courseId, 'W', @defaultWomenTeeId;

  -- 4. Insert/update HoleDefaults
  -- Only populate for the default tees per gender
  MERGE INTO dbo.HoleDefaults AS target
  USING (middleware hole data) AS source
  ...;

  -- 5. Insert/update HoleOverrides (if non-default tee differs from defaults)
  ...;

COMMIT TRANSACTION;
```

---

## 3. Database Schema (golfdb)

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

### Players (Existing)
```
POST /api/v1/players/search
Body: { "ghinNumber": "1234567" }
Response: { "players": [...] }
```

### Courses (New)
```
GET /api/v1/courses/state/:state
GET /api/v1/courses/:ghinCourseId/tees
GET /api/v1/courses/:ghinCourseId/holes?teeId=:teeId&gender=:gender
```

See [src/routes/courses.js](src/routes/courses.js) for full implementation.

---

## 5. Mock Data (Development & Testing)

**File:** [src/mocks/ghinData.js](src/mocks/ghinData.js)

**Current Test Course:**
- **Cedar Ridge Golf Club** (GHIN-54321)
- Location: Boulder, CO
- Tees:
  - Blue M (default): 71.4 rating, 136 slope, 6400 yards, 18 holes
  - Blue W (default): 70.1 rating, 125 slope, 5900 yards, 18 holes
  - White M: 69.8 rating, 132 slope, 6100 yards, 18 holes
  - White W: 68.3 rating, 120 slope, 5450 yards, 18 holes

All tees have complete 18-hole par/handicap baselines for testing.

---

## 6. Future: GHIN API Integration

### Phase 1 (Current)
- ✅ Middleware serves mock course/tee/hole data
- ✅ golfmatch-api can call middleware endpoints
- ✅ Database schema supports nightly sync from live GHIN

### Phase 2 (Planned)
- 🔄 Implement nightly background job to:
  1. Call live GHIN API for course listing (filtered by state/region)
  2. Fetch each course's tees and hole baselines
  3. Compute SHA256 hash of fetched data to detect changes
  4. Upsert into `Courses`, `Tees`, `TeeRatings`, `HoleDefaults` tables
  5. Trigger `usp_ApplyHoleDefaultsToAllTeesByGender` to auto-populate non-default tees

### Phase 3 (Planned)
- Player handicap sync:
  1. Accept list of GHIN numbers from golfmatch-api
  2. Call live GHIN player API to fetch handicap index + trend
  3. Cache in Redis (TTL: 24 hours) to minimize live API calls
  4. Expose `/api/v1/players/:ghinNumber/handicap` endpoint

### Architecture Benefits
- **Single source of truth:** All course data from GHIN
- **Zero per-user latency:** Cached locally; no live API calls during play
- **Cost control:** Nightly batch sync vs. thousands of per-user API calls
- **Decoupled:** Fore Play unaffected by GHIN API changes; middleware absorbs volatility
- **Scalable:** Redis cache + SQL fallback handle concurrent requests

---

## 7. Deployment

### Local Development
```bash
npm install
npm run dev    # Runs on :3000 with mocks
```

### Azure Deployment
- **Runtime:** Node.js 20.x on Linux App Service
- **Secrets:** Azure Key Vault (DefaultAzureCredential)
  - `APPLICATIONINSIGHTS_CONNECTION_STRING`
  - `GHIN_API_KEY` (future live GHIN API calls)
  - `AZURE_SQL_USER` / `AZURE_SQL_PASSWORD`
  - `REDIS_PASSWORD`
- **Database:** `golfdb` on `golfmatchserver.database.windows.net`
- **Cache:** Azure Redis (TLS, managed identity)
- **CI/CD:** GitHub Actions (ZIP Deploy + optional health check)

### Connection String (for golfmatch-api)
```
https://golfmatch-ghin-middleware.azurewebsites.net/api/v1
```

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
│   │   ├── ghinClient.js                 -- Mock GHIN API client
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

### Add a New Course (Nightly Sync)
1. Fetch from GHIN API: course name, location, tees, hole baselines
2. Call `usp_CreateCourseWithDefaults` → creates Courses row + default CourseDefaults
3. Call `usp_AddTeeForCourseWithRatings` for each additional tee variant
4. Call `usp_ReplaceHoleDefaultsByGender` to populate HoleDefaults

### Test New Endpoints Locally
```bash
# In PowerShell:
./scripts/gm.ps1
Set-GmKey                          # Fetch API key from Key Vault
gmx /api/v1/courses/state/CO       # Test state listing
gmx /api/v1/courses/GHIN-54321/tees # Test tees endpoint
gmx "/api/v1/courses/GHIN-54321/holes?teeId=GHIN-TEE-1001&gender=M"  # Test holes
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
- **Issue:** Mock data missing or transformer error
- **Fix:** Check [src/mocks/ghinData.js](src/mocks/ghinData.js) syntax; run `npm run dev` and inspect logs

### Fore Play Can't Call Middleware
- **Issue:** CORS or API key rejected
- **Fix:** Verify golfmatch-api is sending `X-API-Key` header and its IP is whitelisted in App Service networking

---

## 13. References

- **Repository:** https://github.com/Hold2Admin/golfmatch-ghin-middleware
- **Fore Play:** golfmatch-api (separate repo, calls middleware endpoints)
- **Database:** `golfdb` on `golfmatchserver.database.windows.net`
- **Azure Deployment:** App Service `golfmatch-ghin-middleware.azurewebsites.net`
- **Key Vault:** `golfrm-kv` (shared with Fore Play)

---

**Next Steps:**
1. Integrate middleware endpoints into golfmatch-api (call `/api/v1/courses/state/:state`, `/tees`, `/holes`)
2. Implement nightly GHIN API sync (Phase 2)
3. Add player handicap endpoint (Phase 3)
4. Monitor middleware health via Application Insights
