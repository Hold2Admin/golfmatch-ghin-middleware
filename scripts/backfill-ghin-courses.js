/**
 * Discover and backfill GHIN courses into CacheDB + runtime mirror.
 *
 * Strategy:
 * - Discover course IDs by crawling GHIN /courses/search partitioned by state
 * - Diff discovered IDs against GHIN_Courses in CacheDB in batched queries
 * - Fetch and sync only missing course IDs through the existing course sync pipeline
 * - Persist lightweight checkpoint state so long runs can resume
 *
 * Usage examples:
 *   node scripts/backfill-ghin-courses.js
 *   node scripts/backfill-ghin-courses.js --states=US-WA,US-OR --sync-concurrency=12
 *   node scripts/backfill-ghin-courses.js --states=US-CT --sync-concurrency=8 --mirror-concurrency=2
 *   node scripts/backfill-ghin-courses.js --states=US-NY --projection-mode=none --cache-batch-size=100
 *   node scripts/backfill-ghin-courses.js --states=US-GA --projection-mode=none --validation-chunk-size=25 --cache-batch-size=100
 *   node scripts/backfill-ghin-courses.js --states=US-VT --sync-concurrency=16 --cache-write-concurrency=4 --projection-mode=none
 *   node scripts/backfill-ghin-courses.js --states=US-NY --projection-mode=none
 *   node scripts/backfill-ghin-courses.js --states=US-CT --validate-only
 *   node scripts/backfill-ghin-courses.js --dry-run --search-concurrency=8
 *   node scripts/backfill-ghin-courses.js --reset-checkpoint
 */

const fs = require('fs');
const path = require('path');
const database = require('../src/services/database');
const { loadSecrets } = require('../src/config/secrets');

const CHECKPOINT_PATH = path.join(__dirname, 'logs', 'ghin-course-backfill-checkpoint.json');
const US_STATE_CODES = [
  'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA',
  'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD',
  'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ',
  'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC',
  'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY'
];

function createFailureBreakdown() {
  return {
    retryableOperational: 0,
    sourceData: 0,
    other: 0
  };
}

function createTimingMetric() {
  return {
    count: 0,
    totalMs: 0,
    avgMs: 0,
    minMs: null,
    maxMs: 0
  };
}

function createPerformanceSummary() {
  return {
    fetchDurationMs: createTimingMetric(),
    validationDurationMs: createTimingMetric(),
    noopDetectionDurationMs: createTimingMetric(),
    upsertDurationMs: createTimingMetric(),
    mirrorDurationMs: createTimingMetric(),
    syncDurationMs: createTimingMetric(),
    totalDurationMs: createTimingMetric()
  };
}

function recordTimingMetric(metric, durationMs) {
  if (!metric || !Number.isFinite(durationMs) || durationMs < 0) {
    return;
  }

  metric.count += 1;
  metric.totalMs += durationMs;
  metric.avgMs = Number((metric.totalMs / metric.count).toFixed(1));
  metric.minMs = metric.minMs == null ? durationMs : Math.min(metric.minMs, durationMs);
  metric.maxMs = Math.max(metric.maxMs, durationMs);
}

function recordPerformanceSummary(summary, timings) {
  if (!summary || !timings) {
    return;
  }

  Object.keys(summary).forEach((key) => {
    recordTimingMetric(summary[key], timings[key]);
  });
}

function createRunTotals() {
  return {
    discovered: 0,
    missing: 0,
    validated: 0,
    synced: 0,
    skippedExisting: 0,
    failed: 0,
    failureBreakdown: createFailureBreakdown(),
    performance: createPerformanceSummary(),
    writeBreakdown: createWriteBreakdownSummary()
  };
}

function createWriteBreakdownSummary() {
  return {
    flushCount: 0,
    courseCount: 0,
    teeCount: 0,
    holeCount: 0,
    buildPayloadDurationMs: createTimingMetric(),
    coursesMergeDurationMs: createTimingMetric(),
    teesMergeDurationMs: createTimingMetric(),
    holesMergeDurationMs: createTimingMetric(),
    commitDurationMs: createTimingMetric(),
    totalDurationMs: createTimingMetric()
  };
}

