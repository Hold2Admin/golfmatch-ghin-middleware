const database = require('./database');
const { createLogger } = require('../utils/logger');
const usaGhinApiClient = require('./usaGhinApiClient');
const crypto = require('crypto');
const {
  recordReceived,
  recordProcessedNochange,
  recordProcessedUpdated,
  recordFailed,
  recordReconciliationRun
} = require('./syncMetricsService');
const { persistReconciliationRun } = require('./reconciliationHistoryService');
const courseCachePolicy = require('./courseCachePolicy');

const logger = createLogger('courseSyncService');
const CACHE_TTL_DAYS = courseCachePolicy.LEGACY_TTL_DAYS;
let cacheTablesEnsured = false;
let cacheWritesInFlight = 0;
const cacheWriteWaiters = [];
let mirrorCallbacksInFlight = 0;
const mirrorCallbackWaiters = [];
const courseFetchInFlight = new Map();

function getCacheWriteConcurrency() {
  const configured = Number(
    process.env.GHIN_CACHE_WRITE_CONCURRENCY
    || process.env.GHIN_RECONCILIATION_CONCURRENCY
    || 4
  );
  return Number.isFinite(configured) && configured > 0 ? Math.floor(configured) : 1;
}

function getMirrorCallbackConcurrency() {
  const configured = Number(
    process.env.GHIN_MIRROR_CALLBACK_CONCURRENCY
    || process.env.GHIN_RECONCILIATION_CONCURRENCY
    || 3
  );
  return Number.isFinite(configured) && configured > 0 ? Math.floor(configured) : 1;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getCacheWriteMaxAttempts() {
  const configured = Number(process.env.GHIN_CACHE_WRITE_MAX_ATTEMPTS || 3);
  return Number.isFinite(configured) && configured > 0 ? Math.floor(configured) : 3;
}

function isRetryableCacheWriteError(error) {
  const message = String(error?.message || '').toLowerCase();
  return (
    message.includes('deadlocked on lock resources')
    || message.includes('timeout: request failed to complete')
    || message.includes('request failed to complete in')
    || message.includes('etimeout')
  );
}

async function runWithCacheWriteRetry(courseId, operation) {
  const maxAttempts = getCacheWriteMaxAttempts();

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await runWithCacheWriteSlot(operation);
    } catch (error) {
      const shouldRetry = isRetryableCacheWriteError(error) && attempt < maxAttempts;
      if (!shouldRetry) {
        throw error;
      }

      logger.warn('Cache write failed, retrying', {
        courseId,
        attempt,
        maxAttempts,
        error: error.message
      });
      await sleep(250 * attempt);
    }
  }

  throw new Error(`Cache write failed after ${maxAttempts} attempts for course ${courseId}`);
}

function acquireCacheWriteSlot() {
  return new Promise((resolve) => {
    const tryAcquire = () => {
      const maxConcurrent = getCacheWriteConcurrency();
      if (cacheWritesInFlight < maxConcurrent) {
        cacheWritesInFlight += 1;
        resolve(() => {
          cacheWritesInFlight = Math.max(0, cacheWritesInFlight - 1);
          const next = cacheWriteWaiters.shift();
          if (next) {
            next();
          }
        });
        return;
      }

      cacheWriteWaiters.push(tryAcquire);
    };

    tryAcquire();
  });
}

async function runWithCacheWriteSlot(fn) {
  const release = await acquireCacheWriteSlot();
  try {
    return await fn();
  } finally {
    release();
  }
}

function acquireMirrorCallbackSlot() {
  return new Promise((resolve) => {
    const tryAcquire = () => {
      const maxConcurrent = getMirrorCallbackConcurrency();
      if (mirrorCallbacksInFlight < maxConcurrent) {
        mirrorCallbacksInFlight += 1;
        resolve(() => {
          mirrorCallbacksInFlight = Math.max(0, mirrorCallbacksInFlight - 1);
          const next = mirrorCallbackWaiters.shift();
          if (next) {
            next();
          }
        });
        return;
      }

      mirrorCallbackWaiters.push(tryAcquire);
    };

    tryAcquire();
  });
}

async function runWithMirrorCallbackSlot(fn) {
  const release = await acquireMirrorCallbackSlot();
  try {
    return await fn();
  } finally {
    release();
  }
}

function normalizeMirrorGender(rawGender) {
  const g = String(rawGender || '').trim().toUpperCase();
  if (g === 'W' || g === 'F') return 'F';
  return 'M';
}

function buildMirrorPayload(course) {
  return {
    ghinCourseId: course.courseId,
    courseName: course.courseName,
    shortCourseName: course.shortCourseName || null,
    facilityName: course.facilityName || course.courseName || null,
    city: course.city || null,
    state: course.state || null,
    country: course.country || 'USA',
    facilityId: course.facilityId || null,
    // Must be deterministic for hash/no-op detection; never inject current time.
    sourceLastChangedAt: course.lastUpdatedUtc || null,
    tees: (course.tees || []).map((tee) => ({
      ghinTeeId: tee.teeId,
      teeName: tee.teeName,
      gender: normalizeMirrorGender(tee.gender),
      teeSetSide: tee.teeSetSide || 'All18',
      isDefault: tee.isDefault ? 1 : 0,
      courseRating18: tee.courseRating ?? null,
      slopeRating18: tee.slope ?? null,
      par18: tee.par ?? null,
      yardage18: tee.yardage ?? null,
      courseRatingF9: tee.courseRatingF9 ?? null,
      slopeRatingF9: tee.slopeRatingF9 ?? null,
      parF9: tee.parF9 ?? null,
      yardageF9: tee.yardageF9 ?? null,
      courseRatingB9: tee.courseRatingB9 ?? null,
      slopeRatingB9: tee.slopeRatingB9 ?? null,
      parB9: tee.parB9 ?? null,
      yardageB9: tee.yardageB9 ?? null,
      holes: (tee.holes || []).map((hole) => ({
        holeNumber: hole.holeNumber,
        par: hole.par,
        handicap: hole.handicap,
        yardage: hole.yardage
      }))
    }))
  };
}

function teeSortKey(tee) {
  const id = String(tee?.ghinTeeId || '').trim();
  if (id) {
    return `id:${id}`;
  }
  return `name:${String(tee?.teeName || '')}|${String(tee?.gender || '')}|${String(tee?.teeSetSide || '')}`;
}

// Align with golfmatch-api normalizeCoursePayload: tee order / hole order must not affect hash.
function orderStabilizeForHash(payload) {
  if (!payload || typeof payload !== 'object') {
    return payload;
  }

  const next = { ...payload };
  if (!Array.isArray(next.tees)) {
    return next;
  }

  next.tees = next.tees.map((tee) => {
    const t = { ...tee };
    if (Array.isArray(t.holes)) {
      t.holes = [...t.holes].sort((a, b) => Number(a.holeNumber) - Number(b.holeNumber));
    }
    return t;
  }).sort((a, b) => teeSortKey(a).localeCompare(teeSortKey(b)));

  return next;
}

function stableNormalize(value) {
  if (Array.isArray(value)) {
    return value.map(stableNormalize);
  }

  if (value && typeof value === 'object') {
    const sorted = {};
    Object.keys(value)
      .sort()
      .forEach((key) => {
        sorted[key] = stableNormalize(value[key]);
      });
    return sorted;
  }

  return value;
}

function hashPayload(payload) {
  const normalized = stableNormalize(orderStabilizeForHash(payload));
  const serialized = JSON.stringify(normalized);
  return crypto.createHash('sha256').update(serialized).digest('hex');
}

function buildTeeStructurePayload(payload) {
  return {
    ghinCourseId: payload?.ghinCourseId || null,
    tees: payload?.tees || []
  };
}

function buildCacheUpsertPayload(courses, options = {}) {
  const now = options.now instanceof Date ? options.now : new Date();
  const expiry = courseCachePolicy.computeCacheExpiresAt(now, options);


  const cacheSource = courseCachePolicy.resolveCacheSource(options.cacheSource, options);

  const courseRows = [];
  const teeRows = [];
  const holeRows = [];
  const courseIds = [];

  for (const course of courses || []) {
    if (!course) {
      continue;
    }

    const mirrorPayload = buildMirrorPayload(course);
    const hashes = {
      payloadHash: hashPayload(mirrorPayload),
      teeStructureHash: hashPayload(buildTeeStructurePayload(mirrorPayload))
    };

    const courseId = String(course.courseId);
    courseIds.push(courseId);
    courseRows.push({
      courseId,
      facilityId: course.facilityId || null,
      facilityName: course.facilityName || course.courseName || null,
      courseName: course.courseName,
      shortCourseName: course.shortCourseName || null,
      city: course.city || null,
      state: course.state || null,
      country: course.country || 'USA',
      lastPayloadHash: hashes.payloadHash,
      lastTeeStructureHash: hashes.teeStructureHash
    });

    for (const tee of course.tees || []) {
      teeRows.push({
        teeId: String(tee.teeId),
        courseId,
        teeName: tee.teeName || null,
        teeSetSide: tee.teeSetSide || 'All18',
        gender: tee.gender || 'M',
        isDefault: tee.isDefault ? 1 : 0,
        courseRating18: tee.courseRating ?? null,
        slopeRating18: tee.slope != null ? Math.round(tee.slope) : null,
        par18: tee.par != null ? Math.round(tee.par) : null,
        yardage18: tee.yardage != null ? Math.round(tee.yardage) : null,
        courseRatingF9: tee.courseRatingF9 ?? null,
        slopeRatingF9: tee.slopeRatingF9 != null ? Math.round(tee.slopeRatingF9) : null,
        parF9: tee.parF9 != null ? Math.round(tee.parF9) : null,
        yardageF9: tee.yardageF9 != null ? Math.round(tee.yardageF9) : null,
        courseRatingB9: tee.courseRatingB9 ?? null,
        slopeRatingB9: tee.slopeRatingB9 != null ? Math.round(tee.slopeRatingB9) : null,
        parB9: tee.parB9 != null ? Math.round(tee.parB9) : null,
        yardageB9: tee.yardageB9 != null ? Math.round(tee.yardageB9) : null
      });

      for (const hole of tee.holes || []) {
        holeRows.push({
          courseId,
          teeId: String(tee.teeId),
          holeNumber: hole.holeNumber,
          par: hole.par,
          handicap: hole.handicap,
          yardage: hole.yardage ?? 0
        });
      }
    }
  }

  return {
    courseIds,
    courseRows,
    teeRows,
    holeRows,
    cachedAt: now,
    expiresAt: expiry,
    cacheSource
  };
}

