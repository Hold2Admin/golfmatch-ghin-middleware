/**
 * Re-fetch a course from the live USGA API and update GHIN_Tees with F9/B9 data.
 * Usage: node scripts/refresh-course-cache.js <ghinCourseId>
 * Example: node scripts/refresh-course-cache.js 1385
 */

const sql = require('mssql');
const { loadSecrets } = require('../src/config/secrets');

async function run() {
  const courseId = process.argv[2];
  if (!courseId) {
    console.error('Usage: node scripts/refresh-course-cache.js <ghinCourseId>');
    process.exit(1);
  }

  const secrets = await loadSecrets();

  // Apply Key Vault secrets to process.env so config picks them up before requiring the API client
  if (secrets.GHIN_SANDBOX_EMAIL)    process.env.GHIN_SANDBOX_EMAIL    = secrets.GHIN_SANDBOX_EMAIL;
  if (secrets.GHIN_SANDBOX_PASSWORD) process.env.GHIN_SANDBOX_PASSWORD = secrets.GHIN_SANDBOX_PASSWORD;
  if (secrets.GHIN_API_BASE_URL)     process.env.GHIN_API_BASE_URL     = secrets.GHIN_API_BASE_URL;

  // Require AFTER env is populated so config reads correct values
  const usaGhinApiClient = require('../src/services/usaGhinApiClient');

  const pool = await sql.connect({
    server:   secrets.GHIN_CACHE_DB_SERVER,
    database: secrets.GHIN_CACHE_DB_NAME,
    user:     secrets.GHIN_CACHE_DB_USER,
    password: secrets.GHIN_CACHE_DB_PASSWORD,
    options:  { encrypt: true, enableArithAbort: true }
  });

  console.log(`Fetching course ${courseId} from USGA API...`);
  const course = await usaGhinApiClient.getCourse(courseId);

  if (!course) {
    console.error(`Course ${courseId} not found in USGA API`);
    process.exit(1);
  }

  console.log(`Course: ${course.courseName} — ${course.tees.length} tees`);

  // Sync course-level metadata first so city/state stay aligned with source.
  const courseUpdate = await pool.request()
    .input('courseId', sql.VarChar, course.courseId)
    .input('courseName', sql.NVarChar, course.courseName ?? null)
    .input('city', sql.NVarChar, course.city ?? null)
    .input('state', sql.VarChar, course.state ?? null)
    .input('country', sql.VarChar, course.country ?? null)
    .input('facilityId', sql.VarChar, course.facilityId ?? null)
    .input('facilityName', sql.NVarChar, course.courseName ?? null)
    .query(`
      UPDATE GHIN_Courses
      SET
        courseName = @courseName,
        city = @city,
        state = @state,
        country = COALESCE(@country, country),
        facilityId = @facilityId,
        facilityName = @facilityName,
        updatedAt = GETUTCDATE()
      WHERE courseId = @courseId
    `);

  if ((courseUpdate.rowsAffected?.[0] ?? 0) === 0) {
    console.log(`  SKIP (course not in cache): ${course.courseId}`);
  } else {
    console.log(
      `  Updated course: ${course.courseId} city=${course.city ?? 'null'} state=${course.state ?? 'null'}`
    );
  }

  for (const tee of course.tees) {
    const existing = await pool.request()
      .input('teeId', sql.VarChar, tee.teeId)
      .query(`SELECT teeId FROM GHIN_Tees WHERE teeId = @teeId`);

    if (existing.recordset.length === 0) {
      console.log(`  SKIP (not in cache): ${tee.teeName} (${tee.gender}) teeId=${tee.teeId}`);
      continue;
    }

    await pool.request()
      .input('teeId',          sql.VarChar,      tee.teeId)
      .input('teeSetSide',     sql.VarChar,      tee.teeSetSide      ?? 'All18')
      .input('courseRatingF9', sql.Decimal(4,1), tee.courseRatingF9  ?? null)
      .input('slopeRatingF9',  sql.Int,          tee.slopeRatingF9   ?? null)
      .input('parF9',          sql.Int,          tee.parF9           ?? null)
      .input('yardageF9',      sql.Int,          tee.yardageF9       ?? null)
      .input('courseRatingB9', sql.Decimal(4,1), tee.courseRatingB9  ?? null)
      .input('slopeRatingB9',  sql.Int,          tee.slopeRatingB9   ?? null)
      .input('parB9',          sql.Int,          tee.parB9           ?? null)
      .input('yardageB9',      sql.Int,          tee.yardageB9       ?? null)
      .query(`
        UPDATE GHIN_Tees SET
          teeSetSide     = @teeSetSide,
          courseRatingF9 = @courseRatingF9,
          slopeRatingF9  = @slopeRatingF9,
          parF9          = @parF9,
          yardageF9      = @yardageF9,
          courseRatingB9 = @courseRatingB9,
          slopeRatingB9  = @slopeRatingB9,
          parB9          = @parB9,
          yardageB9      = @yardageB9,
          updatedAt      = GETUTCDATE()
        WHERE teeId = @teeId
      `);

    const f9 = tee.courseRatingF9 != null ? `F9=${tee.courseRatingF9}/${tee.slopeRatingF9}` : 'F9=null';
    const b9 = tee.courseRatingB9 != null ? `B9=${tee.courseRatingB9}/${tee.slopeRatingB9}` : 'B9=null';
    console.log(`  Updated: ${tee.teeName} (${tee.gender}) side=${tee.teeSetSide} ${f9} ${b9}`);
  }

  await pool.close();
  console.log('Done.');
}

run().catch(err => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