function recordWriteBreakdownSummary(summary, batchTiming) {
  if (!summary || !batchTiming) {
    return;
  }

  summary.flushCount += 1;
  summary.courseCount += Number(batchTiming.courseCount || 0);
  summary.teeCount += Number(batchTiming.teeCount || 0);
  summary.holeCount += Number(batchTiming.holeCount || 0);

  recordTimingMetric(summary.buildPayloadDurationMs, batchTiming.timings?.buildPayloadDurationMs);
  recordTimingMetric(summary.coursesMergeDurationMs, batchTiming.timings?.coursesMergeDurationMs);
  recordTimingMetric(summary.teesMergeDurationMs, batchTiming.timings?.teesMergeDurationMs);
  recordTimingMetric(summary.holesMergeDurationMs, batchTiming.timings?.holesMergeDurationMs);
  recordTimingMetric(summary.commitDurationMs, batchTiming.timings?.commitDurationMs);
  recordTimingMetric(summary.totalDurationMs, batchTiming.timings?.totalDurationMs);
}

function summarizeWriteBreakdown(summary) {
  return {
    flushCount: summary.flushCount,
    courseCount: summary.courseCount,
    teeCount: summary.teeCount,
    holeCount: summary.holeCount,
    buildPayloadAvgMs: summary.buildPayloadDurationMs.avgMs,
    coursesMergeAvgMs: summary.coursesMergeDurationMs.avgMs,
    teesMergeAvgMs: summary.teesMergeDurationMs.avgMs,
    holesMergeAvgMs: summary.holesMergeDurationMs.avgMs,
    commitAvgMs: summary.commitDurationMs.avgMs,
    totalFlushAvgMs: summary.totalDurationMs.avgMs
  };
}

function createEmptyCheckpoint() {
  return {
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    completedStates: [],
    failedStates: {},
    totals: {
      discovered: 0,
      missing: 0,
      synced: 0,
      skippedExisting: 0,
      failed: 0,
      failureBreakdown: createFailureBreakdown()
    },
    stateSummaries: {}
  };
}

function hydrateCheckpoint(checkpoint) {
  const next = checkpoint && typeof checkpoint === 'object' ? checkpoint : createEmptyCheckpoint();
  next.completedStates = Array.isArray(next.completedStates) ? next.completedStates : [];
  next.failedStates = next.failedStates && typeof next.failedStates === 'object' ? next.failedStates : {};
  next.stateSummaries = next.stateSummaries && typeof next.stateSummaries === 'object' ? next.stateSummaries : {};
  next.totals = next.totals && typeof next.totals === 'object' ? next.totals : {};
  next.totals.discovered = Number(next.totals.discovered || 0);
  next.totals.missing = Number(next.totals.missing || 0);
  next.totals.synced = Number(next.totals.synced || 0);
  next.totals.skippedExisting = Number(next.totals.skippedExisting || 0);
  next.totals.failed = Number(next.totals.failed || 0);
  next.totals.failureBreakdown = {
    ...createFailureBreakdown(),
    ...(next.totals.failureBreakdown || {})
  };
  return next;
}

function classifyFailure(errorMessage) {
  const message = String(errorMessage || '');
  if (
    message.includes('missing hole handicap/allocation data')
    || message.includes('missing holes[]')
    || message.includes('invalid par')
    || message.includes('invalid holeNumber')
    || message.includes('CK_GHIN_Holes_Par')
  ) {
    return 'sourceData';
  }

  if (
    message.includes('deadlocked on lock resources')
    || message.includes('Mirror callback failed (500)')
    || message.includes('timeout')
    || message.includes('ECONNRESET')
    || message.includes('ETIMEDOUT')
  ) {
    return 'retryableOperational';
  }

  return 'other';
}