function buildSingleCourseCacheUpsertPayload(course, hashes = {}, options = {}) {
  const payload = buildCacheUpsertPayload([course], options);
  if (payload.courseRows.length > 0) {
    payload.courseRows[0].lastPayloadHash = hashes.payloadHash || payload.courseRows[0].lastPayloadHash;
    payload.courseRows[0].lastTeeStructureHash = hashes.teeStructureHash || payload.courseRows[0].lastTeeStructureHash;
  }
  return payload;
}

async function mergeCacheCourseHeaders(tx, payload) {
  const sql = database.sql;

  await tx.request()
    .input('coursesJson', sql.NVarChar(sql.MAX), JSON.stringify(payload.courseRows))
    .input('cachedAt', sql.DateTime2, payload.cachedAt)
    .input('expiresAt', sql.DateTime2, payload.expiresAt)
    .input('cacheSource', sql.NVarChar(50), payload.cacheSource)
    .query(`
      CREATE TABLE #StageCourses (
        CourseId VARCHAR(50) NOT NULL PRIMARY KEY,
        FacilityId VARCHAR(50) NULL,
        FacilityName NVARCHAR(200) NULL,
        CourseName NVARCHAR(200) NOT NULL,
        ShortCourseName NVARCHAR(200) NULL,
        City NVARCHAR(100) NULL,
        State VARCHAR(10) NULL,
        Country VARCHAR(10) NOT NULL,
        LastPayloadHash VARCHAR(64) NULL,
        LastTeeStructureHash VARCHAR(64) NULL
      );

      INSERT INTO #StageCourses (
        CourseId,
        FacilityId,
        FacilityName,
        CourseName,
        ShortCourseName,
        City,
        State,
        Country,
        LastPayloadHash,
        LastTeeStructureHash
      )
      SELECT
        src.courseId,
        src.facilityId,
        src.facilityName,
        src.courseName,
        src.shortCourseName,
        src.city,
        src.state,
        src.country,
        src.lastPayloadHash,
        src.lastTeeStructureHash
      FROM OPENJSON(@coursesJson)
      WITH (
        courseId VARCHAR(50) '$.courseId',
        facilityId VARCHAR(50) '$.facilityId',
        facilityName NVARCHAR(200) '$.facilityName',
        courseName NVARCHAR(200) '$.courseName',
        shortCourseName NVARCHAR(200) '$.shortCourseName',
        city NVARCHAR(100) '$.city',
        state VARCHAR(10) '$.state',
        country VARCHAR(10) '$.country',
        lastPayloadHash VARCHAR(64) '$.lastPayloadHash',
        lastTeeStructureHash VARCHAR(64) '$.lastTeeStructureHash'
      ) AS src;

      MERGE dbo.GHIN_Courses WITH (HOLDLOCK) AS target
      USING #StageCourses AS src
        ON target.CourseId = src.CourseId
      WHEN MATCHED THEN UPDATE SET
        FacilityId = src.FacilityId,
        FacilityName = src.FacilityName,
        CourseName = src.CourseName,
        ShortCourseName = src.ShortCourseName,
        City = src.City,
        State = src.State,
        Country = src.Country,
        CachedAt = @cachedAt,
        ExpiresAt = @expiresAt,
        CacheSource = @cacheSource,
        LastPayloadHash = src.LastPayloadHash,
        LastTeeStructureHash = src.LastTeeStructureHash,
        UpdatedAt = GETUTCDATE()
      WHEN NOT MATCHED THEN INSERT (
        CourseId,
        FacilityId,
        FacilityName,
        CourseName,
        ShortCourseName,
        City,
        State,
        Country,
        CachedAt,
        ExpiresAt,
        CacheSource,
        LastPayloadHash,
        LastTeeStructureHash
      )
      VALUES (
        src.CourseId,
        src.FacilityId,
        src.FacilityName,
        src.CourseName,
        src.ShortCourseName,
        src.City,
        src.State,
        src.Country,
        @cachedAt,
        @expiresAt,
        @cacheSource,
        src.LastPayloadHash,
        src.LastTeeStructureHash
      );
    `);
}

async function hasExistingCacheChildren(tx, payload) {
  const sql = database.sql;
  const result = await tx.request()
    .input('courseIdsJson', sql.NVarChar(sql.MAX), JSON.stringify(payload.courseIds))
    .query(`
      SELECT TOP 1 1 AS hasExisting
      FROM dbo.GHIN_Tees t
      WHERE t.CourseId IN (SELECT [value] FROM OPENJSON(@courseIdsJson));
    `);

  return result.recordset.length > 0;
}

async function insertCacheCourseChildren(tx, payload) {
  const sql = database.sql;
  const result = await tx.request()
    .input('teesJson', sql.NVarChar(sql.MAX), JSON.stringify(payload.teeRows))
    .input('holesJson', sql.NVarChar(sql.MAX), JSON.stringify(payload.holeRows))
    .input('cachedAt', sql.DateTime2, payload.cachedAt)
    .query(`
      DECLARE @TeesStartedAt DATETIME2 = SYSUTCDATETIME();

      INSERT INTO dbo.GHIN_Tees (
        CourseId,
        TeeId,
        TeeName,
        TeeSetSide,
        Gender,
        IsDefault,
        CourseRating18,
        SlopeRating18,
        Par18,
        Yardage18,
        CourseRatingF9,
        SlopeRatingF9,
        ParF9,
        YardageF9,
        CourseRatingB9,
        SlopeRatingB9,
        ParB9,
        YardageB9,
        CachedAt
      )
      SELECT
        src.courseId,
        src.teeId,
        src.teeName,
        src.teeSetSide,
        src.gender,
        src.isDefault,
        src.courseRating18,
        src.slopeRating18,
        src.par18,
        src.yardage18,
        src.courseRatingF9,
        src.slopeRatingF9,
        src.parF9,
        src.yardageF9,
        src.courseRatingB9,
        src.slopeRatingB9,
        src.parB9,
        src.yardageB9,
        @cachedAt
      FROM OPENJSON(@teesJson)
      WITH (
        teeId VARCHAR(50) '$.teeId',
        courseId VARCHAR(50) '$.courseId',
        teeName NVARCHAR(100) '$.teeName',
        teeSetSide VARCHAR(10) '$.teeSetSide',
        gender CHAR(1) '$.gender',
        isDefault BIT '$.isDefault',
        courseRating18 DECIMAL(4,1) '$.courseRating18',
        slopeRating18 INT '$.slopeRating18',
        par18 INT '$.par18',
        yardage18 INT '$.yardage18',
        courseRatingF9 DECIMAL(4,1) '$.courseRatingF9',
        slopeRatingF9 INT '$.slopeRatingF9',
        parF9 INT '$.parF9',
        yardageF9 INT '$.yardageF9',
        courseRatingB9 DECIMAL(4,1) '$.courseRatingB9',
        slopeRatingB9 INT '$.slopeRatingB9',
        parB9 INT '$.parB9',
        yardageB9 INT '$.yardageB9'
      ) AS src;

      DECLARE @TeesDurationMs INT = DATEDIFF(MILLISECOND, @TeesStartedAt, SYSUTCDATETIME());
      DECLARE @HolesStartedAt DATETIME2 = SYSUTCDATETIME();

      INSERT INTO dbo.GHIN_Holes (
        TeeId,
        HoleNumber,
        Par,
        Handicap,
        Yardage
      )
      SELECT
        src.teeId,
        src.holeNumber,
        src.par,
        src.handicap,
        src.yardage
      FROM OPENJSON(@holesJson)
      WITH (
        teeId VARCHAR(50) '$.teeId',
        holeNumber INT '$.holeNumber',
        par INT '$.par',
        handicap INT '$.handicap',
        yardage INT '$.yardage'
      ) AS src;

      DECLARE @HolesDurationMs INT = DATEDIFF(MILLISECOND, @HolesStartedAt, SYSUTCDATETIME());

      SELECT
        @TeesDurationMs AS teesDurationMs,
        @HolesDurationMs AS holesDurationMs;
    `);

  const timings = result.recordset?.[0] || {};

  return {
    teesDurationMs: Number(timings.teesDurationMs || 0),
    holesDurationMs: Number(timings.holesDurationMs || 0)
  };
}

