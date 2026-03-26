/**
 * Seed a GHIN course from the live USGA API into the cache database.
 * Fetches full course data (tees + holes) and upserts into GHIN_Courses,
 * GHIN_Tees, and GHIN_Holes. Safe to re-run — existing data for the course
 * is replaced atomically.
 *
 * Usage: node scripts/seed-ghin-course.js <ghinCourseId>
 * Example: node scripts/seed-ghin-course.js 1385
 *
 * To find a courseId first:
 *   node scripts/search-ghin-courses.js <name> [state]
 */

const sql = require('mssql');
const crypto = require('crypto');
const { loadSecrets } = require('../src/config/secrets');

// Course data rarely changes; expire cache after 1 year
const CACHE_TTL_DAYS = 365;

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

async function syncMirrorForCourse(course, callbackUrl, callbackApiKey) {
  const payload = buildMirrorPayload(course);
  if (!callbackApiKey) {
    throw new Error('GHIN_MIDDLEWARE_API_KEY is required for mirror callback auth.');
  }

  const headers = {
    'Content-Type': 'application/json',
    'x-api-key': callbackApiKey
  };

  const response = await fetch(callbackUrl, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload)
  });

  const bodyText = await response.text();
  let parsed = null;
  try {
    parsed = bodyText ? JSON.parse(bodyText) : null;
  } catch (_) {
    parsed = null;
  }

  if (!response.ok) {
    const details = parsed ? JSON.stringify(parsed) : bodyText;
    throw new Error(`Mirror callback failed (${response.status}): ${details}`);
  }

  return parsed;
}

