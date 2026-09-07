const { createLogger } = require('../utils/logger');
const { purgeExpiredCacheCourses } = require('./courseSyncService');
const courseCachePolicy = require('./courseCachePolicy');
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

async function runOnce() {
  if (inFlight) {
    logger.debug('Skipping ratings-expiry tick; previous run still in-flight');
    return null;
  }

  if (!courseCachePolicy.isDayTtlMode()) {
    logger.debug('Skipping ratings-expiry tick; not in day-ttl mode', {
      cacheMode: courseCachePolicy.getCourseCacheMode()
    });
    return { skipped: true, reason: 'not_day_ttl' };
  }

  inFlight = true;
  try {
    const batchSize = Number(process.env.GHIN_RATINGS_EXPIRY_BATCH_SIZE || 500);
    const maxRounds = Number(process.env.GHIN_RATINGS_EXPIRY_MAX_ROUNDS || 50);
    const safeBatch = Number.isFinite(batchSize) ? Math.max(1, Math.floor(batchSize)) : 500;
    const safeRounds = Number.isFinite(maxRounds) ? Math.max(1, Math.floor(maxRounds)) : 50;

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
        return summary;
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

    const result = {
      skipped: false,
      rounds,
      nulledCourses: totalNulledCourses,
      nulledTees: totalNulledTees,
      mirrorFailureCount: allMirrorFailures.length,
      mirrorFailures: allMirrorFailures.slice(0, 20),
      sampleCourseIds
    };

    logger.info('Scheduled ratings-expiry NULL completed', result);
    return result;
  } catch (error) {
    logger.error('Scheduled ratings-expiry NULL failed', { error: error.message });
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

    await runOnce();

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

  logger.info('Ratings-expiry scheduler started', {
    mode: 'daily-after-midnight',
    zone: DAY_TTL_ZONE,
    nextRunAtUtc: initialRun.utc.toISO(),
    nextRunAtLocal: initialRun.local.toISO(),
    batchSize: Number(process.env.GHIN_RATINGS_EXPIRY_BATCH_SIZE || 500)
  });

  return {
    enabled: true,
    mode: 'daily-after-midnight',
    zone: DAY_TTL_ZONE,
    nextRunAtUtc: initialRun.utc.toISO(),
    nextRunAtLocal: initialRun.local.toISO(),
    batchSize: Number(process.env.GHIN_RATINGS_EXPIRY_BATCH_SIZE || 500)
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
