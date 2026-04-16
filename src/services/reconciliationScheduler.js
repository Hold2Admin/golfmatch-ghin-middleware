const { createLogger } = require('../utils/logger');
const { reconcileAllCandidates } = require('./courseSyncService');
const { DateTime } = require('luxon');

const logger = createLogger('reconciliationScheduler');
const MAX_TIMEOUT_MS = 2147483647;
const CENTRAL_TIMEZONE = 'America/Chicago';
const FIXED_SCHEDULE_MODE = 'first-sunday-2am-central';

let timer = null;
let inFlight = false;
let isRunning = false;
let nextRunAtMs = null;
let resumeOffset = 0;

function firstSundayAt2amCentral(year, month) {
  const firstOfMonth = DateTime.fromObject(
    { year, month, day: 1, hour: 2, minute: 0, second: 0, millisecond: 0 },
    { zone: CENTRAL_TIMEZONE }
  );

  const offsetDays = (7 - firstOfMonth.weekday) % 7; // Sunday=7 in Luxon
  return firstOfMonth.plus({ days: offsetDays });
}

function computeNextMonthlyRun(nowUtc = DateTime.utc()) {
  const nowCentral = nowUtc.setZone(CENTRAL_TIMEZONE);

  let candidate = firstSundayAt2amCentral(nowCentral.year, nowCentral.month);
  if (candidate <= nowCentral) {
    const nextMonth = nowCentral.plus({ months: 1 });
    candidate = firstSundayAt2amCentral(nextMonth.year, nextMonth.month);
  }

  return {
    utc: candidate.toUTC(),
    central: candidate
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
    logger.debug('Skipping reconciliation tick; previous run still in-flight');
    return null;
  }

  inFlight = true;
  try {
    const batchSize = Number(process.env.GHIN_RECONCILIATION_BATCH_SIZE || 100);
    const concurrency = Number(process.env.GHIN_RECONCILIATION_CONCURRENCY || 3);
    const maxWindowMinutes = Number(process.env.GHIN_RECONCILIATION_MAX_WINDOW_MINUTES || 0);
    const maxDurationMs = maxWindowMinutes > 0 ? Math.floor(maxWindowMinutes * 60 * 1000) : 0;

    const summary = await reconcileAllCandidates({
      batchSize,
      concurrency,
      startOffset: resumeOffset,
      maxDurationMs,
      runContext: 'scheduler'
    });

    resumeOffset = Number.isFinite(summary.resumeOffset) ? summary.resumeOffset : 0;

    logger.info('Scheduled reconciliation run completed', {
      mode: summary.mode,
      completed: summary.completed,
      resumeOffset: summary.resumeOffset,
      batchSize: summary.batchSize,
      concurrency,
      requested: summary.requested,
      updated: summary.updated,
      nochange: summary.nochange,
      failed: summary.failed,
      notFound: summary.notFound
    });

    return summary;
  } catch (error) {
    logger.error('Scheduled reconciliation run failed', { error: error.message });
    return null;
  } finally {
    inFlight = false;
  }
}

function startReconciliationScheduler() {
  const scheduleMode = String(process.env.GHIN_RECONCILIATION_SCHEDULE_MODE || FIXED_SCHEDULE_MODE)
    .trim()
    .toLowerCase();

  if (scheduleMode !== FIXED_SCHEDULE_MODE) {
    logger.error('Reconciliation scheduler disabled due to invalid schedule mode', {
      expected: FIXED_SCHEDULE_MODE,
      provided: scheduleMode
    });
    return { enabled: false, reason: 'invalid_schedule_mode', expected: FIXED_SCHEDULE_MODE, provided: scheduleMode };
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

    const nextRun = computeNextMonthlyRun();
    nextRunAtMs = nextRun.utc.toMillis();
    scheduleForTarget(nextRunAtMs, tick);

    logger.info('Next reconciliation run scheduled', {
      mode: FIXED_SCHEDULE_MODE,
      nextRunAtUtc: nextRun.utc.toISO(),
      nextRunAtCentral: nextRun.central.toISO()
    });
  };

  const initialRun = computeNextMonthlyRun();
  nextRunAtMs = initialRun.utc.toMillis();
  scheduleForTarget(nextRunAtMs, tick);

  logger.debug('Reconciliation scheduler started', {
    mode: FIXED_SCHEDULE_MODE,
    timezone: CENTRAL_TIMEZONE,
    nextRunAtUtc: initialRun.utc.toISO(),
    nextRunAtCentral: initialRun.central.toISO(),
    batchSize: Number(process.env.GHIN_RECONCILIATION_BATCH_SIZE || 100),
    concurrency: Number(process.env.GHIN_RECONCILIATION_CONCURRENCY || 3),
    maxWindowMinutes: Number(process.env.GHIN_RECONCILIATION_MAX_WINDOW_MINUTES || 0)
  });

  return {
    enabled: true,
    mode: FIXED_SCHEDULE_MODE,
    timezone: CENTRAL_TIMEZONE,
    nextRunAtUtc: initialRun.utc.toISO(),
    nextRunAtCentral: initialRun.central.toISO(),
    batchSize: Number(process.env.GHIN_RECONCILIATION_BATCH_SIZE || 100),
    concurrency: Number(process.env.GHIN_RECONCILIATION_CONCURRENCY || 3),
    maxWindowMinutes: Number(process.env.GHIN_RECONCILIATION_MAX_WINDOW_MINUTES || 0)
  };
}

function stopReconciliationScheduler() {
  isRunning = false;
  resumeOffset = 0;
  nextRunAtMs = null;
  clearTimer();
}

module.exports = {
  startReconciliationScheduler,
  stopReconciliationScheduler,
  runOnce
};