async function mergeCacheCourseChildren(tx, payload) {
  const existingChildren = await hasExistingCacheChildren(tx, payload);
  if (!existingChildren) {
    return insertCacheCourseChildren(tx, payload);
  }

  const sql = database.sql;
  const result = await tx.request()
    .input('courseIdsJson', sql.NVarChar(sql.MAX), JSON.stringify(payload.courseIds))
    .input('teesJson', sql.NVarChar(sql.MAX), JSON.stringify(payload.teeRows))
    .input('holesJson', sql.NVarChar(sql.MAX), JSON.stringify(payload.holeRows))
    .input('cachedAt', sql.DateTime2, payload.cachedAt)
    .query(`
      DECLARE @TeesStartedAt DATETIME2 = SYSUTCDATETIME();

      CREATE TABLE #StageCourseIds (
        CourseId VARCHAR(50) NOT NULL PRIMARY KEY
      );

      CREATE TABLE #StageTees (
        CourseId VARCHAR(50) NOT NULL,
        TeeId VARCHAR(50) NOT NULL PRIMARY KEY,
        TeeName NVARCHAR(100) NULL,
        TeeSetSide VARCHAR(10) NOT NULL,
        Gender CHAR(1) NOT NULL,
        IsDefault BIT NOT NULL,
        CourseRating18 DECIMAL(4,1) NULL,
        SlopeRating18 INT NULL,
        Par18 INT NULL,
        Yardage18 INT NULL,
        CourseRatingF9 DECIMAL(4,1) NULL,
        SlopeRatingF9 INT NULL,
        ParF9 INT NULL,
        YardageF9 INT NULL,
        CourseRatingB9 DECIMAL(4,1) NULL,
        SlopeRatingB9 INT NULL,
        ParB9 INT NULL,
        YardageB9 INT NULL
      );

      CREATE TABLE #StageHoles (
        TeeId VARCHAR(50) NOT NULL,
        HoleNumber INT NOT NULL,
        Par INT NOT NULL,
        Handicap INT NOT NULL,
        Yardage INT NOT NULL,
        PRIMARY KEY (TeeId, HoleNumber)
      );

      INSERT INTO #StageCourseIds (CourseId)
      SELECT [value]
      FROM OPENJSON(@courseIdsJson);

      INSERT INTO #StageTees (
        CourseId,
        TeeId,
        TeeName,
        TeeSetSide,
        Gender,
        IsDefault,
        CourseRating18,
        SlopeRating18,
        Par18,
        Yardage18,
        CourseRatingF9,
        SlopeRatingF9,
        ParF9,
        YardageF9,
        CourseRatingB9,
        SlopeRatingB9,
        ParB9,
        YardageB9
      )
      SELECT
        src.courseId,
        src.teeId,
        src.teeName,
        src.teeSetSide,
        src.gender,
        src.isDefault,
        src.courseRating18,
        src.slopeRating18,
        src.par18,
        src.yardage18,
        src.courseRatingF9,
        src.slopeRatingF9,
        src.parF9,
        src.yardageF9,
        src.courseRatingB9,
        src.slopeRatingB9,
        src.parB9,
        src.yardageB9
      FROM OPENJSON(@teesJson)
      WITH (
        teeId VARCHAR(50) '$.teeId',
        courseId VARCHAR(50) '$.courseId',
        teeName NVARCHAR(100) '$.teeName',
        teeSetSide VARCHAR(10) '$.teeSetSide',
        gender CHAR(1) '$.gender',
        isDefault BIT '$.isDefault',
        courseRating18 DECIMAL(4,1) '$.courseRating18',
        slopeRating18 INT '$.slopeRating18',
        par18 INT '$.par18',
        yardage18 INT '$.yardage18',
        courseRatingF9 DECIMAL(4,1) '$.courseRatingF9',
        slopeRatingF9 INT '$.slopeRatingF9',
        parF9 INT '$.parF9',
        yardageF9 INT '$.yardageF9',
        courseRatingB9 DECIMAL(4,1) '$.courseRatingB9',
        slopeRatingB9 INT '$.slopeRatingB9',
        parB9 INT '$.parB9',
        yardageB9 INT '$.yardageB9'
      ) AS src;

      INSERT INTO #StageHoles (
        TeeId,
        HoleNumber,
        Par,
        Handicap,
        Yardage
      )
      SELECT
        src.teeId,
        src.holeNumber,
        src.par,
        src.handicap,
        src.yardage
      FROM OPENJSON(@holesJson)
      WITH (
        teeId VARCHAR(50) '$.teeId',
        holeNumber INT '$.holeNumber',
        par INT '$.par',
        handicap INT '$.handicap',
        yardage INT '$.yardage'
      ) AS src;

      CREATE INDEX IX_StageTees_CourseId ON #StageTees (CourseId);

      UPDATE target
      SET
        CourseId = src.CourseId,
        TeeName = src.TeeName,
        TeeSetSide = src.TeeSetSide,
        Gender = src.Gender,
        IsDefault = src.IsDefault,
        CourseRating18 = src.CourseRating18,
        SlopeRating18 = src.SlopeRating18,
        Par18 = src.Par18,
        Yardage18 = src.Yardage18,
        CourseRatingF9 = src.CourseRatingF9,
        SlopeRatingF9 = src.SlopeRatingF9,
        ParF9 = src.ParF9,
        YardageF9 = src.YardageF9,
        CourseRatingB9 = src.CourseRatingB9,
        SlopeRatingB9 = src.SlopeRatingB9,
        ParB9 = src.ParB9,
        YardageB9 = src.YardageB9,
        CachedAt = @cachedAt,
        UpdatedAt = GETUTCDATE()
      FROM dbo.GHIN_Tees target
      INNER JOIN #StageTees src
        ON src.TeeId = target.TeeId
      WHERE
        ISNULL(target.CourseId, '') <> ISNULL(src.CourseId, '')
        OR ISNULL(target.TeeName, '') <> ISNULL(src.TeeName, '')
        OR ISNULL(target.TeeSetSide, '') <> ISNULL(src.TeeSetSide, '')
        OR ISNULL(target.Gender, '') <> ISNULL(src.Gender, '')
        OR ISNULL(target.IsDefault, 0) <> ISNULL(src.IsDefault, 0)
        OR ISNULL(target.CourseRating18, -1) <> ISNULL(src.CourseRating18, -1)
        OR ISNULL(target.SlopeRating18, -1) <> ISNULL(src.SlopeRating18, -1)
        OR ISNULL(target.Par18, -1) <> ISNULL(src.Par18, -1)
        OR ISNULL(target.Yardage18, -1) <> ISNULL(src.Yardage18, -1)
        OR ISNULL(target.CourseRatingF9, -1) <> ISNULL(src.CourseRatingF9, -1)
        OR ISNULL(target.SlopeRatingF9, -1) <> ISNULL(src.SlopeRatingF9, -1)
        OR ISNULL(target.ParF9, -1) <> ISNULL(src.ParF9, -1)
        OR ISNULL(target.YardageF9, -1) <> ISNULL(src.YardageF9, -1)
        OR ISNULL(target.CourseRatingB9, -1) <> ISNULL(src.CourseRatingB9, -1)
        OR ISNULL(target.SlopeRatingB9, -1) <> ISNULL(src.SlopeRatingB9, -1)
        OR ISNULL(target.ParB9, -1) <> ISNULL(src.ParB9, -1)
        OR ISNULL(target.YardageB9, -1) <> ISNULL(src.YardageB9, -1);

      INSERT INTO dbo.GHIN_Tees (
        CourseId,
        TeeId,
        TeeName,
        TeeSetSide,
        Gender,
        IsDefault,
        CourseRating18,
        SlopeRating18,
        Par18,
        Yardage18,
        CourseRatingF9,
        SlopeRatingF9,
        ParF9,
        YardageF9,
        CourseRatingB9,
        SlopeRatingB9,
        ParB9,
        YardageB9,
        CachedAt
      )
      SELECT
        src.CourseId,
        src.TeeId,
        src.TeeName,
        src.TeeSetSide,
        src.Gender,
        src.IsDefault,
        src.CourseRating18,
        src.SlopeRating18,
        src.Par18,
        src.Yardage18,
        src.CourseRatingF9,
        src.SlopeRatingF9,
        src.ParF9,
        src.YardageF9,
        src.CourseRatingB9,
        src.SlopeRatingB9,
        src.ParB9,
        src.YardageB9,
        @cachedAt
      FROM #StageTees src
      LEFT JOIN dbo.GHIN_Tees target
        ON target.TeeId = src.TeeId
      WHERE target.TeeId IS NULL;

      DECLARE @TeesDurationMs INT = DATEDIFF(MILLISECOND, @TeesStartedAt, SYSUTCDATETIME());
      DECLARE @HolesStartedAt DATETIME2 = SYSUTCDATETIME();

      UPDATE target
      SET
        Par = src.Par,
        Handicap = src.Handicap,
        Yardage = src.Yardage
      FROM dbo.GHIN_Holes target
      INNER JOIN #StageHoles src
        ON src.TeeId = target.TeeId
       AND src.HoleNumber = target.HoleNumber
      WHERE
        target.Par <> src.Par
        OR target.Handicap <> src.Handicap
        OR target.Yardage <> src.Yardage;

      INSERT INTO dbo.GHIN_Holes (
        TeeId,
        HoleNumber,
        Par,
        Handicap,
        Yardage
      )
      SELECT
        src.TeeId,
        src.HoleNumber,
        src.Par,
        src.Handicap,
        src.Yardage
      FROM #StageHoles src
      LEFT JOIN dbo.GHIN_Holes target
        ON target.TeeId = src.TeeId
       AND target.HoleNumber = src.HoleNumber
      WHERE target.TeeId IS NULL;

      DELETE target
      FROM dbo.GHIN_Holes target
      INNER JOIN #StageTees stagedTees
        ON stagedTees.TeeId = target.TeeId
      LEFT JOIN #StageHoles src
        ON src.TeeId = target.TeeId
       AND src.HoleNumber = target.HoleNumber
      WHERE src.TeeId IS NULL;

      DELETE target
      FROM dbo.GHIN_Tees target
      INNER JOIN #StageCourseIds courseIds
        ON courseIds.CourseId = target.CourseId
      LEFT JOIN #StageTees src
        ON src.TeeId = target.TeeId
      WHERE src.TeeId IS NULL;

      DECLARE @HolesDurationMs INT = DATEDIFF(MILLISECOND, @HolesStartedAt, SYSUTCDATETIME());

      SELECT
        @TeesDurationMs AS teesDurationMs,
        @HolesDurationMs AS holesDurationMs;
    `);

  const timings = result.recordset?.[0] || {};

  return {
    teesDurationMs: Number(timings.teesDurationMs || 0),
    holesDurationMs: Number(timings.holesDurationMs || 0)
  };
}

