const { DateTime } = require('luxon');

const CACHE_MODE_DAY_TTL = 'day-ttl';
// Kept as exported constants for callers/tests; production ratings expiry is day-ttl only.
const CACHE_MODE_LEGACY = 'legacy';
const LEGACY_TTL_DAYS = 365;
const SOURCE_USGA_FETCH = 'usga_fetch';
const SOURCE_WEBHOOK_REFETCH = 'webhook_refetch';
const SOURCE_LEGACY_RECON = 'legacy_recon';
const DAY_TTL_ZONE = process.env.GHIN_COURSE_DAY_TTL_ZONE || 'America/New_York';

/**
 * Ratings cache mode is locked to day-ttl so local cannot diverge from prod.
 * GHIN_COURSE_CACHE_MODE is ignored for behavior (legacy/unset/anything else still day-ttl).
 */
function getCourseCacheMode() {
  return CACHE_MODE_DAY_TTL;
}

function isDayTtlMode() {
  return true;
}

/**
 * ExpiresAt = ratings freshness only (Course Rating / Slope).
 * Always valid until next local midnight in DAY_TTL_ZONE; then ratings must be NULLed
 * (not kept stale) and re-queried on next user need. Does not authorize deleting public catalog rows.
 */
function computeCacheExpiresAt(now = new Date(), options = {}) {
  if (options.expiry instanceof Date) {
    return options.expiry;
  }

  const zone = options.zone || DAY_TTL_ZONE;
  const local = DateTime.fromJSDate(now instanceof Date ? now : new Date(now), { zone });
  const nextMidnight = local.plus({ days: 1 }).startOf('day');
  return nextMidnight.toUTC().toJSDate();
}

function resolveCacheSource(explicitSource, options = {}) {
  if (explicitSource) {
    return String(explicitSource);
  }

  if (options.fromWebhook) {
    return SOURCE_WEBHOOK_REFETCH;
  }
  if (options.fromRecon) {
    return SOURCE_LEGACY_RECON;
  }
  return SOURCE_USGA_FETCH;
}

function isCacheFresh(row, now = new Date()) {
  if (!row) {
    return false;
  }

  const expiresAt = row.expiresAt || row.ExpiresAt;
  if (expiresAt) {
    const expMs = new Date(expiresAt).getTime();
    if (Number.isFinite(expMs) && expMs <= now.getTime()) {
      return false;
    }
  }

  const invalidatedAt = row.invalidatedAt || row.InvalidatedAt;
  if (invalidatedAt) {
    const invMs = new Date(invalidatedAt).getTime();
    if (Number.isFinite(invMs) && invMs > 0) {
      return false;
    }
  }

  return true;
}

module.exports = {
  LEGACY_TTL_DAYS,
  CACHE_MODE_LEGACY,
  CACHE_MODE_DAY_TTL,
  SOURCE_USGA_FETCH,
  SOURCE_WEBHOOK_REFETCH,
  SOURCE_LEGACY_RECON,
  DAY_TTL_ZONE,
  getCourseCacheMode,
  isDayTtlMode,
  computeCacheExpiresAt,
  resolveCacheSource,
  isCacheFresh
};
