const { createLogger } = require('../utils/logger');
const {
  purgeExpiredCacheCourses,
  reconcileOrphanGolfDbRatings
} = require('./courseSyncService');
const courseCachePolicy = require('./courseCachePolicy');
const { emitGrokBotEvent } = require('./grokBotEventWebhook');
const { DateTime } = require('luxon');

const logger = createLogger('ratingsExpiryScheduler');
const MAX_TIMEOUT_MS = 2147483647;
const DAY_TTL_ZONE = courseCachePolicy.DAY_TTL_ZONE || 'America/New_York';
// A few minutes after local midnight so ExpiresAt (== midnight) is definitely past.
const DEFAULT_MINUTE_AFTER_MIDNIGHT = 5;

let timer = null;
let inFlight = false;
let isRunning = false;
let nextRunAtMs = null;

function computeNextExpiryRun(nowUtc = DateTime.utc()) {
  const zone = DAY_TTL_ZONE;
  const nowLocal = nowUtc.setZone(zone);
  const minute = Number(process.env.GHIN_RATINGS_EXPIRY_MINUTE || DEFAULT_MINUTE_AFTER_MIDNIGHT);
  const safeMinute = Number.isFinite(minute) ? Math.max(0, Math.min(59, Math.floor(minute))) : DEFAULT_MINUTE_AFTER_MIDNIGHT;

  let candidate = nowLocal.startOf('day').plus({ minutes: safeMinute });
  if (candidate <= nowLocal) {
    candidate = candidate.plus({ days: 1 });
  }

  return {
    utc: candidate.toUTC(),
    local: candidate
  };
}

function clearTimer() {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
}

function scheduleForTarget(targetTimeMs, tick) {
  if (!isRunning) {
    return;
  }

  const remaining = Math.max(0, targetTimeMs - Date.now());
  const delay = Math.min(remaining, MAX_TIMEOUT_MS);

  timer = setTimeout(() => {
    if (!isRunning) {
      return;
    }

    if (Date.now() < targetTimeMs) {
      scheduleForTarget(targetTimeMs, tick);
      return;
    }

    tick();
  }, delay);
}

function notifyExpiryResult(result, trigger) {
  if (!result) {
    emitGrokBotEvent({
      type: 'ratings.expiry.failed',
      meta: { trigger: trigger || 'unknown', error: 'run_returned_null' }
    });
    return;
  }

  if (result.skipped) {
    return;
  }

  const nulledCourses = Number(result.nulledCourses || 0);
  const mirrorFailureCount = Number(result.mirrorFailureCount || 0);
  const orphanNulled = Number(result.orphanNulledCourses || 0);
  const orphanFailures = Number(result.orphanMirrorFailureCount || 0);

  const shouldNotify =
    nulledCourses > 0 ||
    mirrorFailureCount > 0 ||
    orphanNulled > 0 ||
    orphanFailures > 0;

  if (!shouldNotify) {
    return;
  }

  emitGrokBotEvent({
    type: 'ratings.expiry',
    meta: {
      trigger: trigger || result.trigger || 'scheduled',
      rounds: result.rounds || 0,
      nulledCourses,
      nulledTees: Number(result.nulledTees || 0),
      mirrorFailureCount,
      sampleCourseIds: Array.isArray(result.sampleCourseIds) ? result.sampleCourseIds.slice(0, 20) : [],
      orphanChecked: Number(result.orphanChecked || 0),
      orphanCandidates: Number(result.orphanCandidates || 0),
      orphanNulledCourses: orphanNulled,
      orphanMirrorFailureCount: orphanFailures,
      orphanSampleCourseIds: Array.isArray(result.orphanSampleCourseIds)
        ? result.orphanSampleCourseIds.slice(0, 20)
        : []
    }
  });
}