function validateCourseMirrorShape(course) {
  const courseId = String(course?.courseId || '').trim();
  const courseName = String(course?.courseName || '').trim();
  const tees = Array.isArray(course?.tees) ? course.tees : [];

  if (!courseId) {
    throw new Error('Missing required field: ghinCourseId');
  }

  if (!courseName) {
    throw new Error(`Course ${courseId} missing required field: courseName`);
  }

  if (!tees.length) {
    throw new Error(`Course ${courseId} missing required field: tees[]`);
  }

  tees.forEach((tee, teeIndex) => {
    const teeId = String(tee?.teeId || '').trim();
    const teeName = String(tee?.teeName || '').trim();
    const holes = Array.isArray(tee?.holes) ? tee.holes : [];
    const seenHoleNumbers = new Set();

    if (!teeId) {
      throw new Error(`Course ${courseId} tees[${teeIndex}] missing ghinTeeId`);
    }

    if (!teeName) {
      throw new Error(`Course ${courseId} tees[${teeIndex}] missing teeName`);
    }

    if (!holes.length) {
      throw new Error(`Course ${courseId} tees[${teeIndex}] missing holes[]`);
    }

    holes.forEach((hole, holeIndex) => {
      const holeNumber = Number(hole?.holeNumber);
      const par = Number(hole?.par);

      if (!Number.isFinite(holeNumber) || !Number.isFinite(par)) {
        throw new Error(`Course ${courseId} tees[${teeIndex}].holes[${holeIndex}] missing holeNumber/par`);
      }

      if (holeNumber < 1 || holeNumber > 18) {
        throw new Error(`Course ${courseId} tees[${teeIndex}].holes[${holeIndex}] has invalid holeNumber ${holeNumber}`);
      }

      if (seenHoleNumbers.has(holeNumber)) {
        throw new Error(`Course ${courseId} tees[${teeIndex}] has duplicate holeNumber ${holeNumber}`);
      }

      seenHoleNumbers.add(holeNumber);

      if (par < 2 || par > 7) {
        throw new Error(`Course ${courseId} tees[${teeIndex}].holes[${holeIndex}] has invalid par ${par}`);
      }
    });
  });
}

function validateCourseHoleHandicaps(course) {
  const missing = [];

  for (const tee of course?.tees || []) {
    for (const hole of tee?.holes || []) {
      if (hole?.handicap == null) {
        missing.push({
          teeId: tee.teeId,
          teeName: tee.teeName,
          holeNumber: hole.holeNumber
        });
      }
    }
  }

  if (!missing.length) {
    return;
  }

  const teeIds = Array.from(new Set(missing.map((item) => item.teeId))).length;
  const sample = missing.slice(0, 5)
    .map((item) => `${item.teeId}:${item.holeNumber}`)
    .join(', ');

  throw new Error(
    `GHIN course ${course.courseId} is missing hole handicap/allocation data for ${missing.length} hole rows across ${teeIds} tee set(s). Sample: ${sample}`
  );
}

function validateCourseForSync(course) {
  validateCourseMirrorShape(course);
  validateCourseHoleHandicaps(course);
}

async function ensureCacheTables() {
  if (cacheTablesEnsured) {
    return;
  }

  await database.query(`
    IF OBJECT_ID('dbo.GHIN_Courses', 'U') IS NULL
      THROW 50010, 'CacheDB table missing: dbo.GHIN_Courses.', 1;

    IF OBJECT_ID('dbo.GHIN_Tees', 'U') IS NULL
      THROW 50011, 'CacheDB table missing: dbo.GHIN_Tees.', 1;

    IF OBJECT_ID('dbo.GHIN_Holes', 'U') IS NULL
      THROW 50012, 'CacheDB table missing: dbo.GHIN_Holes.', 1;
  `);

  cacheTablesEnsured = true;
}

async function getCachedCourseHashes(courseId) {
  const sql = database.sql;
  const rows = await database.query(
    `SELECT LastPayloadHash AS lastPayloadHash, LastTeeStructureHash AS lastTeeStructureHash
     FROM dbo.GHIN_Courses
     WHERE CourseId = @courseId`,
    { courseId: { type: sql.VarChar(50), value: courseId } }
  );

  if (!rows.length) {
    return null;
  }

  return {
    payloadHash: rows[0].lastPayloadHash || null,
    teeStructureHash: rows[0].lastTeeStructureHash || null
  };
}

async function buildMirrorPayloadFromCache(courseId) {
  const sql = database.sql;

  const courses = await database.query(
    `SELECT
        CourseId AS courseId,
        CourseName AS courseName,
        ShortCourseName AS shortCourseName,
        FacilityName AS facilityName,
        City AS city,
        State AS state,
        Country AS country,
        FacilityId AS facilityId,
        UpdatedAt AS updatedAt
     FROM dbo.GHIN_Courses
     WHERE CourseId = @courseId`,
    { courseId: { type: sql.VarChar, value: courseId } }
  );

  if (!courses.length) {
    return null;
  }

  const course = courses[0];
  const tees = await database.query(
    `SELECT
        TeeId AS teeId,
        TeeName AS teeName,
        Gender AS gender,
        TeeSetSide AS teeSetSide,
        IsDefault AS isDefault,
        CourseRating18 AS courseRating18,
        SlopeRating18 AS slopeRating18,
        Par18 AS par18,
        Yardage18 AS yardage18,
        CourseRatingF9 AS courseRatingF9,
        SlopeRatingF9 AS slopeRatingF9,
        ParF9 AS parF9,
        YardageF9 AS yardageF9,
        CourseRatingB9 AS courseRatingB9,
        SlopeRatingB9 AS slopeRatingB9,
        ParB9 AS parB9,
        YardageB9 AS yardageB9
     FROM dbo.GHIN_Tees
     WHERE CourseId = @courseId
     ORDER BY TeeId`,
    { courseId: { type: sql.VarChar(50), value: course.courseId } }
  );

  const holesByTee = new Map();

  const allHoles = await database.query(
    `SELECT
        t.TeeId AS teeId,
        h.HoleNumber AS holeNumber,
        h.Par AS par,
        h.Handicap AS handicap,
        h.Yardage AS yardage
     FROM dbo.GHIN_Holes h
       INNER JOIN dbo.GHIN_Tees t ON t.TeeId = h.TeeId
       WHERE t.CourseId = @courseId
     ORDER BY t.TeeId, h.HoleNumber`,
      { courseId: { type: sql.VarChar(50), value: course.courseId } }
  );

  for (const hole of allHoles) {
    const key = String(hole.teeId);
    if (!holesByTee.has(key)) {
      holesByTee.set(key, []);
    }
    holesByTee.get(key).push({
      holeNumber: hole.holeNumber,
      par: hole.par,
      handicap: hole.handicap,
      yardage: hole.yardage
    });
  }

  return {
    ghinCourseId: String(course.courseId),
    courseName: course.courseName,
    shortCourseName: course.shortCourseName || null,
    facilityName: course.facilityName || course.courseName || null,
    city: course.city || null,
    state: course.state || null,
    country: course.country || 'USA',
    facilityId: course.facilityId || null,
    // Cache schema does not persist an external source timestamp today.
    // Keep this null to avoid false hash drift between incoming and cached payloads.
    sourceLastChangedAt: null,
    tees: tees.map((tee) => ({
      ghinTeeId: String(tee.teeId),
      teeName: tee.teeName,
      gender: normalizeMirrorGender(tee.gender),
      teeSetSide: tee.teeSetSide || 'All18',
      isDefault: tee.isDefault ? 1 : 0,
      courseRating18: tee.courseRating18 ?? null,
      slopeRating18: tee.slopeRating18 ?? null,
      par18: tee.par18 ?? null,
      yardage18: tee.yardage18 ?? null,
      courseRatingF9: tee.courseRatingF9 ?? null,
      slopeRatingF9: tee.slopeRatingF9 ?? null,
      parF9: tee.parF9 ?? null,
      yardageF9: tee.yardageF9 ?? null,
      courseRatingB9: tee.courseRatingB9 ?? null,
      slopeRatingB9: tee.slopeRatingB9 ?? null,
      parB9: tee.parB9 ?? null,
      yardageB9: tee.yardageB9 ?? null,
      holes: (holesByTee.get(String(tee.teeId)) || []).map((hole) => ({
        holeNumber: hole.holeNumber,
        par: hole.par,
        handicap: hole.handicap,
        yardage: hole.yardage
      }))
    }))
  };
}

