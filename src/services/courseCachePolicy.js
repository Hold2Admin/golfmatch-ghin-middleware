const { DateTime } = require('luxon');

const LEGACY_TTL_DAYS = 365;
const CACHE_MODE_LEGACY = 'legacy';
const CACHE_MODE_DAY_TTL = 'day-ttl';
const SOURCE_USGA_FETCH = 'usga_fetch';
const SOURCE_WEBHOOK_REFETCH = 'webhook_refetch';
const SOURCE_LEGACY_RECON = 'legacy_recon';
const DAY_TTL_ZONE = process.env.GHIN_COURSE_DAY_TTL_ZONE || 'America/New_York';

function getCourseCacheMode() {
  const raw = String(process.env.GHIN_COURSE_CACHE_MODE || CACHE_MODE_LEGACY).trim().toLowerCase();
  if (raw === CACHE_MODE_DAY_TTL || raw === 'day_ttl' || raw === 'dayttl') {
    return CACHE_MODE_DAY_TTL;
  }
  return CACHE_MODE_LEGACY;
}

function isDayTtlMode() {
  return getCourseCacheMode() === CACHE_MODE_DAY_TTL;
}

/**
 * ExpiresAt = ratings freshness only (Course Rating / Slope).
 * Day-ttl: valid until next local midnight; then ratings must be NULLed (not kept stale)
 * and re-queried on next user need. Does not authorize deleting public catalog rows.
 * Legacy mode keeps the historical ~365d ExpiresAt window.
 */
function computeCacheExpiresAt(now = new Date(), options = {}) {
  if (options.expiry instanceof Date) {
    return options.expiry;
  }

  if (!isDayTtlMode()) {
    return new Date(now.getTime() + LEGACY_TTL_DAYS * 24 * 60 * 60 * 1000);
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

  if (!isDayTtlMode()) {
    // Preserve historical default label used by existing writers.
    return options.legacyDefault || 'USGA_WEBHOOK';
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
