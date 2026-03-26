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

const logger = createLogger('courseSyncService');
const CACHE_TTL_DAYS = 365;
let hashColumnsEnsured = false;
let cacheWritesInFlight = 0;
const cacheWriteWaiters = [];
let mirrorCallbacksInFlight = 0;
const mirrorCallbackWaiters = [];

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
  const normalized = stableNormalize(payload);
  const serialized = JSON.stringify(normalized);
  return crypto.createHash('sha256').update(serialized).digest('hex');
}

function buildTeeStructurePayload(payload) {
  return {
    ghinCourseId: payload?.ghinCourseId || null,
    tees: payload?.tees || []
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

async function ensureCourseHashColumns() {
  if (hashColumnsEnsured) {
    return;
  }

  await database.query(`
    IF COL_LENGTH('dbo.GHIN_Courses', 'shortCourseName') IS NULL
      ALTER TABLE dbo.GHIN_Courses ADD shortCourseName NVARCHAR(200) NULL;

    IF COL_LENGTH('dbo.GHIN_Courses', 'lastPayloadHash') IS NULL
      ALTER TABLE dbo.GHIN_Courses ADD lastPayloadHash VARCHAR(64) NULL;

    IF COL_LENGTH('dbo.GHIN_Courses', 'lastTeeStructureHash') IS NULL
      ALTER TABLE dbo.GHIN_Courses ADD lastTeeStructureHash VARCHAR(64) NULL;
  `);

  hashColumnsEnsured = true;
}

async function getCachedCourseHashes(courseId) {
  const sql = database.sql;
  const rows = await database.query(
    `SELECT lastPayloadHash, lastTeeStructureHash
     FROM GHIN_Courses
     WHERE courseId = @courseId`,
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
    `SELECT courseId, courseName, shortCourseName, facilityName, city, state, country, facilityId, updatedAt
     FROM GHIN_Courses
     WHERE courseId = @courseId`,
    { courseId: { type: sql.VarChar, value: courseId } }
  );

  if (!courses.length) {
    return null;
  }

  const course = courses[0];
  const tees = await database.query(
    `SELECT teeId, teeName, gender, teeSetSide, isDefault,
            courseRating18, slopeRating18, par18, yardage18,
            courseRatingF9, slopeRatingF9, parF9, yardageF9,
            courseRatingB9, slopeRatingB9, parB9, yardageB9
     FROM GHIN_Tees
     WHERE courseId = @courseId
     ORDER BY teeId`,
    { courseId: { type: sql.VarChar, value: courseId } }
  );

  const holesByTee = new Map();

  const allHoles = await database.query(
    `SELECT h.teeId, h.holeNumber, h.par, h.handicap, h.yardage
     FROM GHIN_Holes h
     INNER JOIN GHIN_Tees t ON t.teeId = h.teeId
     WHERE t.courseId = @courseId
     ORDER BY h.teeId, h.holeNumber`,
    { courseId: { type: sql.VarChar, value: courseId } }
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

async function upsertCourseToCache(course, hashes = {}) {
  const pool = await database.connect();
  if (!pool) {
    throw new Error('Cache DB is not configured. Cannot process course webhook.');
  }

  await ensureCourseHashColumns();

  const sql = database.sql;
  const tx = new sql.Transaction(pool);
  await tx.begin();

  const now = new Date();
  const expiry = new Date(now.getTime() + CACHE_TTL_DAYS * 24 * 60 * 60 * 1000);

  try {
    await tx.request()
      .input('courseId', sql.VarChar(50), course.courseId)
      .input('facilityId', sql.VarChar(50), course.facilityId || null)
      .input('facilityName', sql.NVarChar(200), course.facilityName || course.courseName || null)
      .input('courseName', sql.NVarChar(200), course.courseName)
      .input('shortCourseName', sql.NVarChar(200), course.shortCourseName || null)
      .input('city', sql.NVarChar(100), course.city || null)
      .input('state', sql.VarChar(10), course.state || null)
      .input('country', sql.VarChar(10), course.country || 'USA')
      .input('cachedAt', sql.DateTime2, now)
      .input('expiresAt', sql.DateTime2, expiry)
      .input('cacheSource', sql.NVarChar(50), 'USGA_WEBHOOK')
      .input('lastPayloadHash', sql.VarChar(64), hashes.payloadHash || null)
      .input('lastTeeStructureHash', sql.VarChar(64), hashes.teeStructureHash || null)
      .query(`
        MERGE GHIN_Courses WITH (HOLDLOCK) AS target
        USING (VALUES (@courseId)) AS src(courseId)
          ON target.courseId = src.courseId
        WHEN MATCHED THEN UPDATE SET
          facilityId = @facilityId,
          facilityName = @facilityName,
          courseName = @courseName,
          shortCourseName = @shortCourseName,
          city = @city,
          state = @state,
          country = @country,
          cachedAt = @cachedAt,
          expiresAt = @expiresAt,
          cacheSource = @cacheSource,
          lastPayloadHash = @lastPayloadHash,
          lastTeeStructureHash = @lastTeeStructureHash,
          updatedAt = GETUTCDATE()
        WHEN NOT MATCHED THEN INSERT
          (courseId, facilityId, facilityName, courseName, shortCourseName, city, state, country, cachedAt, expiresAt, cacheSource, lastPayloadHash, lastTeeStructureHash)
        VALUES
          (@courseId, @facilityId, @facilityName, @courseName, @shortCourseName, @city, @state, @country, @cachedAt, @expiresAt, @cacheSource, @lastPayloadHash, @lastTeeStructureHash);
      `);

    const teeRows = (course.tees || []).map((tee) => ({
      teeId: String(tee.teeId),
      courseId: String(course.courseId),
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
    }));

    const holeRows = [];
    for (const tee of course.tees || []) {
      for (const hole of tee.holes || []) {
        holeRows.push({
          teeId: String(tee.teeId),
          holeNumber: hole.holeNumber,
          par: hole.par,
          handicap: hole.handicap,
          yardage: hole.yardage ?? 0
        });
      }
    }

    await tx.request()
      .input('courseId', sql.VarChar(50), course.courseId)
      .input('teesJson', sql.NVarChar(sql.MAX), JSON.stringify(teeRows))
      .query(`
        MERGE GHIN_Tees AS target
        USING (
          SELECT *
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
          )
        ) AS src
          ON target.teeId = src.teeId AND target.courseId = src.courseId
        WHEN MATCHED THEN UPDATE SET
          teeName = src.teeName,
          teeSetSide = src.teeSetSide,
          gender = src.gender,
          isDefault = src.isDefault,
          courseRating18 = src.courseRating18,
          slopeRating18 = src.slopeRating18,
          par18 = src.par18,
          yardage18 = src.yardage18,
          courseRatingF9 = src.courseRatingF9,
          slopeRatingF9 = src.slopeRatingF9,
          parF9 = src.parF9,
          yardageF9 = src.yardageF9,
          courseRatingB9 = src.courseRatingB9,
          slopeRatingB9 = src.slopeRatingB9,
          parB9 = src.parB9,
          yardageB9 = src.yardageB9
        WHEN NOT MATCHED BY TARGET THEN
          INSERT (teeId, courseId, teeName, teeSetSide, gender, isDefault,
                  courseRating18, slopeRating18, par18, yardage18,
                  courseRatingF9, slopeRatingF9, parF9, yardageF9,
                  courseRatingB9, slopeRatingB9, parB9, yardageB9)
          VALUES (src.teeId, src.courseId, src.teeName, src.teeSetSide, src.gender, src.isDefault,
                  src.courseRating18, src.slopeRating18, src.par18, src.yardage18,
                  src.courseRatingF9, src.slopeRatingF9, src.parF9, src.yardageF9,
                  src.courseRatingB9, src.slopeRatingB9, src.parB9, src.yardageB9)
        WHEN NOT MATCHED BY SOURCE AND target.courseId = @courseId THEN DELETE;
      `);

    await tx.request()
      .input('courseId', sql.VarChar(50), course.courseId)
      .input('holesJson', sql.NVarChar(sql.MAX), JSON.stringify(holeRows))
      .query(`
        MERGE GHIN_Holes AS target
        USING (
          SELECT *
          FROM OPENJSON(@holesJson)
          WITH (
            teeId VARCHAR(50) '$.teeId',
            holeNumber INT '$.holeNumber',
            par INT '$.par',
            handicap INT '$.handicap',
            yardage INT '$.yardage'
          )
        ) AS src
          ON target.teeId = src.teeId AND target.holeNumber = src.holeNumber
        WHEN MATCHED THEN UPDATE SET
          par = src.par,
          handicap = src.handicap,
          yardage = src.yardage
        WHEN NOT MATCHED BY TARGET THEN
          INSERT (teeId, holeNumber, par, handicap, yardage)
          VALUES (src.teeId, src.holeNumber, src.par, src.handicap, src.yardage)
        WHEN NOT MATCHED BY SOURCE
             AND target.teeId IN (SELECT teeId FROM GHIN_Tees WHERE courseId = @courseId)
          THEN DELETE;
      `);

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

async function upsertCourseHeaderToCache(course, hashes = {}) {
  await ensureCourseHashColumns();

  const sql = database.sql;
  const now = new Date();
  const expiry = new Date(now.getTime() + CACHE_TTL_DAYS * 24 * 60 * 60 * 1000);

  await database.query(
    `UPDATE GHIN_Courses
     SET facilityId = @facilityId,
         facilityName = @facilityName,
         courseName = @courseName,
       shortCourseName = @shortCourseName,
         city = @city,
         state = @state,
         country = @country,
         cachedAt = @cachedAt,
         expiresAt = @expiresAt,
         cacheSource = @cacheSource,
         lastPayloadHash = @lastPayloadHash,
         lastTeeStructureHash = @lastTeeStructureHash,
         updatedAt = GETUTCDATE()
     WHERE courseId = @courseId`,
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
      cacheSource: { type: sql.NVarChar(50), value: 'USGA_WEBHOOK' },
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

    await ensureCourseHashColumns();

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
        if (hashesMissingFromCache) {
          await upsertCourseHeaderToCache(course, incomingHashes);
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
          if (hashesMissingFromCache) {
            await upsertCourseHeaderToCache(course, incomingHashes);
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
    await runWithCacheWriteRetry(course.courseId, async () => {
      if (useHeaderOnlyUpsert) {
        await upsertCourseHeaderToCache(course, incomingHashes);
      } else {
        await upsertCourseToCache(course, incomingHashes);
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
    `SELECT courseId
     FROM GHIN_Courses
     ORDER BY TRY_CONVERT(BIGINT, courseId), courseId
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

module.exports = {
  buildMirrorPayload,
  buildMirrorPayloadFromCache,
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