async function upsertCourseToCache(course, hashes = {}, options = {}) {
  const pool = await database.connect();
  if (!pool) {
    throw new Error('Cache DB is not configured. Cannot process course webhook.');
  }

  await ensureCacheTables();

  const sql = database.sql;
  const tx = new sql.Transaction(pool);
  await tx.begin();

  const now = new Date();
  const expiry = courseCachePolicy.computeCacheExpiresAt(now, options);
  const payload = buildSingleCourseCacheUpsertPayload(course, hashes, {
    now,
    expiry,
    cacheSource: courseCachePolicy.resolveCacheSource(options.cacheSource, options)
  });

  try {
    await mergeCacheCourseHeaders(tx, payload);
    await mergeCacheCourseChildren(tx, payload);

    await tx.commit();
  } catch (error) {
    try {
      await tx.rollback();
    } catch (_) {
      // ignore rollback errors when already completed
    }
    throw error;
  }
}

async function bulkUpsertCoursesToCache(courses, options = {}) {
  if (!Array.isArray(courses) || courses.length === 0) {
    return {
      status: 'no-op',
      courseCount: 0,
      teeCount: 0,
      holeCount: 0,
      timings: {
        buildPayloadDurationMs: 0,
        coursesMergeDurationMs: 0,
        teesMergeDurationMs: 0,
        holesMergeDurationMs: 0,
        commitDurationMs: 0,
        totalDurationMs: 0
      }
    };
  }

  const startedAtMs = Date.now();
  const buildPayloadStartedAtMs = Date.now();
  const payload = buildCacheUpsertPayload(courses, options);
  const buildPayloadDurationMs = Date.now() - buildPayloadStartedAtMs;
  const batchLabel = payload.courseIds.length === 1
    ? payload.courseIds[0]
    : `batch:${payload.courseIds[0]}-${payload.courseIds[payload.courseIds.length - 1]}`;

  return runWithCacheWriteRetry(batchLabel, async () => {
    const pool = await database.connect();
    if (!pool) {
      throw new Error('Cache DB is not configured. Cannot process course batch.');
    }

    await ensureCacheTables();

    const sql = database.sql;
    const tx = new sql.Transaction(pool);
    await tx.begin();

    try {
      const coursesMergeStartedAtMs = Date.now();
      await mergeCacheCourseHeaders(tx, payload);
      const coursesMergeDurationMs = Date.now() - coursesMergeStartedAtMs;

      const childMergeTimings = await mergeCacheCourseChildren(tx, payload);
      const teesMergeDurationMs = childMergeTimings.teesDurationMs;
      const holesMergeDurationMs = childMergeTimings.holesDurationMs;
      const commitStartedAtMs = Date.now();
      await tx.commit();
      const commitDurationMs = Date.now() - commitStartedAtMs;

      return {
        status: 'updated',
        courseCount: payload.courseRows.length,
        teeCount: payload.teeRows.length,
        holeCount: payload.holeRows.length,
        timings: {
          buildPayloadDurationMs,
          coursesMergeDurationMs,
          teesMergeDurationMs,
          holesMergeDurationMs,
          commitDurationMs,
          totalDurationMs: Date.now() - startedAtMs
        }
      };
    } catch (error) {
      try {
        await tx.rollback();
      } catch (_) {
        // ignore rollback errors when already completed
      }
      throw error;
    }
  });
}

async function upsertCourseHeaderToCache(course, hashes = {}, options = {}) {
  await ensureCacheTables();

  const sql = database.sql;
  const now = new Date();
  const expiry = courseCachePolicy.computeCacheExpiresAt(now, options);

  await database.query(
    `UPDATE dbo.GHIN_Courses
     SET FacilityId = @facilityId,
         FacilityName = @facilityName,
         CourseName = @courseName,
         ShortCourseName = @shortCourseName,
         City = @city,
         State = @state,
         Country = @country,
         CachedAt = @cachedAt,
         ExpiresAt = @expiresAt,
         CacheSource = @cacheSource,
         LastPayloadHash = @lastPayloadHash,
         LastTeeStructureHash = @lastTeeStructureHash,
         UpdatedAt = GETUTCDATE()
     WHERE CourseId = @courseId`,
    {
      courseId: { type: sql.VarChar(50), value: course.courseId },
      facilityId: { type: sql.VarChar(50), value: course.facilityId || null },
      facilityName: { type: sql.NVarChar(200), value: course.facilityName || course.courseName || null },
      courseName: { type: sql.NVarChar(200), value: course.courseName },
      shortCourseName: { type: sql.NVarChar(200), value: course.shortCourseName || null },
      city: { type: sql.NVarChar(100), value: course.city || null },
      state: { type: sql.VarChar(10), value: course.state || null },
      country: { type: sql.VarChar(10), value: course.country || 'USA' },
      cachedAt: { type: sql.DateTime2, value: now },
      expiresAt: { type: sql.DateTime2, value: expiry },
      cacheSource: { type: sql.NVarChar(50), value: courseCachePolicy.resolveCacheSource(options.cacheSource, options) },
      lastPayloadHash: { type: sql.VarChar(64), value: hashes.payloadHash || null },
      lastTeeStructureHash: { type: sql.VarChar(64), value: hashes.teeStructureHash || null }
    }
  );
}

async function syncMirrorForCourse(course) {
  const callbackUrl = process.env.GHIN_IMPORT_CALLBACK_URL;
  const callbackApiKey = process.env.GHIN_MIDDLEWARE_API_KEY;

  if (!callbackUrl) {
    throw new Error('GHIN_IMPORT_CALLBACK_URL is required for mirror sync.');
  }
  if (!callbackApiKey) {
    throw new Error('GHIN_MIDDLEWARE_API_KEY is required for mirror callback auth.');
  }

  const payload = buildMirrorPayload(course);
  const maxAttempts = Math.max(1, Number(process.env.GHIN_MIRROR_CALLBACK_MAX_ATTEMPTS || 2));

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const response = await runWithMirrorCallbackSlot(async () => fetch(callbackUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': callbackApiKey
      },
      body: JSON.stringify(payload)
    }));

    const bodyText = await response.text();
    let parsed = null;
    try {
      parsed = bodyText ? JSON.parse(bodyText) : null;
    } catch (_) {
      parsed = null;
    }

    if (response.ok) {
      return parsed;
    }

    const details = parsed ? JSON.stringify(parsed) : bodyText;
    const isRetryable = response.status >= 500 && attempt < maxAttempts;

    if (isRetryable) {
      logger.warn('Mirror callback failed, retrying', {
        courseId: course.courseId,
        attempt,
        maxAttempts,
        status: response.status
      });
      await sleep(250 * attempt);
      continue;
    }

    throw new Error(`Mirror callback failed (${response.status}): ${details}`);
  }

  throw new Error('Mirror callback failed after retries.');
}

