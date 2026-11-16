const sql = require('mssql');
const { loadSecrets } = require('../src/config/secrets');

function parseArgs(argv) {
  const args = {
    courseId: null,
    dryRun: false,
    yes: false,
  };

  for (const rawArg of argv) {
    if (rawArg === '--dry-run') {
      args.dryRun = true;
      continue;
    }
    if (rawArg === '--yes') {
      args.yes = true;
      continue;
    }
    if (!args.courseId && !rawArg.startsWith('--')) {
      args.courseId = String(rawArg).trim();
    }
  }

  if (!args.courseId) {
    throw new Error('Usage: node scripts/purge-ghin-course.js <ghinCourseId> [--dry-run] [--yes]');
  }

  if (!args.dryRun && !args.yes) {
    throw new Error('Refusing destructive delete without --yes. Use --dry-run to preview.');
  }

  return args;
}

async function getCachePool(secrets) {
  const pool = new sql.ConnectionPool({
    server: secrets.GHIN_CACHE_DB_SERVER,
    database: secrets.GHIN_CACHE_DB_NAME,
    user: secrets.GHIN_CACHE_DB_USER,
    password: secrets.GHIN_CACHE_DB_PASSWORD,
    requestTimeout: 0,
    options: {
      encrypt: true,
      trustServerCertificate: false,
      enableArithAbort: true,
    },
    pool: {
      max: 5,
      min: 0,
      idleTimeoutMillis: 30000,
    },
  });

  return pool.connect();
}

async function getCourseSummary(pool, courseId) {
  const result = await pool.request()
    .input('courseId', sql.VarChar(50), courseId)
    .query(`
      SELECT
        c.CourseId,
        c.CourseName,
        c.FacilityName,
        c.State,
        c.UpdatedAt,
        (SELECT COUNT(1) FROM dbo.GHIN_CourseTees ct WHERE ct.CourseId = c.CourseId) AS TeeCount,
        (
          SELECT COUNT(1)
          FROM dbo.GHIN_Holes h
          INNER JOIN dbo.GHIN_CourseTees ct ON ct.TeeId = h.TeeId
          WHERE ct.CourseId = c.CourseId
        ) AS HoleCount
      FROM dbo.GHIN_Courses c
      WHERE c.CourseId = @courseId;
    `);

  return result.recordset?.[0] || null;
}

async function purgeCourse(pool, courseId) {
  const transaction = new sql.Transaction(pool);
  await transaction.begin();

  try {
    // A tee shared with another course (18-hole combo under both 9-hole courses) keeps its
    // tee and holes; only this course's link goes. Tees no other course links to are deleted.
    const deleteTeesResult = await new sql.Request(transaction)
      .input('courseId', sql.VarChar(50), courseId)
      .query(`
        CREATE TABLE #RemovedLinkTees (TeeId VARCHAR(50) NOT NULL PRIMARY KEY);

        DELETE FROM dbo.GHIN_CourseTees
        OUTPUT deleted.TeeId INTO #RemovedLinkTees (TeeId)
        WHERE CourseId = @courseId;

        DELETE FROM #RemovedLinkTees
        WHERE EXISTS (
          SELECT 1 FROM dbo.GHIN_CourseTees remaining WHERE remaining.TeeId = #RemovedLinkTees.TeeId
        );

        DELETE h
        FROM dbo.GHIN_Holes h
        INNER JOIN #RemovedLinkTees removed ON removed.TeeId = h.TeeId;
        DECLARE @deletedHoles INT = @@ROWCOUNT;

        DELETE t
        FROM dbo.GHIN_Tees t
        INNER JOIN #RemovedLinkTees removed ON removed.TeeId = t.TeeId;
        DECLARE @deletedTees INT = @@ROWCOUNT;

        SELECT @deletedHoles AS deletedHoles, @deletedTees AS deletedTees;
      `);

    const deleteCourseResult = await new sql.Request(transaction)
      .input('courseId', sql.VarChar(50), courseId)
      .query(`
        DELETE FROM dbo.GHIN_Courses
        WHERE CourseId = @courseId;

        SELECT @@ROWCOUNT AS deletedCourses;
      `);

    await transaction.commit();

    return {
      deletedHoles: Number(deleteTeesResult.recordset[0].deletedHoles),
      deletedTees: Number(deleteTeesResult.recordset?.[0]?.deletedTees || 0),
      deletedCourses: Number(deleteCourseResult.recordset?.[0]?.deletedCourses || 0),
    };
  } catch (error) {
    if (transaction._aborted !== true) {
      await transaction.rollback();
    }
    throw error;
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const secrets = await loadSecrets();
  const pool = await getCachePool(secrets);

  try {
    const summary = await getCourseSummary(pool, args.courseId);
    if (!summary) {
      console.log(JSON.stringify({
        success: true,
        courseId: args.courseId,
        exists: false,
        dryRun: args.dryRun,
      }, null, 2));
      return;
    }

    if (args.dryRun) {
      console.log(JSON.stringify({
        success: true,
        courseId: args.courseId,
        exists: true,
        dryRun: true,
        summary,
      }, null, 2));
      return;
    }

    const deleted = await purgeCourse(pool, args.courseId);
    console.log(JSON.stringify({
      success: true,
      courseId: args.courseId,
      exists: true,
      dryRun: false,
      summary,
      deleted,
    }, null, 2));
  } finally {
    await pool.close();
  }
}

main().catch((error) => {
  console.error(error.message || String(error));
  process.exit(1);
});