async function run() {
  const courseId = process.argv[2];
  if (!courseId) {
    console.error('Usage: node scripts/seed-ghin-course.js <ghinCourseId>');
    console.error('  Example: node scripts/seed-ghin-course.js 1385');
    process.exit(1);
  }

  // ── Load secrets and set env before requiring config-dependent modules ──
  const secrets = await loadSecrets();
  if (secrets.GHIN_SANDBOX_EMAIL)    process.env.GHIN_SANDBOX_EMAIL    = secrets.GHIN_SANDBOX_EMAIL;
  if (secrets.GHIN_SANDBOX_PASSWORD) process.env.GHIN_SANDBOX_PASSWORD = secrets.GHIN_SANDBOX_PASSWORD;
  if (secrets.GHIN_API_BASE_URL)     process.env.GHIN_API_BASE_URL     = secrets.GHIN_API_BASE_URL;

  // Require AFTER env is populated so config reads correct values
  const usaGhinApiClient = require('../src/services/usaGhinApiClient');

  // ── Fetch from USGA API ─────────────────────────────────────────────────
  console.log(`Fetching course ${courseId} from USGA API...`);
  const course = await usaGhinApiClient.getCourse(courseId);

  if (!course) {
    console.error(`Course ${courseId} not found in USGA API.`);
    process.exit(1);
  }

  validateCourseHoleHandicaps(course);

  console.log(`Found: ${course.courseName}  —  ${course.city ?? ''}, ${course.state ?? ''}`);
  console.log(`  ${course.tees.length} tee set(s), ${course.tees.reduce((n, t) => n + t.holes.length, 0)} total holes`);

  // ── Connect to cacheDB ──────────────────────────────────────────────────
  const pool = await sql.connect({
    server:   secrets.GHIN_CACHE_DB_SERVER,
    database: secrets.GHIN_CACHE_DB_NAME,
    user:     secrets.GHIN_CACHE_DB_USER,
    password: secrets.GHIN_CACHE_DB_PASSWORD,
    options:  { encrypt: true, enableArithAbort: true }
  });

  const transaction = new sql.Transaction(pool);
  await transaction.begin();
  let committed = false;

  try {
    const now    = new Date();
    const expiry = new Date(now.getTime() + CACHE_TTL_DAYS * 24 * 60 * 60 * 1000);
    const mirrorPayload = buildMirrorPayload(course);
    const payloadHash = hashPayload(mirrorPayload);
    const teeStructureHash = hashPayload(buildTeeStructurePayload(mirrorPayload));

    await transaction.request().query(`
      IF COL_LENGTH('dbo.GHIN_Courses', 'shortCourseName') IS NULL
        ALTER TABLE dbo.GHIN_Courses ADD shortCourseName NVARCHAR(200) NULL;

      IF COL_LENGTH('dbo.GHIN_Courses', 'lastPayloadHash') IS NULL
        ALTER TABLE dbo.GHIN_Courses ADD lastPayloadHash VARCHAR(64) NULL;

      IF COL_LENGTH('dbo.GHIN_Courses', 'lastTeeStructureHash') IS NULL
        ALTER TABLE dbo.GHIN_Courses ADD lastTeeStructureHash VARCHAR(64) NULL;
    `);

    // ── 1. Upsert GHIN_Courses ────────────────────────────────────────────
    await transaction.request()
      .input('courseId',     sql.VarChar(50),   course.courseId)
      .input('facilityId',   sql.VarChar(50),   course.facilityId ?? null)
      .input('facilityName', sql.NVarChar(200),  course.facilityName ?? course.courseName ?? null)
      .input('courseName',   sql.NVarChar(200),  course.courseName)
      .input('shortCourseName', sql.NVarChar(200), course.shortCourseName ?? null)
      .input('city',         sql.NVarChar(100),  course.city ?? null)
      .input('state',        sql.VarChar(10),    course.state ?? null)
      .input('country',      sql.VarChar(10),    course.country ?? 'USA')
      .input('cachedAt',     sql.DateTime2,      now)
      .input('expiresAt',    sql.DateTime2,      expiry)
      .input('cacheSource',  sql.NVarChar(50),   'USGA_API')
      .input('lastPayloadHash', sql.VarChar(64), payloadHash)
      .input('lastTeeStructureHash', sql.VarChar(64), teeStructureHash)
      .query(`
        MERGE GHIN_Courses WITH (HOLDLOCK) AS target
        USING (VALUES (@courseId)) AS src(courseId)
          ON target.courseId = src.courseId
        WHEN MATCHED THEN UPDATE SET
          facilityId   = @facilityId,
          facilityName = @facilityName,
          courseName   = @courseName,
          shortCourseName = @shortCourseName,
          city         = @city,
          state        = @state,
          country      = @country,
          cachedAt     = @cachedAt,
          expiresAt    = @expiresAt,
          cacheSource  = @cacheSource,
          lastPayloadHash = @lastPayloadHash,
          lastTeeStructureHash = @lastTeeStructureHash,
          updatedAt    = GETUTCDATE()
        WHEN NOT MATCHED THEN INSERT
          (courseId, facilityId, facilityName, courseName, shortCourseName, city, state, country, cachedAt, expiresAt, cacheSource, lastPayloadHash, lastTeeStructureHash)
        VALUES
          (@courseId, @facilityId, @facilityName, @courseName, @shortCourseName, @city, @state, @country, @cachedAt, @expiresAt, @cacheSource, @lastPayloadHash, @lastTeeStructureHash);
      `);

    // ── 2. Delete existing tees (cascades to GHIN_Holes) ─────────────────
    const del = await transaction.request()
      .input('courseId', sql.VarChar(50), course.courseId)
      .query(`DELETE FROM GHIN_Tees WHERE courseId = @courseId`);
    const deletedTees = del.rowsAffected[0] ?? 0;

    // ── 3. Insert tees ────────────────────────────────────────────────────
    let teeCount  = 0;
    let holeCount = 0;

    for (const tee of course.tees) {
      await transaction.request()
        .input('teeId',           sql.VarChar(50),   tee.teeId)
        .input('courseId',        sql.VarChar(50),   course.courseId)
        .input('teeName',         sql.NVarChar(100),  tee.teeName)
        .input('teeSetSide',      sql.VarChar(10),   tee.teeSetSide ?? 'All18')
        .input('gender',          sql.Char(1),       tee.gender ?? 'M')
        .input('isDefault',       sql.Bit,           tee.isDefault ? 1 : 0)
        .input('courseRating18',  sql.Decimal(4, 1), tee.courseRating ?? null)
        .input('slopeRating18',   sql.Int,           tee.slope        != null ? Math.round(tee.slope)        : null)
        .input('par18',           sql.Int,           tee.par          != null ? Math.round(tee.par)          : null)
        .input('yardage18',       sql.Int,           tee.yardage      != null ? Math.round(tee.yardage)      : null)
        .input('courseRatingF9',  sql.Decimal(4, 1), tee.courseRatingF9  ?? null)
        .input('slopeRatingF9',   sql.Int,           tee.slopeRatingF9   != null ? Math.round(tee.slopeRatingF9)  : null)
        .input('parF9',           sql.Int,           tee.parF9           != null ? Math.round(tee.parF9)          : null)
        .input('yardageF9',       sql.Int,           tee.yardageF9       != null ? Math.round(tee.yardageF9)      : null)
        .input('courseRatingB9',  sql.Decimal(4, 1), tee.courseRatingB9  ?? null)
        .input('slopeRatingB9',   sql.Int,           tee.slopeRatingB9   != null ? Math.round(tee.slopeRatingB9)  : null)
        .input('parB9',           sql.Int,           tee.parB9           != null ? Math.round(tee.parB9)          : null)
        .input('yardageB9',       sql.Int,           tee.yardageB9       != null ? Math.round(tee.yardageB9)      : null)
        .query(`
          INSERT INTO GHIN_Tees
            (teeId, courseId, teeName, teeSetSide, gender, isDefault,
             courseRating18, slopeRating18, par18, yardage18,
             courseRatingF9, slopeRatingF9, parF9, yardageF9,
             courseRatingB9, slopeRatingB9, parB9, yardageB9)
          VALUES
            (@teeId, @courseId, @teeName, @teeSetSide, @gender, @isDefault,
             @courseRating18, @slopeRating18, @par18, @yardage18,
             @courseRatingF9, @slopeRatingF9, @parF9, @yardageF9,
             @courseRatingB9, @slopeRatingB9, @parB9, @yardageB9)
        `);
      teeCount++;

      // ── 4. Insert holes for this tee ────────────────────────────────────
      for (const hole of tee.holes) {
        await transaction.request()
          .input('teeId',      sql.VarChar(50), tee.teeId)
          .input('holeNumber', sql.Int,         hole.holeNumber)
          .input('par',        sql.Int,         hole.par)
          .input('handicap',   sql.Int,         hole.handicap)
          .input('yardage',    sql.Int,         hole.yardage ?? 0)
          .query(`
            INSERT INTO GHIN_Holes (teeId, holeNumber, par, handicap, yardage)
            VALUES (@teeId, @holeNumber, @par, @handicap, @yardage)
          `);
        holeCount++;
      }
    }

    await transaction.commit();
    committed = true;

    const action = deletedTees > 0 ? 'Updated' : 'Created';
    console.log(`\n✅ ${action} course ${course.courseId} in cacheDB`);
    console.log(`   ${teeCount} tee set(s), ${holeCount} hole(s) written`);
    console.log(`   Cache expires: ${expiry.toISOString().slice(0, 10)}`);

    const callbackUrl = process.env.GHIN_IMPORT_CALLBACK_URL || 'http://localhost:5000/api/internal/ghin-import-callback';
    const callbackApiKey = process.env.GHIN_MIDDLEWARE_API_KEY || secrets.GHIN_MIDDLEWARE_API_KEY;

    if (!callbackApiKey) {
      throw new Error('GHIN_MIDDLEWARE_API_KEY not found. Cannot sync mirror callback.');
    }

    console.log(`\nSyncing runtime mirror via callback: ${callbackUrl}`);
    const callbackResult = await syncMirrorForCourse(course, callbackUrl, callbackApiKey);
    if (callbackResult?.status) {
      console.log(`✅ Mirror sync status: ${callbackResult.status}`);
    } else {
      console.log('✅ Mirror sync callback completed');
    }

  } catch (err) {
    if (!committed) {
      try {
        await transaction.rollback();
      } catch (_) {
        // Ignore rollback errors when transaction is already finished.
      }
    }
    throw err;
  } finally {
    await pool.close();
  }
}

run().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
