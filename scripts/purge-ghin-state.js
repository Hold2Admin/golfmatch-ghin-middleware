/**
 * Purge GHIN course rows for a single state from GolfDB and CacheDB.
 * Also removes that state from the middleware backfill checkpoint so the next
 * run can start cleanly.
 *
 * Usage:
 *   node scripts/purge-ghin-state.js --state=US-CT --yes
 *   node scripts/purge-ghin-state.js --state=CT --dry-run
 *   node scripts/purge-ghin-state.js --state=US-NY --exclude-course-ids=3857 --yes
 */

const fs = require('fs');
const path = require('path');
const sql = require('mssql');
const database = require('../src/services/database');
const { loadSecrets } = require('../src/config/secrets');

const DEFAULT_CHECKPOINT_PATH = path.join(__dirname, 'logs', 'ghin-course-backfill-checkpoint.json');

function normalizeState(rawState) {
  const normalized = String(rawState || '').trim().toUpperCase();
  if (!normalized) {
    return null;
  }
  return normalized.startsWith('US-') ? normalized.slice(3) : normalized;
}

function parseCourseIds(value) {
  return Array.from(new Set(
    String(value || '')
      .split(',')
      .map((item) => String(item).trim())
      .filter(Boolean)
  ));
}

function parseArgs(argv) {
  const args = {
    state: null,
    dryRun: false,
    yes: false,
    excludeCourseIds: [],
    checkpointPath: DEFAULT_CHECKPOINT_PATH,
    resetCheckpointState: true
  };

  for (const raw of argv) {
    if (raw === '--dry-run') {
      args.dryRun = true;
      continue;
    }
    if (raw === '--yes') {
      args.yes = true;
      continue;
    }
    if (raw === '--no-reset-checkpoint-state') {
      args.resetCheckpointState = false;
      continue;
    }

    const [flag, value] = raw.split('=');
    if (value == null) continue;

    if (flag === '--state') {
      args.state = normalizeState(value);
      continue;
    }

    if (flag === '--exclude-course-ids' || flag === '--exclude-ids') {
      args.excludeCourseIds.push(...parseCourseIds(value));
      continue;
    }

    if (flag === '--checkpoint') {
      args.checkpointPath = path.resolve(value);
    }
  }

  args.excludeCourseIds = Array.from(new Set(args.excludeCourseIds));

  if (!args.state) {
    throw new Error('Missing required --state=US-XX argument.');
  }

  if (!args.dryRun && !args.yes) {
    throw new Error('Refusing destructive purge without --yes. Use --dry-run to preview.');
  }

  return args;
}

async function getGolfDbPool(secrets) {
  const pool = new sql.ConnectionPool({
    server: secrets.AZURE_SQL_SERVER,
    database: secrets.AZURE_SQL_DATABASE,
    user: secrets.AZURE_SQL_USER,
    password: secrets.AZURE_SQL_PASSWORD,
    options: {
      encrypt: true,
      trustServerCertificate: false,
      enableArithAbort: true
    },
    pool: {
      max: 5,
      min: 0,
      idleTimeoutMillis: 30000
    }
  });

  return pool.connect();
}

async function getCacheCounts(state, excludeCourseIds = []) {
  const dbSql = database.sql;
  const rows = await database.query(
    `SELECT
       (SELECT COUNT(1)
        FROM dbo.GHIN_Courses
        WHERE State = @state
          AND CourseId NOT IN (SELECT [value] FROM OPENJSON(@excludeIdsJson))) AS courseCount,
       (SELECT COUNT(1)
        FROM dbo.GHIN_Tees t
        INNER JOIN dbo.GHIN_Courses c ON c.CourseId = t.CourseId
        WHERE c.State = @state
          AND c.CourseId NOT IN (SELECT [value] FROM OPENJSON(@excludeIdsJson))) AS teeCount,
       (SELECT COUNT(1)
        FROM dbo.GHIN_Holes h
        INNER JOIN dbo.GHIN_Tees t ON t.TeeId = h.TeeId
        INNER JOIN dbo.GHIN_Courses c ON c.CourseId = t.CourseId
        WHERE c.State = @state
          AND c.CourseId NOT IN (SELECT [value] FROM OPENJSON(@excludeIdsJson))) AS holeCount`,
    {
      state: { type: dbSql.VarChar(10), value: state },
      excludeIdsJson: { type: dbSql.NVarChar(dbSql.MAX), value: JSON.stringify(excludeCourseIds) }
    }
  );

  return {
    courseCount: Number(rows[0]?.courseCount || 0),
    teeCount: Number(rows[0]?.teeCount || 0),
    holeCount: Number(rows[0]?.holeCount || 0)
  };
}

