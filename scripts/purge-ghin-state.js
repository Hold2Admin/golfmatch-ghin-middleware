/**
 * Purge GHIN course rows for one or more states from GolfDB and/or CacheDB.
 * When purging cache, also removes those states from the middleware backfill
 * checkpoint so the next run can start cleanly.
 *
 * Usage:
 *   node scripts/purge-ghin-state.js --state=US-CT --yes
 *   node scripts/purge-ghin-state.js --states=US-WA,US-OR,US-CA --target=runtime --yes
 *   node scripts/purge-ghin-state.js --state=CT --dry-run
 *   node scripts/purge-ghin-state.js --state=US-NY --exclude-course-ids=3857 --yes
 */

const fs = require('fs');
const path = require('path');
const sql = require('mssql');
const database = require('../src/services/database');
const { loadSecrets } = require('../src/config/secrets');

const DEFAULT_CHECKPOINT_PATH = path.join(__dirname, 'logs', 'ghin-course-backfill-checkpoint.json');
const RUNTIME_PURGE_BATCH_SIZE = 250;

function formatDurationMs(durationMs) {
  if (!Number.isFinite(durationMs) || durationMs < 0) {
    return '0s';
  }

  const totalSeconds = Math.round(durationMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  if (minutes <= 0) {
    return `${seconds}s`;
  }

  return `${minutes}m ${seconds}s`;
}

function normalizeState(rawState) {
  const normalized = String(rawState || '').trim().toUpperCase();
  if (!normalized) {
    return null;
  }
  return normalized.startsWith('US-') ? normalized.slice(3) : normalized;
}

function parseStates(value) {
  return Array.from(new Set(
    String(value || '')
      .split(',')
      .map((item) => normalizeState(item))
      .filter(Boolean)
  ));
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
    states: [],
    dryRun: false,
    yes: false,
    excludeCourseIds: [],
    checkpointPath: DEFAULT_CHECKPOINT_PATH,
    resetCheckpointState: true,
    target: 'both'
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
      args.states.push(...parseStates(value));
      continue;
    }

    if (flag === '--states') {
      args.states.push(...parseStates(value));
      continue;
    }

    if (flag === '--exclude-course-ids' || flag === '--exclude-ids') {
      args.excludeCourseIds.push(...parseCourseIds(value));
      continue;
    }

    if (flag === '--checkpoint') {
      args.checkpointPath = path.resolve(value);
      continue;
    }

    if (flag === '--target') {
      args.target = String(value).trim().toLowerCase();
    }
  }

  args.states = Array.from(new Set(args.states));
  args.excludeCourseIds = Array.from(new Set(args.excludeCourseIds));

  if (!args.states.length) {
    throw new Error('Missing required --state=US-XX or --states=US-XX,US-YY argument.');
  }

  if (!['runtime', 'cache', 'both'].includes(args.target)) {
    throw new Error('Invalid --target value. Expected runtime, cache, or both.');
  }

  if (args.target === 'runtime') {
    args.resetCheckpointState = false;
  }

  if (!args.dryRun && !args.yes) {
    throw new Error('Refusing destructive purge without --yes. Use --dry-run to preview.');
  }

  return args;
}