async function processCourseSync(course, options = {}) {
  const detectNoop = options.detectNoop !== false;
  const syncMirror = options.syncMirror !== false;
  const startedAtMs = Date.now();
  const timings = {
    validationDurationMs: 0,
    noopDetectionDurationMs: 0,
    upsertDurationMs: 0,
    mirrorDurationMs: 0,
    totalDurationMs: 0
  };

  function finalizeResult(result) {
    return {
      ...result,
      timings: {
        ...timings,
        totalDurationMs: Date.now() - startedAtMs
      }
    };
  }

  recordReceived();

  try {
    const validationStartedAtMs = Date.now();
    validateCourseForSync(course);
    timings.validationDurationMs = Date.now() - validationStartedAtMs;

    const incomingPayload = buildMirrorPayload(course);
    const incomingHash = hashPayload(incomingPayload);
    const incomingTeeStructureHash = hashPayload(buildTeeStructurePayload(incomingPayload));
    const incomingHashes = {
      payloadHash: incomingHash,
      teeStructureHash: incomingTeeStructureHash
    };
    let cachedPayload = null;
    let useHeaderOnlyUpsert = false;

    await ensureCacheTables();

    if (detectNoop) {
      const noopDetectionStartedAtMs = Date.now();
      const cachedHashes = await getCachedCourseHashes(course.courseId);
      const hashesMissingFromCache = !cachedHashes?.payloadHash || !cachedHashes?.teeStructureHash;
      cachedPayload = await buildMirrorPayloadFromCache(course.courseId);

      let cachedHash = null;
      let cachedTeeStructureHash = null;

      if (cachedPayload) {
        cachedHash = hashPayload(cachedPayload);
        cachedTeeStructureHash = hashPayload(buildTeeStructurePayload(cachedPayload));
      }

      if (cachedHash === incomingHash) {
        if (hashesMissingFromCache || courseCachePolicy.isDayTtlMode() || options.fromWebhook || options.fromRecon || options.cacheSource) {
          await upsertCourseHeaderToCache(course, incomingHashes, {
            cacheSource: options.cacheSource,
            fromWebhook: Boolean(options.fromWebhook),
            fromRecon: Boolean(options.fromRecon)
          });
        }

        recordProcessedNochange();
        logger.info('Course webhook sync skipped (no-op hash match)', {
          courseId: course.courseId,
          hash: incomingHash
        });

        timings.noopDetectionDurationMs = Date.now() - noopDetectionStartedAtMs;

        return finalizeResult({
          status: 'nochange',
          skipped: true,
          reason: 'hash_match',
          hash: incomingHash
        });
      }

      if (cachedTeeStructureHash && cachedTeeStructureHash === incomingTeeStructureHash) {
        useHeaderOnlyUpsert = true;
      }

      if (!cachedPayload) {
        if (cachedHashes?.payloadHash && cachedHashes.payloadHash === incomingHash) {
          if (hashesMissingFromCache || courseCachePolicy.isDayTtlMode() || options.fromWebhook || options.fromRecon || options.cacheSource) {
            await upsertCourseHeaderToCache(course, incomingHashes, {
              cacheSource: options.cacheSource,
              fromWebhook: Boolean(options.fromWebhook),
              fromRecon: Boolean(options.fromRecon)
            });
          }

          recordProcessedNochange();
          logger.info('Course webhook sync skipped (no-op hash match)', {
            courseId: course.courseId,
            hash: incomingHash
          });

          timings.noopDetectionDurationMs = Date.now() - noopDetectionStartedAtMs;

          return finalizeResult({
            status: 'nochange',
            skipped: true,
            reason: 'hash_match',
            hash: incomingHash
          });
        }

        if (!useHeaderOnlyUpsert && cachedHashes?.teeStructureHash) {
          useHeaderOnlyUpsert = cachedHashes.teeStructureHash === incomingTeeStructureHash;
        }
      }

      timings.noopDetectionDurationMs = Date.now() - noopDetectionStartedAtMs;
    }

    const upsertStartedAtMs = Date.now();
    const writeOptions = {
      cacheSource: options.cacheSource,
      fromWebhook: Boolean(options.fromWebhook),
      fromRecon: Boolean(options.fromRecon)
    };
    await runWithCacheWriteRetry(course.courseId, async () => {
      if (useHeaderOnlyUpsert) {
        await upsertCourseHeaderToCache(course, incomingHashes, writeOptions);
      } else {
        await upsertCourseToCache(course, incomingHashes, writeOptions);
      }
    });
    timings.upsertDurationMs = Date.now() - upsertStartedAtMs;

    let mirrorResult = null;

    if (syncMirror) {
      const mirrorStartedAtMs = Date.now();
      mirrorResult = await syncMirrorForCourse(course);
      timings.mirrorDurationMs = Date.now() - mirrorStartedAtMs;
    }

    recordProcessedUpdated();

    logger.info('Course webhook sync completed', {
      courseId: course.courseId,
      teeCount: Array.isArray(course.tees) ? course.tees.length : 0,
      mirrorStatus: syncMirror ? (mirrorResult?.status || 'ok') : 'skipped',
      hash: incomingHash,
      upsertMode: useHeaderOnlyUpsert ? 'header-only' : 'full',
      upsertDurationMs: timings.upsertDurationMs,
      mirrorDurationMs: timings.mirrorDurationMs,
      totalDurationMs: Date.now() - startedAtMs
    });

    return finalizeResult({
      status: syncMirror ? (mirrorResult?.status || 'updated') : 'cache-updated',
      skipped: false,
      hash: incomingHash,
      upsertMode: useHeaderOnlyUpsert ? 'header-only' : 'full',
      mirror: mirrorResult,
      mirrorSkipped: !syncMirror
    });
  } catch (error) {
    recordFailed();
    error.syncTimings = {
      ...timings,
      totalDurationMs: Date.now() - startedAtMs
    };
    throw error;
  }
}

async function reconcileCourses(courseIds, options = {}) {
  const summary = await reconcileCoursesInternal(courseIds, { recordRun: true });

  await persistReconciliationRun(summary, {
    runContext: options.runContext || 'api-explicit'
  });

  return summary;
}

async function reconcileCoursesInternal(courseIds, options = {}) {
  const ids = Array.from(new Set((courseIds || []).map((id) => String(id).trim()).filter(Boolean)));
  const concurrency = Number.isFinite(options.concurrency)
    ? Math.max(1, Math.floor(options.concurrency))
    : Math.max(1, Math.floor(Number(process.env.GHIN_RECONCILIATION_CONCURRENCY || 3)));

  const summary = {
    requested: ids.length,
    updated: 0,
    nochange: 0,
    notFound: 0,
    failed: 0,
    results: []
  };

  logger.info('Reconciliation batch started', {
    requested: ids.length,
    concurrency
  });

  let cursor = 0;

  async function runWorker() {
    while (true) {
      const currentIndex = cursor;
      cursor += 1;

      if (currentIndex >= ids.length) {
        return;
      }

      const courseId = ids[currentIndex];
    const courseStartedAtMs = Date.now();
    try {
      logger.info('Reconciliation course started', { courseId });

      const fetchStartedAtMs = Date.now();
      const course = await usaGhinApiClient.getCourse(courseId);
      const fetchDurationMs = Date.now() - fetchStartedAtMs;

      if (!course) {
        summary.notFound += 1;
        summary.results.push({ courseId, status: 'not_found' });
        logger.warn('Reconciliation course not found', {
          courseId,
          fetchDurationMs,
          totalDurationMs: Date.now() - courseStartedAtMs
        });
        continue;
      }

      const syncStartedAtMs = Date.now();
      const result = await processCourseSync(course, { detectNoop: true });
      const syncDurationMs = Date.now() - syncStartedAtMs;
      if (result.skipped) {
        summary.nochange += 1;
      } else {
        summary.updated += 1;
      }

      summary.results.push({
        courseId,
        status: result.status,
        skipped: Boolean(result.skipped),
        hash: result.hash
      });

      logger.info('Reconciliation course completed', {
        courseId,
        status: result.status,
        skipped: Boolean(result.skipped),
        fetchDurationMs,
        syncDurationMs,
        totalDurationMs: Date.now() - courseStartedAtMs
      });
    } catch (error) {
      summary.failed += 1;
      summary.results.push({ courseId, status: 'failed', error: error.message });
      logger.error('Reconciliation course failed', {
        courseId,
        totalDurationMs: Date.now() - courseStartedAtMs,
        error: error.message
      });
    }
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, Math.max(1, ids.length)) }, () => runWorker());
  await Promise.all(workers);

  if (options.recordRun !== false) {
    recordReconciliationRun(summary);
  }

  logger.info('Reconciliation batch completed', {
    requested: summary.requested,
    updated: summary.updated,
    nochange: summary.nochange,
    notFound: summary.notFound,
    failed: summary.failed,
    concurrency
  });

  return summary;
}

async function getReconciliationCandidateCourseIds(options = {}) {
  const offset = Number.isFinite(options.offset) ? Math.max(0, Math.floor(options.offset)) : 0;
  const batchSize = Number.isFinite(options.batchSize) ? Math.max(1, Math.floor(options.batchSize)) : 100;
  const sql = database.sql;

  const rows = await database.query(
    `SELECT CourseId AS courseId
     FROM dbo.GHIN_Courses
     WHERE UPPER(LTRIM(RTRIM(CacheSource))) <> 'MANUAL'
     ORDER BY TRY_CONVERT(BIGINT, CourseId), CourseId
     OFFSET @offset ROWS FETCH NEXT @batchSize ROWS ONLY`,
    {
      offset: { type: sql.Int, value: offset },
      batchSize: { type: sql.Int, value: batchSize }
    }
  );

  const courseIds = rows.map((r) => String(r.courseId)).filter(Boolean);

  return {
    courseIds,
    offsetUsed: offset,
    nextOffset: offset + courseIds.length,
    wrapped: false,
    hasMore: courseIds.length === batchSize
  };
}

