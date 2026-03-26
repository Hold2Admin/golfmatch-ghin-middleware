/**
 * Repair GolfDB GHIN runtime mirror rows from CacheDB without refetching GHIN.
 *
 * Modes:
 * - Explicit IDs: replay only the specified course IDs.
 * - Auto-discovery: find CacheDB rows that are missing in GolfDB or whose GolfDB
 *   mirror hash does not match the current canonical cache payload.
 *
 * Usage:
 *   node scripts/repair-ghin-course-mirror.js 14914 3857
 *   node scripts/repair-ghin-course-mirror.js --ids=14914,3857
 *   node scripts/repair-ghin-course-mirror.js --state=US-CT
 *   node scripts/repair-ghin-course-mirror.js --state=CT --mode=missing --dry-run
 *   node scripts/repair-ghin-course-mirror.js --state=US-CT --limit=50 --concurrency=1
 */

const crypto = require('crypto');
const sql = require('mssql');
const { loadSecrets } = require('../src/config/secrets');

function parseArgs(argv) {
  const options = {
    ids: [],
    state: null,
    mode: 'all',
    limit: 0,
    concurrency: 1,
    dryRun: false
  };

  for (const arg of argv) {
    if (!arg.startsWith('--')) {
      options.ids.push(String(arg).trim());
      continue;
    }

    const [rawKey, ...rawValueParts] = arg.slice(2).split('=');
    const key = String(rawKey || '').trim();
    const value = rawValueParts.join('=').trim();

    if (key === 'ids' && value) {
      options.ids.push(...value.split(',').map((id) => String(id).trim()).filter(Boolean));
      continue;
    }

    if (key === 'state' && value) {
      options.state = normalizeState(value);
      continue;
    }

    if (key === 'mode' && value) {
      options.mode = String(value).trim().toLowerCase();
      continue;
    }

    if (key === 'limit' && value) {
      const parsed = Number(value);
      options.limit = Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 0;
      continue;
    }

    if (key === 'concurrency' && value) {
      const parsed = Number(value);
      options.concurrency = Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 1;
      continue;
    }

    if (key === 'dry-run') {
      options.dryRun = true;
    }
  }

  options.ids = Array.from(new Set(options.ids.map((id) => String(id).trim()).filter(Boolean)));

  if (!['all', 'missing', 'stale'].includes(options.mode)) {
    throw new Error(`Invalid --mode value: ${options.mode}. Expected one of: all, missing, stale`);
  }

  return options;
}

function normalizeState(rawState) {
  const normalized = String(rawState || '').trim().toUpperCase();
  if (!normalized) {
    return null;
  }

  return normalized.startsWith('US-') ? normalized.slice(3) : normalized;
}

function normalizeText(value) {
  if (value === null || value === undefined) return null;
  const normalized = String(value).trim();
  return normalized.length ? normalized : null;
}

function normalizeNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const normalized = Number(value);
  return Number.isFinite(normalized) ? normalized : null;
}