async function runOnce(options = {}) {
  const trigger = String(options.trigger || 'scheduled');

  if (inFlight) {
    logger.debug('Skipping ratings-expiry tick; previous run still in-flight', { trigger });
    return null;
  }

  if (!courseCachePolicy.isDayTtlMode()) {
    logger.debug('Skipping ratings-expiry tick; not in day-ttl mode', {
      trigger,
      cacheMode: courseCachePolicy.getCourseCacheMode()
    });
    return { skipped: true, reason: 'not_day_ttl', trigger };
  }

  inFlight = true;
  try {
    const batchSize = Number(process.env.GHIN_RATINGS_EXPIRY_BATCH_SIZE || 500);
    const maxRounds = Number(process.env.GHIN_RATINGS_EXPIRY_MAX_ROUNDS || 50);
    const orphanLimit = Number(process.env.GHIN_RATINGS_ORPHAN_BATCH_SIZE || 500);
    const safeBatch = Number.isFinite(batchSize) ? Math.max(1, Math.floor(batchSize)) : 500;
    const safeRounds = Number.isFinite(maxRounds) ? Math.max(1, Math.floor(maxRounds)) : 50;
    const safeOrphanLimit = Number.isFinite(orphanLimit)
      ? Math.max(1, Math.min(2000, Math.floor(orphanLimit)))
      : 500;

    let rounds = 0;
    let totalNulledCourses = 0;
    let totalNulledTees = 0;
    const allMirrorFailures = [];
    const sampleCourseIds = [];

    // Loop until no expired+still-rated courses remain (or round cap).
    while (rounds < safeRounds) {
      rounds += 1;
      const summary = await purgeExpiredCacheCourses({
        limit: safeBatch,
        mirror: true,
        now: new Date()
      });

      if (summary?.skipped) {
        const skipped = { ...summary, trigger };
        logger.info('Ratings-expiry skipped', skipped);
        return skipped;
      }

      totalNulledCourses += Number(summary?.nulledCourses || 0);
      totalNulledTees += Number(summary?.nulledTees || 0);
      if (Array.isArray(summary?.mirrorFailures) && summary.mirrorFailures.length) {
        allMirrorFailures.push(...summary.mirrorFailures);
      }
      if (Array.isArray(summary?.courseIds)) {
        for (const id of summary.courseIds) {
          if (sampleCourseIds.length < 20) sampleCourseIds.push(id);
        }
      }

      if (!summary?.courseIds?.length || Number(summary?.nulledCourses || 0) === 0) {
        break;
      }
    }

    let orphan = {
      checked: 0,
      orphanCandidates: 0,
      nulledCourses: 0,
      mirrorFailures: [],
      sampleCourseIds: []
    };
    try {
      const orphanRoundsMax = Number(process.env.GHIN_RATINGS_ORPHAN_MAX_ROUNDS || 20);
      const safeOrphanRounds = Number.isFinite(orphanRoundsMax)
        ? Math.max(1, Math.floor(orphanRoundsMax))
        : 20;
      for (let orphanRound = 0; orphanRound < safeOrphanRounds; orphanRound += 1) {
        const batch = await reconcileOrphanGolfDbRatings({
          limit: safeOrphanLimit,
          now: new Date()
        });
        orphan.checked += Number(batch?.checked || 0);
        orphan.orphanCandidates += Number(batch?.orphanCandidates || 0);
        orphan.nulledCourses += Number(batch?.nulledCourses || 0);
        if (Array.isArray(batch?.mirrorFailures) && batch.mirrorFailures.length) {
          orphan.mirrorFailures.push(...batch.mirrorFailures);
        }
        if (Array.isArray(batch?.sampleCourseIds)) {
          for (const id of batch.sampleCourseIds) {
            if (orphan.sampleCourseIds.length < 20) orphan.sampleCourseIds.push(id);
          }
        }
        if (!batch?.orphanCandidates || Number(batch.orphanCandidates) === 0) {
          break;
        }
        // If we null fewer than limit, GolfDB rated set for this page is drained.
        if (Number(batch.nulledCourses || 0) < safeOrphanLimit) {
          break;
        }
      }
    } catch (orphanErr) {
      logger.error('Orphan GolfDB ratings reconcile failed', {
        trigger,
        error: orphanErr && orphanErr.message ? orphanErr.message : String(orphanErr)
      });
      orphan = {
        checked: orphan.checked || 0,
        orphanCandidates: orphan.orphanCandidates || 0,
        nulledCourses: orphan.nulledCourses || 0,
        mirrorFailures: [
          ...(orphan.mirrorFailures || []),
          {
            courseId: null,
            error: orphanErr && orphanErr.message ? orphanErr.message : String(orphanErr)
          }
        ],
        sampleCourseIds: orphan.sampleCourseIds || []
      };
    }

    const result = {
      skipped: false,
      trigger,
      rounds,
      nulledCourses: totalNulledCourses,
      nulledTees: totalNulledTees,
      mirrorFailureCount: allMirrorFailures.length,
      mirrorFailures: allMirrorFailures.slice(0, 20),
      sampleCourseIds,
      orphanChecked: Number(orphan?.checked || 0),
      orphanCandidates: Number(orphan?.orphanCandidates || 0),
      orphanNulledCourses: Number(orphan?.nulledCourses || 0),
      orphanMirrorFailureCount: Array.isArray(orphan?.mirrorFailures) ? orphan.mirrorFailures.length : 0,
      orphanSampleCourseIds: Array.isArray(orphan?.sampleCourseIds) ? orphan.sampleCourseIds.slice(0, 20) : []
    };

    logger.info('Ratings-expiry NULL completed', result);
    notifyExpiryResult(result, trigger);
    return result;
  } catch (error) {
    logger.error('Scheduled ratings-expiry NULL failed', {
      trigger,
      error: error.message
    });
    emitGrokBotEvent({
      type: 'ratings.expiry.failed',
      meta: { trigger, error: error.message }
    });
    return null;
  } finally {
    inFlight = false;
  }
}