async function reconcileAllCandidates(options = {}) {
  if (courseCachePolicy.isDayTtlMode()) {
    const allow = String(process.env.GHIN_ALLOW_FULL_RECON || '').trim().toLowerCase();
    if (!(allow === '1' || allow === 'true' || allow === 'yes')) {
      const error = new Error('Full-catalog reconciliation is disabled while GHIN_COURSE_CACHE_MODE=day-ttl. Set GHIN_ALLOW_FULL_RECON=1 only for Hold2-approved recovery.');
      error.code = 'FULL_RECON_DISABLED_IN_DAY_TTL';
      throw error;
    }
    logger.warn('Full-catalog reconciliation running under day-ttl with GHIN_ALLOW_FULL_RECON override', {
      runContext: options.runContext || null
    });
  }
  const batchSize = Number.isFinite(options.batchSize)
    ? Math.max(1, Math.floor(options.batchSize))
    : 100;

  const startedAt = Date.now();
  const maxDurationMs = Number.isFinite(options.maxDurationMs) && options.maxDurationMs > 0
    ? Math.floor(options.maxDurationMs)
    : 0;

  let offset = Number.isFinite(options.startOffset) ? Math.max(0, Math.floor(options.startOffset)) : 0;
  let completed = true;

  const aggregate = {
    requested: 0,
    updated: 0,
    nochange: 0,
    notFound: 0,
    failed: 0,
    results: []
  };

  while (true) {
    const candidates = await getReconciliationCandidateCourseIds({ offset, batchSize });
    if (!candidates.courseIds.length) {
      break;
    }

    const summary = await reconcileCoursesInternal(candidates.courseIds, {
      recordRun: false,
      concurrency: options.concurrency
    });
    aggregate.requested += summary.requested;
    aggregate.updated += summary.updated;
    aggregate.nochange += summary.nochange;
    aggregate.notFound += summary.notFound;
    aggregate.failed += summary.failed;
    aggregate.results.push(...summary.results);

    offset = candidates.nextOffset;

    if (maxDurationMs > 0 && Date.now() - startedAt >= maxDurationMs) {
      completed = false;
      break;
    }
  }

  const finalSummary = {
    ...aggregate,
    mode: 'full-sweep',
    batchSize,
    startedAt: new Date(startedAt).toISOString(),
    finishedAt: new Date().toISOString(),
    completed,
    resumeOffset: completed ? 0 : offset
  };

  recordReconciliationRun(finalSummary);

  await persistReconciliationRun(finalSummary, {
    runContext: options.runContext || 'api-full-sweep'
  });

  return finalSummary;
}

async function getCachedCourseFreshness(courseId) {
  const sql = database.sql;
  const rows = await database.query(
    `SELECT CourseId AS courseId, ExpiresAt AS expiresAt, CachedAt AS cachedAt, CacheSource AS cacheSource
     FROM dbo.GHIN_Courses
     WHERE CourseId = @courseId`,
    { courseId: { type: sql.VarChar(50), value: String(courseId) } }
  );
  if (!rows.length) {
    return { exists: false, fresh: false, row: null };
  }
  const row = rows[0];
  return { exists: true, fresh: courseCachePolicy.isCacheFresh(row), row };
}

async function markCourseCacheInvalidated(courseId) {
  await ensureCacheTables();
  const sql = database.sql;
  const now = new Date();
  await database.query(
    `UPDATE dbo.GHIN_Courses
     SET ExpiresAt = @expiresAt,
         UpdatedAt = GETUTCDATE()
     WHERE CourseId = @courseId`,
    {
      courseId: { type: sql.VarChar(50), value: String(courseId) },
      expiresAt: { type: sql.DateTime2, value: now }
    }
  );
  return { courseId: String(courseId), invalidatedAt: now.toISOString() };
}

async function courseHasCachedRatings(courseId) {
  const sql = database.sql;
  const id = String(courseId || '').trim();
  if (!id) return false;
  const rows = await database.query(
    `SELECT TOP 1 1 AS hasRatings
     FROM dbo.GHIN_Tees
     WHERE CourseId = @courseId
       AND (
         CourseRating18 IS NOT NULL
         OR SlopeRating18 IS NOT NULL
         OR CourseRatingF9 IS NOT NULL
         OR SlopeRatingF9 IS NOT NULL
         OR CourseRatingB9 IS NOT NULL
         OR SlopeRatingB9 IS NOT NULL
       )`,
    { courseId: { type: sql.VarChar(50), value: id } }
  );
  return Boolean(rows && rows.length);
}

/**
 * Phase 2: write Course Rating / Slope only; leave public tee/hole structure untouched.
 */
async function upsertCacheDbRatingsOnly(course, options = {}) {
  await ensureCacheTables();
  const sql = database.sql;
  const id = String(course?.courseId || '').trim();
  if (!id) {
    throw new Error('courseId is required for ratings-only upsert');
  }

  const now = options.now instanceof Date ? options.now : new Date();
  const expiry = courseCachePolicy.computeCacheExpiresAt(now, options);
  const cacheSource = courseCachePolicy.resolveCacheSource(
    options.cacheSource || courseCachePolicy.SOURCE_USGA_FETCH,
    options
  );

  await database.query(
    `UPDATE dbo.GHIN_Courses
     SET CachedAt = @cachedAt,
         ExpiresAt = @expiresAt,
         CacheSource = @cacheSource,
         UpdatedAt = GETUTCDATE()
     WHERE CourseId = @courseId`,
    {
      courseId: { type: sql.VarChar(50), value: id },
      cachedAt: { type: sql.DateTime2, value: now },
      expiresAt: { type: sql.DateTime2, value: expiry },
      cacheSource: { type: sql.NVarChar(50), value: cacheSource }
    }
  );

  let updatedTees = 0;
  for (const tee of course.tees || []) {
    const teeId = String(tee.teeId || '').trim();
    if (!teeId) continue;
    const rows = await database.query(
      `UPDATE dbo.GHIN_Tees
       SET CourseRating18 = @courseRating18,
           SlopeRating18 = @slopeRating18,
           CourseRatingF9 = @courseRatingF9,
           SlopeRatingF9 = @slopeRatingF9,
           CourseRatingB9 = @courseRatingB9,
           SlopeRatingB9 = @slopeRatingB9,
           UpdatedAt = GETUTCDATE()
       WHERE CourseId = @courseId
         AND TeeId = @teeId;
       SELECT @@ROWCOUNT AS updatedCount;`,
      {
        courseId: { type: sql.VarChar(50), value: id },
        teeId: { type: sql.VarChar(50), value: teeId },
        courseRating18: { type: sql.Decimal(4, 1), value: tee.courseRating ?? null },
        slopeRating18: { type: sql.Int, value: tee.slope != null ? Math.round(tee.slope) : null },
        courseRatingF9: { type: sql.Decimal(4, 1), value: tee.courseRatingF9 ?? null },
        slopeRatingF9: { type: sql.Int, value: tee.slopeRatingF9 != null ? Math.round(tee.slopeRatingF9) : null },
        courseRatingB9: { type: sql.Decimal(4, 1), value: tee.courseRatingB9 ?? null },
        slopeRatingB9: { type: sql.Int, value: tee.slopeRatingB9 != null ? Math.round(tee.slopeRatingB9) : null }
      }
    );
    updatedTees += Number(rows?.[rows.length - 1]?.updatedCount || rows?.[0]?.updatedCount || 0);
  }

  return { courseId: id, updatedTees, expiresAt: expiry, cacheSource };
}

async function mirrorRatingsOnlyToGolfDb(course) {
  const callbackUrl = process.env.GHIN_IMPORT_CALLBACK_URL;
  const callbackApiKey = process.env.GHIN_MIDDLEWARE_API_KEY;
  const id = String(course?.courseId || '').trim();

  if (!callbackUrl) {
    throw new Error('GHIN_IMPORT_CALLBACK_URL is required to mirror ratings-only.');
  }
  if (!callbackApiKey) {
    throw new Error('GHIN_MIDDLEWARE_API_KEY is required to mirror ratings-only.');
  }
  if (!id) {
    return { courseId: id, skipped: true, reason: 'missing_course_id' };
  }

  const tees = (course.tees || []).map((tee) => ({
    ghinTeeId: String(tee.teeId),
    courseRating18: tee.courseRating ?? null,
    slopeRating18: tee.slope != null ? Math.round(tee.slope) : null,
    courseRatingF9: tee.courseRatingF9 ?? null,
    slopeRatingF9: tee.slopeRatingF9 != null ? Math.round(tee.slopeRatingF9) : null,
    courseRatingB9: tee.courseRatingB9 ?? null,
    slopeRatingB9: tee.slopeRatingB9 != null ? Math.round(tee.slopeRatingB9) : null
  }));

  const response = await runWithMirrorCallbackSlot(async () => fetch(callbackUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': callbackApiKey
    },
    body: JSON.stringify({
      ratingsOnly: true,
      ghinCourseId: id,
      courseId: id,
      tees
    })
  }));

  const bodyText = await response.text();
  let parsed = null;
  try {
    parsed = bodyText ? JSON.parse(bodyText) : null;
  } catch (_) {
    parsed = null;
  }

  if (!response.ok) {
    const details = parsed ? JSON.stringify(parsed) : bodyText;
    throw new Error(`Ratings-only mirror callback failed (${response.status}): ${details}`);
  }

  return parsed || { success: true, ghinCourseId: id };
}