async function getGolfCounts(pool, state, excludeCourseIds = []) {
  const result = await pool.request()
    .input('state', sql.NVarChar(50), state)
    .input('excludeIdsJson', sql.NVarChar(sql.MAX), JSON.stringify(excludeCourseIds))
    .query(`
      SELECT
        (SELECT COUNT(1)
         FROM dbo.GhinRuntimeCourses
         WHERE [State] = @state
           AND GhinCourseId NOT IN (SELECT [value] FROM OPENJSON(@excludeIdsJson))) AS courseCount,
        (SELECT COUNT(1)
         FROM dbo.GhinRuntimeTees t
         INNER JOIN dbo.GhinRuntimeCourses c ON c.GhinRuntimeCourseId = t.GhinRuntimeCourseId
         WHERE c.[State] = @state
           AND c.GhinCourseId NOT IN (SELECT [value] FROM OPENJSON(@excludeIdsJson))) AS teeCount,
        (SELECT COUNT(1)
         FROM dbo.GhinRuntimeHoles h
         INNER JOIN dbo.GhinRuntimeTees t ON t.GhinRuntimeTeeId = h.GhinRuntimeTeeId
         INNER JOIN dbo.GhinRuntimeCourses c ON c.GhinRuntimeCourseId = t.GhinRuntimeCourseId
         WHERE c.[State] = @state
           AND c.GhinCourseId NOT IN (SELECT [value] FROM OPENJSON(@excludeIdsJson))) AS holeCount
    `);

  return {
    courseCount: Number(result.recordset?.[0]?.courseCount || 0),
    teeCount: Number(result.recordset?.[0]?.teeCount || 0),
    holeCount: Number(result.recordset?.[0]?.holeCount || 0)
  };
}

async function purgeGolfState(pool, state, excludeCourseIds = []) {
  const tx = new sql.Transaction(pool);
  await tx.begin();

  try {
    const req = new sql.Request(tx);
    await req
      .input('state', sql.NVarChar(50), state)
      .input('excludeIdsJson', sql.NVarChar(sql.MAX), JSON.stringify(excludeCourseIds))
      .query(`
        DELETE h
        FROM dbo.GhinRuntimeHoles h
        INNER JOIN dbo.GhinRuntimeTees t ON t.GhinRuntimeTeeId = h.GhinRuntimeTeeId
        INNER JOIN dbo.GhinRuntimeCourses c ON c.GhinRuntimeCourseId = t.GhinRuntimeCourseId
        WHERE c.[State] = @state
          AND c.GhinCourseId NOT IN (SELECT [value] FROM OPENJSON(@excludeIdsJson));

        DELETE t
        FROM dbo.GhinRuntimeTees t
        INNER JOIN dbo.GhinRuntimeCourses c ON c.GhinRuntimeCourseId = t.GhinRuntimeCourseId
        WHERE c.[State] = @state
          AND c.GhinCourseId NOT IN (SELECT [value] FROM OPENJSON(@excludeIdsJson));

        DELETE FROM dbo.GhinRuntimeCourses
        WHERE [State] = @state
          AND GhinCourseId NOT IN (SELECT [value] FROM OPENJSON(@excludeIdsJson));
      `);

    await tx.commit();
  } catch (error) {
    try {
      await tx.rollback();
    } catch (_) {
      // Ignore rollback errors.
    }
    throw error;
  }
}