function startRatingsExpiryScheduler() {
  const scheduleMode = String(process.env.GHIN_RATINGS_EXPIRY_SCHEDULE_MODE || 'daily-after-midnight')
    .trim()
    .toLowerCase();

  if (scheduleMode === 'disabled' || scheduleMode === 'off' || scheduleMode === 'none') {
    logger.warn('Ratings-expiry scheduler explicitly disabled (GHIN_RATINGS_EXPIRY_SCHEDULE_MODE)', {
      mode: scheduleMode
    });
    return { enabled: false, reason: 'disabled', mode: scheduleMode };
  }

  if (scheduleMode !== 'daily-after-midnight') {
    logger.error('Ratings-expiry scheduler disabled due to invalid schedule mode', {
      expected: 'daily-after-midnight',
      provided: scheduleMode
    });
    return { enabled: false, reason: 'invalid_schedule_mode', expected: 'daily-after-midnight', provided: scheduleMode };
  }

  if (!courseCachePolicy.isDayTtlMode()) {
    logger.warn('Ratings-expiry scheduler not started; GHIN_COURSE_CACHE_MODE is not day-ttl', {
      cacheMode: courseCachePolicy.getCourseCacheMode()
    });
    return { enabled: false, reason: 'not_day_ttl', cacheMode: courseCachePolicy.getCourseCacheMode() };
  }

  isRunning = true;

  const tick = async () => {
    if (!isRunning) {
      return;
    }

    await runOnce({ trigger: 'scheduled' });

    if (!isRunning) {
      return;
    }

    const nextRun = computeNextExpiryRun();
    nextRunAtMs = nextRun.utc.toMillis();
    scheduleForTarget(nextRunAtMs, tick);

    logger.info('Next ratings-expiry NULL scheduled', {
      mode: 'daily-after-midnight',
      zone: DAY_TTL_ZONE,
      nextRunAtUtc: nextRun.utc.toISO(),
      nextRunAtLocal: nextRun.local.toISO()
    });
  };

  const initialRun = computeNextExpiryRun();
  nextRunAtMs = initialRun.utc.toMillis();
  scheduleForTarget(nextRunAtMs, tick);

  // Boot catch-up: if restart/deploy missed 12:05, clear overdue expired+rated (+ orphans) now.
  setImmediate(() => {
    if (!isRunning) {
      return;
    }
    runOnce({ trigger: 'boot-catchup' }).catch((err) => {
      logger.error('Boot catch-up ratings-expiry failed', {
        error: err && err.message ? err.message : String(err)
      });
    });
  });

  logger.info('Ratings-expiry scheduler started', {
    mode: 'daily-after-midnight',
    zone: DAY_TTL_ZONE,
    nextRunAtUtc: initialRun.utc.toISO(),
    nextRunAtLocal: initialRun.local.toISO(),
    batchSize: Number(process.env.GHIN_RATINGS_EXPIRY_BATCH_SIZE || 500),
    bootCatchup: true
  });

  return {
    enabled: true,
    mode: 'daily-after-midnight',
    zone: DAY_TTL_ZONE,
    nextRunAtUtc: initialRun.utc.toISO(),
    nextRunAtLocal: initialRun.local.toISO(),
    batchSize: Number(process.env.GHIN_RATINGS_EXPIRY_BATCH_SIZE || 500),
    bootCatchup: true
  };
}

function stopRatingsExpiryScheduler() {
  isRunning = false;
  nextRunAtMs = null;
  clearTimer();
}

module.exports = {
  startRatingsExpiryScheduler,
  stopRatingsExpiryScheduler,
  runOnce,
  computeNextExpiryRun
};