function normalizeBit(value) {
  if (value === true || value === 1 || value === '1') return 1;
  return 0;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function classifyRepairFailure(errorMessage) {
  const message = String(errorMessage || '');

  if (/Mirror callback failed \(5\d\d\)/i.test(message) || /deadlocked on lock resources/i.test(message)) {
    return 'retryableOperational';
  }

  if (/missing holes\[\]/i.test(message) || /missing hole handicap\/allocation data/i.test(message)) {
    return 'sourceData';
  }

  if (/missing required field/i.test(message) || /cache payload/i.test(message)) {
    return 'payloadInvalid';
  }

  return 'other';
}

function buildGolfMirrorCanonical(payload) {
  const source = payload || {};
  const teesRaw = Array.isArray(source.tees) ? source.tees : [];

  const ghinCourseId = normalizeText(source.ghinCourseId || source.courseId);
  const courseName = normalizeText(source.courseName || source.name);
  const shortCourseName = normalizeText(source.shortCourseName);
  const facilityId = normalizeText(source.facilityId);
  const facilityName = normalizeText(source.facilityName);
  const city = normalizeText(source.city);
  const state = normalizeText(source.state);
  const country = normalizeText(source.country) || 'USA';
  const sourceLastChangedAt = normalizeText(source.sourceLastChangedAt || source.lastUpdatedUtc);

  if (!ghinCourseId) {
    throw new Error('Missing required field: ghinCourseId');
  }
  if (!courseName) {
    throw new Error(`Course ${ghinCourseId} missing required field: courseName`);
  }
  if (!teesRaw.length) {
    throw new Error(`Course ${ghinCourseId} missing required field: tees[]`);
  }

  const tees = teesRaw.map((tee, teeIndex) => {
    const ghinTeeId = normalizeText(tee.ghinTeeId || tee.teeId);
    const teeName = normalizeText(tee.teeName || tee.name);
    const teeSetSide = normalizeText(tee.teeSetSide);
    const gender = normalizeText(tee.gender);
    const holesRaw = Array.isArray(tee.holes) ? tee.holes : [];

    if (!ghinTeeId) {
      throw new Error(`Course ${ghinCourseId} tees[${teeIndex}] missing ghinTeeId`);
    }
    if (!teeName) {
      throw new Error(`Course ${ghinCourseId} tees[${teeIndex}] missing teeName`);
    }
    if (!holesRaw.length) {
      throw new Error(`Course ${ghinCourseId} tees[${teeIndex}] missing holes[]`);
    }

    const holes = holesRaw.map((hole, holeIndex) => {
      const holeNumber = normalizeNumber(hole.holeNumber);
      const par = normalizeNumber(hole.par);

      if (!holeNumber || !par) {
        throw new Error(`Course ${ghinCourseId} tees[${teeIndex}].holes[${holeIndex}] missing holeNumber/par`);
      }

      return {
        holeNumber,
        par,
        handicap: normalizeNumber(hole.handicap),
        yardage: normalizeNumber(hole.yardage)
      };
    });

    holes.sort((a, b) => a.holeNumber - b.holeNumber);

    return {
      ghinTeeId,
      teeName,
      teeSetSide,
      gender,
      isDefault: normalizeBit(tee.isDefault),
      courseRating18: normalizeNumber(tee.courseRating18),
      slopeRating18: normalizeNumber(tee.slopeRating18),
      par18: normalizeNumber(tee.par18),
      yardage18: normalizeNumber(tee.yardage18),
      courseRatingF9: normalizeNumber(tee.courseRatingF9),
      slopeRatingF9: normalizeNumber(tee.slopeRatingF9),
      parF9: normalizeNumber(tee.parF9),
      yardageF9: normalizeNumber(tee.yardageF9),
      courseRatingB9: normalizeNumber(tee.courseRatingB9),
      slopeRatingB9: normalizeNumber(tee.slopeRatingB9),
      parB9: normalizeNumber(tee.parB9),
      yardageB9: normalizeNumber(tee.yardageB9),
      holes
    };
  });

  tees.sort((a, b) => a.ghinTeeId.localeCompare(b.ghinTeeId));

  return {
    ghinCourseId,
    facilityId,
    facilityName,
    courseName,
    shortCourseName,
    city,
    state,
    country,
    sourceLastChangedAt,
    tees
  };
}

function computeGolfMirrorHash(payload) {
  const canonical = buildGolfMirrorCanonical(payload);
  return crypto.createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}

async function getGolfDbPool(secrets) {
  const server = secrets.AZURE_SQL_SERVER;
  const database = secrets.AZURE_SQL_DATABASE;
  const user = secrets.AZURE_SQL_USER;
  const password = secrets.AZURE_SQL_PASSWORD;

  if (!server || !database || !user || !password) {
    throw new Error('GolfDB configuration missing (AZURE_SQL_SERVER, AZURE_SQL_DATABASE, AZURE_SQL_USER, AZURE_SQL_PASSWORD)');
  }

  const pool = new sql.ConnectionPool({
    server,
    database,
    user,
    password,
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

async function getCacheRows(database, ids, state, limit) {
  const dbSql = database.sql;

  if (ids.length) {
    return database.query(
      `SELECT c.courseId, c.courseName, c.state, c.lastPayloadHash
       FROM dbo.GHIN_Courses c
       INNER JOIN OPENJSON(@idsJson) WITH (courseId VARCHAR(50) '$') src
         ON src.courseId = c.courseId
       ORDER BY TRY_CONVERT(BIGINT, c.courseId), c.courseId`,
      {
        idsJson: { type: dbSql.NVarChar(dbSql.MAX), value: JSON.stringify(ids) }
      }
    );
  }

  if (state) {
    return database.query(
      `SELECT ${limit > 0 ? 'TOP (@limit)' : ''} c.courseId, c.courseName, c.state, c.lastPayloadHash
       FROM dbo.GHIN_Courses c
       WHERE c.state = @state
       ORDER BY TRY_CONVERT(BIGINT, c.courseId), c.courseId`,
      {
        ...(limit > 0 ? { limit: { type: dbSql.Int, value: limit } } : {}),
        state: { type: dbSql.VarChar(10), value: state }
      }
    );
  }

  return database.query(
    `SELECT ${limit > 0 ? 'TOP (@limit)' : ''} c.courseId, c.courseName, c.state, c.lastPayloadHash
     FROM dbo.GHIN_Courses c
     ORDER BY TRY_CONVERT(BIGINT, c.courseId), c.courseId`,
    limit > 0 ? { limit: { type: dbSql.Int, value: limit } } : {}
  );
}

async function getGolfMirrorRows(pool, courseIds) {
  if (!courseIds.length) {
    return new Map();
  }

  const rows = await pool.request()
    .input('idsJson', sql.NVarChar(sql.MAX), JSON.stringify(courseIds))
    .query(`
      SELECT c.GhinCourseId, c.PayloadHash
      FROM dbo.GhinRuntimeCourses c
      INNER JOIN OPENJSON(@idsJson) WITH (courseId VARCHAR(50) '$') src
        ON src.courseId = c.GhinCourseId
    `);

  return new Map(
    (rows.recordset || []).map((row) => [String(row.GhinCourseId), {
      payloadHash: row.PayloadHash ? String(row.PayloadHash) : null
    }])
  );
}

async function mapLimit(items, concurrency, worker) {
  const results = new Array(items.length);
  let cursor = 0;

  async function runWorker() {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) {
        return;
      }
      results[index] = await worker(items[index], index);
    }
  }

  const workerCount = Math.min(Math.max(1, concurrency), Math.max(1, items.length));
  await Promise.all(Array.from({ length: workerCount }, () => runWorker()));
  return results;
}

async function discoverRepairCandidates({ database, golfPool, buildMirrorPayloadFromCache, cacheRows, mode, concurrency }) {
  const golfRows = await getGolfMirrorRows(golfPool, cacheRows.map((row) => String(row.courseId)));
  const missing = [];
  const potentialStale = [];

  for (const row of cacheRows) {
    const courseId = String(row.courseId);
    const golfRow = golfRows.get(courseId) || null;
    if (!golfRow) {
      missing.push({
        courseId,
        courseName: row.courseName || null,
        state: row.state || null,
        reason: 'missing'
      });
      continue;
    }

    if (mode !== 'missing') {
      potentialStale.push({
        courseId,
        courseName: row.courseName || null,
        state: row.state || null,
        golfPayloadHash: golfRow.payloadHash || null
      });
    }
  }

  const staleResults = mode === 'missing'
    ? []
    : await mapLimit(potentialStale, concurrency, async (row) => {
      try {
        const payload = await buildMirrorPayloadFromCache(row.courseId);
        if (!payload) {
          return {
            courseId: row.courseId,
            courseName: row.courseName,
            state: row.state,
            reason: 'cache_payload_missing'
          };
        }

        const expectedPayloadHash = computeGolfMirrorHash(payload);
        if (row.golfPayloadHash === expectedPayloadHash) {
          return null;
        }

        return {
          courseId: row.courseId,
          courseName: row.courseName,
          state: row.state,
          reason: 'stale',
          golfPayloadHash: row.golfPayloadHash,
          expectedPayloadHash
        };
      } catch (error) {
        return {
          courseId: row.courseId,
          courseName: row.courseName,
          state: row.state,
          reason: 'cache_payload_invalid',
          error: error.message
        };
      }
    });

  const stale = staleResults.filter(Boolean);
  if (mode === 'missing') {
    return missing;
  }
  if (mode === 'stale') {
    return stale.filter((row) => row.reason === 'stale');
  }

  return [
    ...missing,
    ...stale.filter((row) => row.reason === 'stale')
  ];
}

async function replayMirrorCandidate({ candidate, buildMirrorPayloadFromCache, callbackUrl, callbackApiKey }) {
  const payload = await buildMirrorPayloadFromCache(candidate.courseId);
  if (!payload) {
    throw new Error(`Cache payload not found for course ${candidate.courseId}`);
  }

  const expectedPayloadHash = computeGolfMirrorHash(payload);
  const maxAttempts = Math.max(1, Number(process.env.GHIN_MIRROR_CALLBACK_MAX_ATTEMPTS || 2));

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const response = await fetch(callbackUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': callbackApiKey
      },
      body: JSON.stringify({
        ...payload,
        payloadHash: expectedPayloadHash
      })
    });

    const bodyText = await response.text();
    let parsed = null;

    try {
      parsed = bodyText ? JSON.parse(bodyText) : null;
    } catch (_) {
      parsed = null;
    }

    if (response.ok) {
      return {
        courseId: candidate.courseId,
        reason: candidate.reason,
        status: parsed?.status || 'updated',
        payloadHash: expectedPayloadHash
      };
    }

    const details = parsed ? JSON.stringify(parsed) : bodyText;
    const isRetryable = response.status >= 500 && attempt < maxAttempts;
    if (isRetryable) {
      await sleep(250 * attempt);
      continue;
    }

    throw new Error(`Mirror callback failed (${response.status}): ${details}`);
  }

  throw new Error('Mirror callback failed after retries.');
}