async function purgeCacheState(state, excludeCourseIds = []) {
  const pool = await database.connect();
  if (!pool) {
    throw new Error('Cache DB is not configured.');
  }

  const dbSql = database.sql;
  const tx = new dbSql.Transaction(pool);
  await tx.begin();

  try {
    const req = new dbSql.Request(tx);
    await req
      .input('state', dbSql.VarChar(10), state)
      .input('excludeIdsJson', dbSql.NVarChar(dbSql.MAX), JSON.stringify(excludeCourseIds))
      .query(`
        DELETE FROM dbo.GHIN_Courses
        WHERE State = @state
          AND CourseId NOT IN (SELECT [value] FROM OPENJSON(@excludeIdsJson));
      `);

    await tx.commit();
  } catch (error) {
    try {
      await tx.rollback();
    } catch (_) {
      // Ignore rollback errors.
    }
    throw error;
  }
}

function createFailureBreakdown() {
  return {
    retryableOperational: 0,
    sourceData: 0,
    other: 0
  };
}

function recalculateTotals(stateSummaries) {
  const totals = {
    discovered: 0,
    missing: 0,
    synced: 0,
    skippedExisting: 0,
    failed: 0,
    failureBreakdown: createFailureBreakdown()
  };

  for (const summary of Object.values(stateSummaries || {})) {
    totals.discovered += Number(summary?.discovered || 0);
    totals.missing += Number(summary?.missing || 0);
    totals.synced += Number(summary?.synced || 0);
    totals.skippedExisting += Number(summary?.existing || 0);
    totals.failed += Number(summary?.failed || 0);
    totals.failureBreakdown.retryableOperational += Number(summary?.failureBreakdown?.retryableOperational || 0);
    totals.failureBreakdown.sourceData += Number(summary?.failureBreakdown?.sourceData || 0);
    totals.failureBreakdown.other += Number(summary?.failureBreakdown?.other || 0);
  }

  return totals;
}

function resetCheckpointState(checkpointPath, state) {
  if (!fs.existsSync(checkpointPath)) {
    return { updated: false, reason: 'checkpoint_not_found' };
  }

  const checkpoint = JSON.parse(fs.readFileSync(checkpointPath, 'utf8'));
  checkpoint.completedStates = Array.isArray(checkpoint.completedStates)
    ? checkpoint.completedStates.filter((item) => item !== `US-${state}`)
    : [];
  if (checkpoint.failedStates && typeof checkpoint.failedStates === 'object') {
    delete checkpoint.failedStates[`US-${state}`];
  }
  if (checkpoint.stateSummaries && typeof checkpoint.stateSummaries === 'object') {
    delete checkpoint.stateSummaries[`US-${state}`];
  }
  checkpoint.totals = recalculateTotals(checkpoint.stateSummaries || {});
  checkpoint.updatedAt = new Date().toISOString();

  fs.writeFileSync(checkpointPath, JSON.stringify(checkpoint, null, 2));
  return { updated: true, reason: 'state_removed' };
}

async function run() {
  const args = parseArgs(process.argv.slice(2));
  const secrets = await loadSecrets();
  Object.assign(process.env, secrets);

  const golfPool = await getGolfDbPool(secrets);
  await database.connect();

  try {
    const before = {
      golf: await getGolfCounts(golfPool, args.state, args.excludeCourseIds),
      cache: await getCacheCounts(args.state, args.excludeCourseIds)
    };

    const summary = {
      state: args.state,
      dryRun: args.dryRun,
      excludeCourseIds: args.excludeCourseIds,
      before,
      after: null,
      checkpoint: args.resetCheckpointState && !args.dryRun
        ? resetCheckpointState(args.checkpointPath, args.state)
        : { updated: false, reason: args.dryRun ? 'dry_run' : 'not_requested' }
    };

    if (!args.dryRun) {
      await purgeGolfState(golfPool, args.state, args.excludeCourseIds);
      await purgeCacheState(args.state, args.excludeCourseIds);
      summary.after = {
        golf: await getGolfCounts(golfPool, args.state, args.excludeCourseIds),
        cache: await getCacheCounts(args.state, args.excludeCourseIds)
      };
    }

    console.log(JSON.stringify(summary, null, 2));
  } finally {
    await golfPool.close();
    await database.close();
  }
}

run().catch(async (error) => {
  try {
    await database.close();
  } catch (_) {
    // Ignore shutdown errors.
  }

  console.error('State purge failed:', error.message);
  process.exit(1);
});