function chunk(items, size) {
  const chunks = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

async function getGolfDbPool(secrets) {
  const pool = new sql.ConnectionPool({
    server: secrets.AZURE_SQL_SERVER,
    database: secrets.AZURE_SQL_DATABASE,
    user: secrets.AZURE_SQL_USER,
    password: secrets.AZURE_SQL_PASSWORD,
    requestTimeout: 0,
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

async function getCacheCounts(states, excludeCourseIds = []) {
  const dbSql = database.sql;
  const rows = await database.query(
    `SELECT
       (SELECT COUNT(1)
        FROM dbo.GHIN_Courses
        WHERE State IN (SELECT [value] FROM OPENJSON(@statesJson))
          AND CourseId NOT IN (SELECT [value] FROM OPENJSON(@excludeIdsJson))) AS courseCount,
       (SELECT COUNT(1)
        FROM dbo.GHIN_Tees t
        INNER JOIN dbo.GHIN_Courses c ON c.CourseId = t.CourseId
        WHERE c.State IN (SELECT [value] FROM OPENJSON(@statesJson))
          AND c.CourseId NOT IN (SELECT [value] FROM OPENJSON(@excludeIdsJson))) AS teeCount,
       (SELECT COUNT(1)
        FROM dbo.GHIN_Holes h
        INNER JOIN dbo.GHIN_Tees t ON t.TeeId = h.TeeId
        INNER JOIN dbo.GHIN_Courses c ON c.CourseId = t.CourseId
        WHERE c.State IN (SELECT [value] FROM OPENJSON(@statesJson))
          AND c.CourseId NOT IN (SELECT [value] FROM OPENJSON(@excludeIdsJson))) AS holeCount`,
    {
      statesJson: { type: dbSql.NVarChar(dbSql.MAX), value: JSON.stringify(states) },
      excludeIdsJson: { type: dbSql.NVarChar(dbSql.MAX), value: JSON.stringify(excludeCourseIds) }
    }
  );

  return {
    courseCount: Number(rows[0]?.courseCount || 0),
    teeCount: Number(rows[0]?.teeCount || 0),
    holeCount: Number(rows[0]?.holeCount || 0)
  };
}

async function getGolfCounts(pool, states, excludeCourseIds = []) {
  const result = await pool.request()
    .input('statesJson', sql.NVarChar(sql.MAX), JSON.stringify(states))
    .input('excludeIdsJson', sql.NVarChar(sql.MAX), JSON.stringify(excludeCourseIds))
    .query(`
      SELECT
        (SELECT COUNT(1)
         FROM dbo.GhinRuntimeCourses
         WHERE [State] IN (SELECT [value] FROM OPENJSON(@statesJson))
           AND GhinCourseId NOT IN (SELECT [value] FROM OPENJSON(@excludeIdsJson))) AS courseCount,
        (SELECT COUNT(1)
         FROM dbo.GhinRuntimeTees t
         INNER JOIN dbo.GhinRuntimeCourses c ON c.GhinRuntimeCourseId = t.GhinRuntimeCourseId
         WHERE c.[State] IN (SELECT [value] FROM OPENJSON(@statesJson))
           AND c.GhinCourseId NOT IN (SELECT [value] FROM OPENJSON(@excludeIdsJson))) AS teeCount,
        (SELECT COUNT(1)
         FROM dbo.GhinRuntimeHoles h
         INNER JOIN dbo.GhinRuntimeTees t ON t.GhinRuntimeTeeId = h.GhinRuntimeTeeId
         INNER JOIN dbo.GhinRuntimeCourses c ON c.GhinRuntimeCourseId = t.GhinRuntimeCourseId
         WHERE c.[State] IN (SELECT [value] FROM OPENJSON(@statesJson))
           AND c.GhinCourseId NOT IN (SELECT [value] FROM OPENJSON(@excludeIdsJson))) AS holeCount
    `);

  return {
    courseCount: Number(result.recordset?.[0]?.courseCount || 0),
    teeCount: Number(result.recordset?.[0]?.teeCount || 0),
    holeCount: Number(result.recordset?.[0]?.holeCount || 0)
  };
}

async function getGolfCourseIds(pool, states, excludeCourseIds = []) {
  const result = await pool.request()
    .input('statesJson', sql.NVarChar(sql.MAX), JSON.stringify(states))
    .input('excludeIdsJson', sql.NVarChar(sql.MAX), JSON.stringify(excludeCourseIds))
    .query(`
      SELECT GhinCourseId AS courseId
      FROM dbo.GhinRuntimeCourses
      WHERE [State] IN (SELECT [value] FROM OPENJSON(@statesJson))
        AND GhinCourseId NOT IN (SELECT [value] FROM OPENJSON(@excludeIdsJson))
      ORDER BY TRY_CONVERT(BIGINT, GhinCourseId), GhinCourseId
    `);

  return (result.recordset || []).map((row) => String(row.courseId)).filter(Boolean);
}

async function purgeGolfState(pool, states, excludeCourseIds = []) {
  const startedAtMs = Date.now();
  console.log(`[purge] runtime delete starting states=${states.join(',')} excludeIds=${excludeCourseIds.length}`);

  const targetCourseIds = await getGolfCourseIds(pool, states, excludeCourseIds);
  if (!targetCourseIds.length) {
    console.log('[purge] runtime delete skipped no matching courses');
    console.log(`[purge] runtime delete complete elapsed=${formatDurationMs(Date.now() - startedAtMs)}`);
    return;
  }

  const courseIdBatches = chunk(targetCourseIds, RUNTIME_PURGE_BATCH_SIZE);
  let totalHoleRows = 0;
  let totalTeeRows = 0;
  let totalCourseRows = 0;
  let committedCourses = 0;

  for (const [batchIndex, courseIds] of courseIdBatches.entries()) {
    const batchNumber = batchIndex + 1;
    const batchStartedAtMs = Date.now();
    console.log(`[purge] runtime batch ${batchNumber}/${courseIdBatches.length} starting courses=${courseIds.length}`);

    const tx = new sql.Transaction(pool);
    await tx.begin();

    try {
      const deletePhase = async (label, query) => {
        const req = new sql.Request(tx);
        req.timeout = 0;

        const result = await req
          .input('idsJson', sql.NVarChar(sql.MAX), JSON.stringify(courseIds))
          .query(query);

        return Array.isArray(result.recordsAffected)
          ? result.recordsAffected.reduce((sum, count) => sum + Number(count || 0), 0)
          : 0;
      };

      const holeRows = await deletePhase('holes', `
        DELETE h
        FROM dbo.GhinRuntimeHoles h
        INNER JOIN dbo.GhinRuntimeTees t ON t.GhinRuntimeTeeId = h.GhinRuntimeTeeId
        INNER JOIN dbo.GhinRuntimeCourses c ON c.GhinRuntimeCourseId = t.GhinRuntimeCourseId
        WHERE c.GhinCourseId IN (SELECT [value] FROM OPENJSON(@idsJson));
      `);

      const teeRows = await deletePhase('tees', `
        DELETE t
        FROM dbo.GhinRuntimeTees t
        INNER JOIN dbo.GhinRuntimeCourses c ON c.GhinRuntimeCourseId = t.GhinRuntimeCourseId
        WHERE c.GhinCourseId IN (SELECT [value] FROM OPENJSON(@idsJson));
      `);

      const courseRows = await deletePhase('courses', `
        DELETE FROM dbo.GhinRuntimeCourses
        WHERE GhinCourseId IN (SELECT [value] FROM OPENJSON(@idsJson));
      `);

      await tx.commit();

      committedCourses += courseIds.length;
      totalHoleRows += holeRows;
      totalTeeRows += teeRows;
      totalCourseRows += courseRows;

      console.log(
        `[purge] runtime batch ${batchNumber}/${courseIdBatches.length} complete committedCourses=${committedCourses}/${targetCourseIds.length} deletedCourses=${courseRows} deletedTees=${teeRows} deletedHoles=${holeRows} batchElapsed=${formatDurationMs(Date.now() - batchStartedAtMs)} totalElapsed=${formatDurationMs(Date.now() - startedAtMs)}`
      );
    } catch (error) {
      try {
        await tx.rollback();
      } catch (_) {
        // Ignore rollback errors.
      }
      throw error;
    }
  }

  console.log(
    `[purge] runtime delete complete deletedCourses=${totalCourseRows} deletedTees=${totalTeeRows} deletedHoles=${totalHoleRows} elapsed=${formatDurationMs(Date.now() - startedAtMs)}`
  );
}

async function purgeCacheState(states, excludeCourseIds = []) {
  const pool = await database.connect();
  if (!pool) {
    throw new Error('Cache DB is not configured.');
  }

  const dbSql = database.sql;
  const tx = new dbSql.Transaction(pool);
  await tx.begin();

  try {
    const req = new dbSql.Request(tx);
    req.timeout = 0;

    const startedAtMs = Date.now();
    console.log(`[purge] cache delete starting states=${states.join(',')} excludeIds=${excludeCourseIds.length}`);

    await req
      .input('statesJson', dbSql.NVarChar(dbSql.MAX), JSON.stringify(states))
      .input('excludeIdsJson', dbSql.NVarChar(dbSql.MAX), JSON.stringify(excludeCourseIds))
      .query(`
        DELETE FROM dbo.GHIN_Courses
        WHERE State IN (SELECT [value] FROM OPENJSON(@statesJson))
          AND CourseId NOT IN (SELECT [value] FROM OPENJSON(@excludeIdsJson));
      `);

    await tx.commit();
    console.log(`[purge] cache delete complete elapsed=${formatDurationMs(Date.now() - startedAtMs)}`);
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

function resetCheckpointState(checkpointPath, states) {
  if (!fs.existsSync(checkpointPath)) {
    return { updated: false, reason: 'checkpoint_not_found' };
  }

  const checkpoint = JSON.parse(fs.readFileSync(checkpointPath, 'utf8'));
  const fullStateCodes = new Set(states.map((state) => `US-${state}`));
  checkpoint.completedStates = Array.isArray(checkpoint.completedStates)
    ? checkpoint.completedStates.filter((item) => !fullStateCodes.has(item))
    : [];
  if (checkpoint.failedStates && typeof checkpoint.failedStates === 'object') {
    for (const state of fullStateCodes) {
      delete checkpoint.failedStates[state];
    }
  }
  if (checkpoint.stateSummaries && typeof checkpoint.stateSummaries === 'object') {
    for (const state of fullStateCodes) {
      delete checkpoint.stateSummaries[state];
    }
  }
  checkpoint.totals = recalculateTotals(checkpoint.stateSummaries || {});
  checkpoint.updatedAt = new Date().toISOString();

  fs.writeFileSync(checkpointPath, JSON.stringify(checkpoint, null, 2));
  return { updated: true, reason: 'state_removed' };
}

async function run() {
  const args = parseArgs(process.argv.slice(2));
  const runStartedAtMs = Date.now();
  const secrets = await loadSecrets();
  Object.assign(process.env, secrets);

  const golfPool = await getGolfDbPool(secrets);
  await database.connect();

  try {
    console.log(`[purge] starting states=${args.states.join(',')} target=${args.target} dryRun=${args.dryRun} excludeIds=${args.excludeCourseIds.length}`);

    const before = {};
    if (args.target === 'runtime' || args.target === 'both') {
      before.golf = await getGolfCounts(golfPool, args.states, args.excludeCourseIds);
      console.log(`[purge] runtime before courses=${before.golf.courseCount} tees=${before.golf.teeCount} holes=${before.golf.holeCount}`);
    }
    if (args.target === 'cache' || args.target === 'both') {
      before.cache = await getCacheCounts(args.states, args.excludeCourseIds);
      console.log(`[purge] cache before courses=${before.cache.courseCount} tees=${before.cache.teeCount} holes=${before.cache.holeCount}`);
    }

    const summary = {
      states: args.states,
      target: args.target,
      dryRun: args.dryRun,
      excludeCourseIds: args.excludeCourseIds,
      before,
      after: null,
      checkpoint: args.resetCheckpointState && !args.dryRun && (args.target === 'cache' || args.target === 'both')
        ? resetCheckpointState(args.checkpointPath, args.states)
        : { updated: false, reason: args.dryRun ? 'dry_run' : (args.target === 'runtime' ? 'runtime_only' : 'not_requested') }
    };

    if (!args.dryRun) {
      if (args.target === 'runtime' || args.target === 'both') {
        await purgeGolfState(golfPool, args.states, args.excludeCourseIds);
      }
      if (args.target === 'cache' || args.target === 'both') {
        await purgeCacheState(args.states, args.excludeCourseIds);
      }

      summary.after = {};
      if (args.target === 'runtime' || args.target === 'both') {
        summary.after.golf = await getGolfCounts(golfPool, args.states, args.excludeCourseIds);
      }
      if (args.target === 'cache' || args.target === 'both') {
        summary.after.cache = await getCacheCounts(args.states, args.excludeCourseIds);
      }
    }

    console.log(`[purge] finished elapsed=${formatDurationMs(Date.now() - runStartedAtMs)}`);
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