async function run() {
  const options = parseArgs(process.argv.slice(2));
  const secrets = await loadSecrets();
  Object.assign(process.env, secrets);

  const callbackUrl = process.env.GHIN_IMPORT_CALLBACK_URL;
  const callbackApiKey = process.env.GHIN_MIDDLEWARE_API_KEY;

  if (!callbackUrl) {
    throw new Error('GHIN_IMPORT_CALLBACK_URL is required for mirror repair.');
  }
  if (!callbackApiKey) {
    throw new Error('GHIN_MIDDLEWARE_API_KEY is required for mirror repair.');
  }

  const database = require('../src/services/database');
  const { buildMirrorPayloadFromCache } = require('../src/services/courseSyncService');
  const golfPool = await getGolfDbPool(secrets);

  try {
    const cacheRows = await getCacheRows(database, options.ids, options.state, options.limit);
    const candidates = options.ids.length
      ? options.ids.map((courseId) => ({ courseId, reason: 'explicit' }))
      : await discoverRepairCandidates({
        database,
        golfPool,
        buildMirrorPayloadFromCache,
        cacheRows,
        mode: options.mode,
        concurrency: options.concurrency
      });

    const summary = {
      mode: options.ids.length ? 'explicit' : options.mode,
      state: options.state,
      dryRun: options.dryRun,
      scanned: cacheRows.length,
      candidates: candidates.length,
      repaired: 0,
      nochange: 0,
      failed: 0,
      failureBuckets: {},
      reasons: candidates.reduce((acc, row) => {
        const key = row.reason || 'unknown';
        acc[key] = (acc[key] || 0) + 1;
        return acc;
      }, {}),
      results: []
    };

    if (options.dryRun) {
      summary.results = candidates;
      console.log(JSON.stringify(summary, null, 2));
      return;
    }

    const results = await mapLimit(candidates, options.concurrency, async (candidate) => {
      try {
        const result = await replayMirrorCandidate({
          candidate,
          buildMirrorPayloadFromCache,
          callbackUrl,
          callbackApiKey
        });

        return {
          ...result,
          ok: true
        };
      } catch (error) {
        const failureClass = classifyRepairFailure(error.message);
        return {
          courseId: candidate.courseId,
          reason: candidate.reason,
          ok: false,
          failureClass,
          error: error.message
        };
      }
    });

    for (const result of results) {
      if (result.ok) {
        if (result.status === 'processed-nochange') {
          summary.nochange += 1;
        } else {
          summary.repaired += 1;
        }
      } else {
        summary.failed += 1;
        const failureClass = result.failureClass || 'other';
        summary.failureBuckets[failureClass] = (summary.failureBuckets[failureClass] || 0) + 1;
      }
      summary.results.push(result);
    }

    console.log(JSON.stringify(summary, null, 2));
  } finally {
    await golfPool.close();
    await database.close();
  }
}

run().catch((error) => {
  console.error('Mirror repair failed:', error.message);
  process.exit(1);
});