function parseArgs(argv) {
  const args = {
    states: null,
    dryRun: false,
    validateOnly: false,
    searchConcurrency: 6,
    syncConcurrency: 8,
    cacheWriteConcurrency: 4,
    validationChunkSize: 25,
    cacheBatchSize: 100,
    mirrorConcurrency: 2,
    projectionMode: 'callback',
    dbBatchSize: 500,
    pageSize: 500,
    checkpointPath: CHECKPOINT_PATH,
    resetCheckpoint: false
  };

  for (const raw of argv) {
    if (raw === '--dry-run') {
      args.dryRun = true;
      continue;
    }
    if (raw === '--validate-only' || raw === '--preflight-only') {
      args.validateOnly = true;
      continue;
    }
    if (raw === '--reset-checkpoint') {
      args.resetCheckpoint = true;
      continue;
    }

    const [flag, value] = raw.split('=');
    if (value == null) continue;

    switch (flag) {
      case '--states':
        args.states = value
          .split(',')
          .map((item) => normalizeStatePartition(item))
          .filter(Boolean);
        break;
      case '--search-concurrency':
        args.searchConcurrency = parsePositiveInt(value, args.searchConcurrency);
        break;
      case '--sync-concurrency':
        args.syncConcurrency = parsePositiveInt(value, args.syncConcurrency);
        break;
      case '--cache-write-concurrency':
        args.cacheWriteConcurrency = parsePositiveInt(value, args.cacheWriteConcurrency);
        break;
      case '--validation-chunk-size':
        args.validationChunkSize = parsePositiveInt(value, args.validationChunkSize);
        break;
      case '--cache-batch-size':
        args.cacheBatchSize = parsePositiveInt(value, args.cacheBatchSize);
        break;
      case '--mirror-concurrency':
        args.mirrorConcurrency = parsePositiveInt(value, args.mirrorConcurrency);
        break;
      case '--projection-mode': {
        const normalized = String(value).trim().toLowerCase();
        if (normalized === 'callback' || normalized === 'none') {
          args.projectionMode = normalized;
        }
        break;
      }
      case '--db-batch-size':
        args.dbBatchSize = parsePositiveInt(value, args.dbBatchSize);
        break;
      case '--page-size':
        args.pageSize = parsePositiveInt(value, args.pageSize);
        break;
      case '--checkpoint':
        args.checkpointPath = path.resolve(value);
        break;
      default:
        break;
    }
  }

  if (args.dryRun && args.validateOnly) {
    throw new Error('Choose either --dry-run or --validate-only, not both.');
  }

  if (!['callback', 'none'].includes(args.projectionMode)) {
    throw new Error('Invalid --projection-mode value. Expected callback or none.');
  }

  return args;
}