/**
 * Coalesced on-demand fetch: fresh ratings hit, else one USGA getCourse shared by concurrent callers.
 * Day-ttl with existing public catalog: persist CR/Slope only (Phase 2).
 * Missing public catalog or webhook/fullSync: full processCourseSync.
 * Legacy mode: still returns cache if present (even if ExpiresAt far future).
 */
async function getOrFetchCourse(courseId, options = {}) {
  const id = String(courseId || '').trim();
  if (!id) {
    throw new Error('courseId is required');
  }

  await ensureCacheTables();

  const forceRefresh = Boolean(options.forceRefresh);
  const fromWebhook = Boolean(options.fromWebhook);
  const fullSync = Boolean(options.fullSync) || fromWebhook;
  const syncMirror = options.syncMirror !== false;

  const freshness = await getCachedCourseFreshness(id);
  const hasPublic = Boolean(freshness.exists);
  const hasRatings = hasPublic ? await courseHasCachedRatings(id) : false;
  const ratingsFresh = hasPublic && freshness.fresh && hasRatings;

  if (!forceRefresh && ratingsFresh) {
    const cached = await buildMirrorPayloadFromCache(id);
    if (cached) {
      return {
        course: cached,
        source: 'cache',
        ratingsFresh: true,
        ratingsOnly: false,
        cacheMode: courseCachePolicy.getCourseCacheMode()
      };
    }
  } else if (forceRefresh && courseCachePolicy.isDayTtlMode() && fullSync) {
    await markCourseCacheInvalidated(id);
  }

  if (courseFetchInFlight.has(id)) {
    return courseFetchInFlight.get(id);
  }

  const promise = (async () => {
    const course = await usaGhinApiClient.getCourse(id);
    if (!course) {
      return {
        course: null,
        source: 'usga',
        notFound: true,
        cacheMode: courseCachePolicy.getCourseCacheMode()
      };
    }

    const syncOptions = {
      detectNoop: options.detectNoop !== false,
      syncMirror,
      cacheSource: options.cacheSource,
      fromWebhook,
      fromRecon: Boolean(options.fromRecon)
    };

    const useRatingsOnly = courseCachePolicy.isDayTtlMode()
      && hasPublic
      && !fullSync;

    if (useRatingsOnly) {
      await upsertCacheDbRatingsOnly(course, syncOptions);
      if (syncMirror) {
        await mirrorRatingsOnlyToGolfDb(course);
      }
      const cached = await buildMirrorPayloadFromCache(id);
      return {
        course: cached || course,
        source: options.fromWebhook ? 'webhook_refetch' : 'usga_ratings',
        ratingsFresh: true,
        ratingsOnly: true,
        cacheMode: courseCachePolicy.getCourseCacheMode()
      };
    }

    await processCourseSync(course, syncOptions);
    return {
      course,
      source: fromWebhook ? 'webhook_refetch' : 'usga_fetch',
      ratingsFresh: true,
      ratingsOnly: false,
      cacheMode: courseCachePolicy.getCourseCacheMode()
    };
  })().finally(() => {
    courseFetchInFlight.delete(id);
  });

  courseFetchInFlight.set(id, promise);
  return promise;
}

async function nullCacheDbTeeRatings(courseId) {
  const sql = database.sql;
  const id = String(courseId || '').trim();
  if (!id) {
    return { courseId: id, nulledTees: 0 };
  }

  const rows = await database.query(
    `UPDATE dbo.GHIN_Tees
     SET CourseRating18 = NULL,
         SlopeRating18 = NULL,
         CourseRatingF9 = NULL,
         SlopeRatingF9 = NULL,
         CourseRatingB9 = NULL,
         SlopeRatingB9 = NULL,
         UpdatedAt = GETUTCDATE()
     WHERE CourseId = @courseId
       AND (
         CourseRating18 IS NOT NULL
         OR SlopeRating18 IS NOT NULL
         OR CourseRatingF9 IS NOT NULL
         OR SlopeRatingF9 IS NOT NULL
         OR CourseRatingB9 IS NOT NULL
         OR SlopeRatingB9 IS NOT NULL
       );
     SELECT @@ROWCOUNT AS nulledCount;`,
    { courseId: { type: sql.VarChar(50), value: id } }
  );

  const nulledTees = Number(
    rows?.[rows.length - 1]?.nulledCount
    || rows?.[0]?.nulledCount
    || 0
  );
  return { courseId: id, nulledTees };
}

async function mirrorNullRatingsToGolfDb(courseId) {
  const callbackUrl = process.env.GHIN_IMPORT_CALLBACK_URL;
  const callbackApiKey = process.env.GHIN_MIDDLEWARE_API_KEY;
  const id = String(courseId || '').trim();

  if (!callbackUrl) {
    throw new Error('GHIN_IMPORT_CALLBACK_URL is required to null GolfDB runtime ratings.');
  }
  if (!callbackApiKey) {
    throw new Error('GHIN_MIDDLEWARE_API_KEY is required to null GolfDB runtime ratings.');
  }
  if (!id) {
    return { courseId: id, skipped: true, reason: 'missing_course_id' };
  }

  const response = await runWithMirrorCallbackSlot(async () => fetch(callbackUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': callbackApiKey
    },
    body: JSON.stringify({
      nullRatings: true,
      ghinCourseId: id,
      courseId: id
    })
  }));

  const bodyText = await response.text();
  let parsed = null;
  try {
    parsed = bodyText ? JSON.parse(bodyText) : null;
  } catch (_) {
    parsed = null;
  }

  if (!response.ok) {
    const details = parsed ? JSON.stringify(parsed) : bodyText;
    throw new Error(`Null-ratings mirror callback failed (${response.status}): ${details}`);
  }

  return parsed || { success: true, ghinCourseId: id };
}

/**
 * Phase 1: day-TTL expiry NULLs Course Rating / Slope in CacheDB + GolfDB.
 * Never DELETE public catalog rows (courses/tees/holes).
 */
async function purgeExpiredCacheCourses(options = {}) {
  if (!courseCachePolicy.isDayTtlMode()) {
    return {
      skipped: true,
      reason: 'not_day_ttl',
      cacheMode: courseCachePolicy.getCourseCacheMode(),
      nulledCourses: 0,
      nulledTees: 0,
      mirrorFailures: [],
      courseIds: [],
      deletedCourses: 0,
      deletedTees: 0,
      deletedHoles: 0
    };
  }

  await ensureCacheTables();
  const sql = database.sql;
  const now = options.now instanceof Date ? options.now : new Date();
  const limit = Number.isFinite(options.limit) ? Math.max(1, Math.floor(options.limit)) : 500;
  const mirror = options.mirror !== false;

  const expired = await database.query(
    `SELECT TOP (@limit) CourseId AS courseId
     FROM dbo.GHIN_Courses
     WHERE ExpiresAt <= @now
     ORDER BY ExpiresAt ASC`,
    {
      limit: { type: sql.Int, value: limit },
      now: { type: sql.DateTime2, value: now }
    }
  );

  const courseIds = (expired || []).map((row) => String(row.courseId)).filter(Boolean);
  if (courseIds.length === 0) {
    return {
      skipped: false,
      nulledCourses: 0,
      nulledTees: 0,
      mirrorFailures: [],
      courseIds: [],
      deletedCourses: 0,
      deletedTees: 0,
      deletedHoles: 0
    };
  }

  let nulledCourses = 0;
  let nulledTees = 0;
  const mirrorFailures = [];

  for (const courseId of courseIds) {
    const cacheResult = await nullCacheDbTeeRatings(courseId);
    nulledCourses += 1;
    nulledTees += cacheResult.nulledTees;

    if (mirror) {
      try {
        await mirrorNullRatingsToGolfDb(courseId);
      } catch (err) {
        mirrorFailures.push({
          courseId,
          error: err && err.message ? err.message : String(err)
        });
        logger.warn('Failed to null GolfDB runtime ratings after CacheDB ratings expiry', {
          courseId,
          error: err && err.message ? err.message : String(err)
        });
      }
    }
  }

  logger.info('Expired CacheDB/GolfDB course ratings NULLed (public catalog retained)', {
    nulledCourses,
    nulledTees,
    mirrorFailureCount: mirrorFailures.length,
    sampleCourseIds: courseIds.slice(0, 10)
  });

  return {
    skipped: false,
    nulledCourses,
    nulledTees,
    mirrorFailures,
    courseIds,
    deletedCourses: 0,
    deletedTees: 0,
    deletedHoles: 0
  };
}

module.exports = {
  getCachedCourseFreshness,
  getOrFetchCourse,
  courseHasCachedRatings,
  upsertCacheDbRatingsOnly,
  mirrorRatingsOnlyToGolfDb,
  purgeExpiredCacheCourses,
  nullCacheDbTeeRatings,
  mirrorNullRatingsToGolfDb,
  markCourseCacheInvalidated,
  buildCacheUpsertPayload,
  buildMirrorPayload,
  buildMirrorPayloadFromCache,
  bulkUpsertCoursesToCache,
  hashPayload,
  getReconciliationCandidateCourseIds,
  reconcileAllCandidates,
  processCourseSync,
  reconcileCourses,
  upsertCourseToCache,
  upsertCourseHeaderToCache,
  syncMirrorForCourse,
  validateCourseForSync
};