function parsePositiveInt(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function normalizeStatePartition(value) {
  const trimmed = String(value || '').trim().toUpperCase();
  if (!trimmed) return null;
  if (/^US-[A-Z]{2}$/.test(trimmed)) return trimmed;
  if (/^[A-Z]{2}$/.test(trimmed)) return `US-${trimmed}`;
  return null;
}

function ensureParentDir(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function loadCheckpoint(checkpointPath, reset) {
  if (reset || !fs.existsSync(checkpointPath)) {
    return createEmptyCheckpoint();
  }

  try {
    return hydrateCheckpoint(JSON.parse(fs.readFileSync(checkpointPath, 'utf8')));
  } catch (_) {
    return createEmptyCheckpoint();
  }
}

function saveCheckpoint(checkpointPath, checkpoint) {
  ensureParentDir(checkpointPath);
  checkpoint.updatedAt = new Date().toISOString();
  fs.writeFileSync(checkpointPath, JSON.stringify(checkpoint, null, 2));
}

async function mapLimit(items, limit, worker) {
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

  const workers = Array.from({ length: Math.min(limit, Math.max(items.length, 1)) }, () => runWorker());
  await Promise.all(workers);
  return results;
}

function chunk(array, size) {
  const chunks = [];
  for (let index = 0; index < array.length; index += size) {
    chunks.push(array.slice(index, index + size));
  }
  return chunks;
}

function formatDuration(ms) {
  if (!Number.isFinite(ms) || ms < 1000) {
    return `${Math.max(0, Math.round(ms || 0))}ms`;
  }

  return `${(ms / 1000).toFixed(1)}s`;
}

function buildFailureSamples(failures, limitPerClass = 3) {
  const samples = {};

  for (const failure of failures || []) {
    const failureClass = failure.failureClass || 'other';
    if (!samples[failureClass]) {
      samples[failureClass] = [];
    }

    if (samples[failureClass].length < limitPerClass) {
      samples[failureClass].push(String(failure.courseId));
    }
  }

  return samples;
}

function summarizeStateForConsole(summary) {
  return {
    discovered: summary.discovered,
    existing: summary.existing,
    missing: summary.missing,
    validated: summary.validated,
    synced: summary.synced,
    failed: summary.failed,
    failureBreakdown: summary.failureBreakdown
  };
}

function logStateProgress(state, label, summary, processedCount, totalCount, stateStartedAtMs, bufferedValidatedCount = 0, flushedCourseCount = 0) {
  const flushedSegment = flushedCourseCount > 0 ? ` flushed=${flushedCourseCount}` : '';
  console.log(
    `[progress] ${state} ${label}: processed=${processedCount}/${totalCount} ` +
    `validated=${summary.validated} buffered=${bufferedValidatedCount}${flushedSegment} synced=${summary.synced} failed=${summary.failed} ` +
    `elapsed=${formatDuration(Date.now() - stateStartedAtMs)} ` +
    `fetchAvg=${summary.performance.fetchDurationMs.avgMs}ms ` +
    `upsertAvg=${summary.performance.upsertDurationMs.avgMs}ms`
  );
}

function applyResultToSummary(result, summary, runTotals, checkpoint) {
  recordPerformanceSummary(summary.performance, result.timings);
  recordPerformanceSummary(runTotals.performance, result.timings);

  if (result.status === 'validated') {
    summary.validated += 1;
    runTotals.validated += 1;
    return;
  }

  if (result.status === 'synced' || result.status === 'cache-updated') {
    summary.synced += 1;
    checkpoint.totals.synced += 1;
    return;
  }

  const failureClass = classifyFailure(result.error);
  summary.failed += 1;
  summary.failureBreakdown[failureClass] += 1;
  checkpoint.totals.failureBreakdown[failureClass] += 1;
  summary.failures.push({
    ...result,
    failureClass
  });
  checkpoint.totals.failed += 1;
}

async function fetchAndValidateCourse(client, courseId, validateCourseForSync) {
  const courseStartedAtMs = Date.now();
  let fetchDurationMs = 0;

  try {
    const fetchStartedAtMs = Date.now();
    const course = await client.getCourse(courseId);
    fetchDurationMs = Date.now() - fetchStartedAtMs;

    if (!course) {
      throw new Error('Course not found in GHIN detail endpoint');
    }

    const validationStartedAtMs = Date.now();
    validateCourseForSync(course);
    const validationDurationMs = Date.now() - validationStartedAtMs;

    return {
      courseId,
      course,
      status: 'validated',
      timings: {
        fetchDurationMs,
        validationDurationMs,
        noopDetectionDurationMs: 0,
        upsertDurationMs: 0,
        mirrorDurationMs: 0,
        syncDurationMs: validationDurationMs,
        totalDurationMs: Date.now() - courseStartedAtMs
      }
    };
  } catch (error) {
    return {
      courseId,
      status: 'failed',
      error: error.message,
      timings: {
        fetchDurationMs,
        validationDurationMs: 0,
        noopDetectionDurationMs: 0,
        upsertDurationMs: 0,
        mirrorDurationMs: 0,
        syncDurationMs: 0,
        totalDurationMs: Date.now() - courseStartedAtMs
      }
    };
  }
}

async function persistValidatedBatch(batch, bulkUpsertCoursesToCache) {
  if (!batch.length) {
    return { results: [], batchTimings: [] };
  }

  try {
    const bulkResult = await bulkUpsertCoursesToCache(batch.map((item) => item.course), {
      cacheSource: 'USGA_WEBHOOK',
      assumeMissingCourses: true
    });

    const sharedUpsertDurationMs = Math.max(1, Math.round(Number(bulkResult.timings?.totalDurationMs || 0) / batch.length));

    return {
      results: batch.map((item) => ({
        courseId: item.courseId,
        status: 'cache-updated',
        timings: {
          fetchDurationMs: item.timings.fetchDurationMs,
          validationDurationMs: item.timings.validationDurationMs,
          noopDetectionDurationMs: 0,
          upsertDurationMs: sharedUpsertDurationMs,
          mirrorDurationMs: 0,
          syncDurationMs: item.timings.validationDurationMs + sharedUpsertDurationMs,
          totalDurationMs: item.timings.fetchDurationMs + item.timings.validationDurationMs + sharedUpsertDurationMs
        }
      })),
      batchTimings: [bulkResult]
    };
  } catch (error) {
    if (batch.length === 1) {
      const item = batch[0];
      return {
        results: [{
          courseId: item.courseId,
          status: 'failed',
          error: error.message,
          timings: {
            fetchDurationMs: item.timings.fetchDurationMs,
            validationDurationMs: item.timings.validationDurationMs,
            noopDetectionDurationMs: 0,
            upsertDurationMs: 0,
            mirrorDurationMs: 0,
            syncDurationMs: item.timings.validationDurationMs,
            totalDurationMs: item.timings.totalDurationMs
          }
        }],
        batchTimings: []
      };
    }

    const midpoint = Math.ceil(batch.length / 2);
    const left = await persistValidatedBatch(batch.slice(0, midpoint), bulkUpsertCoursesToCache);
    const right = await persistValidatedBatch(batch.slice(midpoint), bulkUpsertCoursesToCache);
    return {
      results: [...left.results, ...right.results],
      batchTimings: [...left.batchTimings, ...right.batchTimings]
    };
  }
}

async function persistValidatedCoursesInBatches(validatedCourses, cacheBatchSize, bulkUpsertCoursesToCache) {
  const results = [];
  const batchTimings = [];
  for (const batch of chunk(validatedCourses, cacheBatchSize)) {
    const batchResult = await persistValidatedBatch(batch, bulkUpsertCoursesToCache);
    results.push(...batchResult.results);
    batchTimings.push(...batchResult.batchTimings);
  }
  return { results, batchTimings };
}

async function getExistingCourseIds(courseIds, batchSize) {
  const sql = database.sql;
  const existing = new Set();

  for (const idsChunk of chunk(courseIds, batchSize)) {
    const rows = await database.query(
      `SELECT CourseId AS courseId
       FROM dbo.GHIN_Courses
       WHERE CourseId IN (SELECT [value] FROM OPENJSON(@idsJson))`,
      {
        idsJson: { type: sql.NVarChar(sql.MAX), value: JSON.stringify(idsChunk) }
      }
    );

    rows.forEach((row) => {
      if (row.courseId != null) {
        existing.add(String(row.courseId));
      }
    });
  }

  return existing;
}

async function discoverStateCourseIds(client, state, pageSize) {
  const discovered = new Map();
  const seenPageFingerprints = new Set();
  let page = 1;

  while (true) {
    const results = await client.searchCourses({ state, page, perPage: pageSize });
    if (!Array.isArray(results) || results.length === 0) {
      break;
    }

    const pageIds = results
      .map((course) => String(course.courseId || '').trim())
      .filter(Boolean);

    const fingerprint = pageIds.join(',');
    if (seenPageFingerprints.has(fingerprint)) {
      break;
    }
    seenPageFingerprints.add(fingerprint);

    let newIds = 0;
    for (const course of results) {
      const courseId = String(course.courseId || '').trim();
      if (!courseId || discovered.has(courseId)) continue;
      discovered.set(courseId, course);
      newIds += 1;
    }

    if (newIds === 0 || results.length < pageSize) {
      break;
    }

    page += 1;
  }

  return Array.from(discovered.values());
}

async function run() {
  const runStartedAtMs = Date.now();
  const args = parseArgs(process.argv.slice(2));
  const checkpoint = args.validateOnly
    ? createEmptyCheckpoint()
    : loadCheckpoint(args.checkpointPath, args.resetCheckpoint);

  const secrets = await loadSecrets();
  Object.assign(process.env, secrets);

  process.env.GHIN_MIRROR_CALLBACK_CONCURRENCY = String(args.mirrorConcurrency);
  process.env.GHIN_CACHE_WRITE_CONCURRENCY = String(args.cacheWriteConcurrency);

  const client = require('../src/services/usaGhinApiClient');
  const {
    bulkUpsertCoursesToCache,
    processCourseSync,
    validateCourseForSync
  } = require('../src/services/courseSyncService');

  const allStates = (args.states && args.states.length)
    ? args.states
    : US_STATE_CODES.map((code) => `US-${code}`);

  const pendingStates = args.validateOnly
    ? allStates
    : allStates.filter((state) => !checkpoint.completedStates.includes(state));
  const runSummaries = {};
  const runTotals = createRunTotals();

  console.log(`Starting GHIN course backfill for ${pendingStates.length} state partition(s).`);
  console.log(`Options: dryRun=${args.dryRun} validateOnly=${args.validateOnly} projectionMode=${args.projectionMode} searchConcurrency=${args.searchConcurrency} syncConcurrency=${args.syncConcurrency} cacheWriteConcurrency=${args.cacheWriteConcurrency} validationChunkSize=${args.validationChunkSize} cacheBatchSize=${args.cacheBatchSize} mirrorConcurrency=${args.mirrorConcurrency} dbBatchSize=${args.dbBatchSize} pageSize=${args.pageSize}`);

  await database.connect();

  const discoveryResults = await mapLimit(pendingStates, args.searchConcurrency, async (state) => {
    console.log(`[discover] ${state}...`);
    const courses = await discoverStateCourseIds(client, state, args.pageSize);
    console.log(`[discover] ${state}: ${courses.length} course(s)`);
    return { state, courses };
  });

  for (const stateResult of discoveryResults) {
    const { state, courses } = stateResult;
    const stateStartedAtMs = Date.now();
    const courseIds = courses.map((course) => String(course.courseId)).filter(Boolean);
    const existingIds = await getExistingCourseIds(courseIds, args.dbBatchSize);
    const missingIds = courseIds.filter((courseId) => !existingIds.has(courseId));

    const summary = {
      discovered: courseIds.length,
      existing: existingIds.size,
      missing: missingIds.length,
      validated: 0,
      synced: 0,
      failed: 0,
      failureBreakdown: createFailureBreakdown(),
      performance: createPerformanceSummary(),
      writeBreakdown: createWriteBreakdownSummary(),
      failures: []
    };

    checkpoint.totals.discovered += summary.discovered;
    checkpoint.totals.skippedExisting += summary.existing;
    checkpoint.totals.missing += summary.missing;

    console.log(`[plan] ${state}: discovered=${summary.discovered} existing=${summary.existing} missing=${summary.missing}`);

    if ((!args.dryRun || args.validateOnly) && missingIds.length > 0) {
      let processedCount = 0;
      let validatedBuffer = [];

      for (const missingChunk of chunk(missingIds, args.validationChunkSize)) {
        let syncResults;
        let flushedCourseCount = 0;

        if (args.validateOnly || args.projectionMode === 'none') {
          const preparedResults = await mapLimit(missingChunk, args.syncConcurrency, async (courseId) => {
            return fetchAndValidateCourse(client, courseId, validateCourseForSync);
          });

          const validationFailures = preparedResults.filter((result) => result.status === 'failed');
          const validatedCourses = preparedResults.filter((result) => result.status === 'validated');
          summary.validated += validatedCourses.length;
          runTotals.validated += validatedCourses.length;

          console.log(
            `[progress] ${state} validation: chunk=${processedCount + 1}-${processedCount + missingChunk.length}/${missingIds.length} ` +
            `validated=${validatedCourses.length} failed=${validationFailures.length} ` +
            `elapsed=${formatDuration(Date.now() - stateStartedAtMs)}`
          );

          if (args.validateOnly) {
            syncResults = validationFailures;
          } else {
            validatedBuffer.push(...validatedCourses);
            const flushCount = Math.floor(validatedBuffer.length / args.cacheBatchSize) * args.cacheBatchSize;
            let persistedResults = [];

            if (flushCount > 0) {
              const coursesToFlush = validatedBuffer.splice(0, flushCount);
              flushedCourseCount = coursesToFlush.length;
              const flushResult = await persistValidatedCoursesInBatches(
                coursesToFlush,
                args.cacheBatchSize,
                bulkUpsertCoursesToCache
              );
              persistedResults = flushResult.results;
              for (const batchTiming of flushResult.batchTimings) {
                recordWriteBreakdownSummary(summary.writeBreakdown, batchTiming);
                recordWriteBreakdownSummary(runTotals.writeBreakdown, batchTiming);
              }
            }

            syncResults = [...validationFailures, ...persistedResults];
          }
        } else {
          syncResults = await mapLimit(missingChunk, args.syncConcurrency, async (courseId) => {
          const courseStartedAtMs = Date.now();
          let fetchDurationMs = 0;

          try {
            const fetchStartedAtMs = Date.now();
            const course = await client.getCourse(courseId);
            fetchDurationMs = Date.now() - fetchStartedAtMs;

            if (!course) {
              throw new Error('Course not found in GHIN detail endpoint');
            }

            const syncResult = await processCourseSync(course, {
              detectNoop: false,
              syncMirror: true
            });

            return {
              courseId,
              status: 'synced',
              timings: {
                fetchDurationMs,
                validationDurationMs: Number(syncResult.timings?.validationDurationMs || 0),
                noopDetectionDurationMs: Number(syncResult.timings?.noopDetectionDurationMs || 0),
                upsertDurationMs: Number(syncResult.timings?.upsertDurationMs || 0),
                mirrorDurationMs: Number(syncResult.timings?.mirrorDurationMs || 0),
                syncDurationMs: Number(syncResult.timings?.totalDurationMs || 0),
                totalDurationMs: Date.now() - courseStartedAtMs
              }
            };
          } catch (error) {
            return {
              courseId,
              status: 'failed',
              error: error.message,
              timings: {
                fetchDurationMs,
                validationDurationMs: Number(error.syncTimings?.validationDurationMs || 0),
                noopDetectionDurationMs: Number(error.syncTimings?.noopDetectionDurationMs || 0),
                upsertDurationMs: Number(error.syncTimings?.upsertDurationMs || 0),
                mirrorDurationMs: Number(error.syncTimings?.mirrorDurationMs || 0),
                syncDurationMs: Number(error.syncTimings?.totalDurationMs || 0),
                totalDurationMs: Date.now() - courseStartedAtMs
              }
            };
          }
        });
        }

        for (const result of syncResults) {
          applyResultToSummary(result, summary, runTotals, checkpoint);
        }

        processedCount += missingChunk.length;
        logStateProgress(state, 'chunk', summary, processedCount, missingIds.length, stateStartedAtMs, validatedBuffer.length, flushedCourseCount);
      }

      if (!args.validateOnly && args.projectionMode === 'none' && validatedBuffer.length > 0) {
        const finalFlushCourseCount = validatedBuffer.length;
        const flushResult = await persistValidatedCoursesInBatches(
          validatedBuffer,
          args.cacheBatchSize,
          bulkUpsertCoursesToCache
        );
        validatedBuffer = [];

        for (const batchTiming of flushResult.batchTimings) {
          recordWriteBreakdownSummary(summary.writeBreakdown, batchTiming);
          recordWriteBreakdownSummary(runTotals.writeBreakdown, batchTiming);
        }

        for (const result of flushResult.results) {
          applyResultToSummary(result, summary, runTotals, checkpoint);
        }

        logStateProgress(state, 'final-flush', summary, processedCount, missingIds.length, stateStartedAtMs, 0, finalFlushCourseCount);
      }
    }

    checkpoint.stateSummaries[state] = summary;
    runSummaries[state] = summary;
    runTotals.discovered += summary.discovered;
    runTotals.missing += summary.missing;
    runTotals.synced += summary.synced;
    runTotals.skippedExisting += summary.existing;
    runTotals.failed += summary.failed;
    runTotals.failureBreakdown.retryableOperational += summary.failureBreakdown.retryableOperational;
    runTotals.failureBreakdown.sourceData += summary.failureBreakdown.sourceData;
    runTotals.failureBreakdown.other += summary.failureBreakdown.other;
    if (summary.failed > 0) {
      checkpoint.failedStates[state] = summary.failures;
    } else {
      delete checkpoint.failedStates[state];
    }

    if (!args.validateOnly) {
      checkpoint.completedStates.push(state);
      saveCheckpoint(args.checkpointPath, checkpoint);
    }

    console.log(
      `[done] ${state}: validated=${summary.validated} synced=${summary.synced} failed=${summary.failed} ` +
      `(retryable=${summary.failureBreakdown.retryableOperational}, sourceData=${summary.failureBreakdown.sourceData}, other=${summary.failureBreakdown.other})`
    );
  }

  if (!args.validateOnly) {
    saveCheckpoint(args.checkpointPath, checkpoint);
  }
  await database.close();

  console.log(`[elapsed] total=${formatDuration(Date.now() - runStartedAtMs)}`);
  console.log(args.validateOnly ? 'GHIN course preflight validation complete.' : 'GHIN course backfill complete.');
  console.log(JSON.stringify({
    mode: args.validateOnly ? 'validate-only' : args.dryRun ? 'dry-run' : 'backfill',
    projectionMode: args.projectionMode,
    totalElapsedMs: Date.now() - runStartedAtMs,
    totalElapsedSeconds: Number(((Date.now() - runStartedAtMs) / 1000).toFixed(1)),
    runStates: pendingStates,
    stateSummaries: Object.fromEntries(
      Object.entries(runSummaries).map(([state, summary]) => [state, summarizeStateForConsole(summary)])
    )
  }, null, 2));
}

run().catch(async (error) => {
  try {
    await database.close();
  } catch (_) {
    // Ignore shutdown errors.
  }
  console.error('GHIN course backfill failed:', error.message);
  process.exit(1);
});