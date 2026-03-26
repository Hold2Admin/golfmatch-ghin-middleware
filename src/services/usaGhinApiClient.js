// ============================================================
// USGA GPA API Client
// Handles bearer token auth and outbound request allowlist gate.
//
// Auth model: POST /users/login.json (email + password) → Bearer token
// Token lifetime: ~12 hours. Auto-refreshes on 401 or expiry.
// ============================================================

const config = require('../config');
const { createLogger } = require('../utils/logger');

const logger = createLogger('usaGhinApiClient');

function getRequestTimeoutMs() {
  const timeout = Number(process.env.GHIN_API_TIMEOUT_MS || config.ghin.timeout || 10000);
  return Number.isFinite(timeout) && timeout > 0 ? timeout : 10000;
}

async function fetchWithTimeout(url, options = {}, timeoutMs = getRequestTimeoutMs()) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal
    });
  } catch (error) {
    if (error && error.name === 'AbortError') {
      throw new Error(`USGA API timeout after ${timeoutMs}ms for ${options.method || 'GET'} ${url}`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function getApiBaseUrl() {
  return process.env.GHIN_API_BASE_URL || config.ghin.baseUrl;
}

function getSandboxEmail() {
  return process.env.GHIN_SANDBOX_EMAIL || config.ghin.sandboxEmail;
}

function getSandboxPassword() {
  return process.env.GHIN_SANDBOX_PASSWORD || config.ghin.sandboxPassword;
}

function getWebhookBaseUrl() {
  return process.env.GHIN_WEBHOOK_BASE_URL || null;
}

// ============================================================
// Outbound allowlist — only these METHOD + path patterns may
// be called against the USGA API. Blocks any accidental or
// injected calls outside the approved endpoint surface.
// ============================================================
const ALLOWLIST = [
  { method: 'POST', pattern: /^\/users\/login\.json$/ },
  { method: 'GET',  pattern: /^\/golfers\/search\.json$/ },
  { method: 'GET',  pattern: /^\/golfers\/\d+\.json$/ },
  { method: 'GET',  pattern: /^\/courses\/search\.json$/ },
  { method: 'GET',  pattern: /^\/courses\/\d+\.json$/ },
  { method: 'POST', pattern: /^\/scores\.json$/ },
  { method: 'GET',  pattern: /^\/scores\/search\.json$/ },
  { method: 'POST', pattern: /^\/golfers\/\d+\/request_golfer_product_access\.json$/ },
  { method: 'GET',  pattern: /^\/user\/webhook_settings\.json$/ },
  { method: 'PATCH',pattern: /^\/user\/webhook_settings\.json$/ },
  { method: 'DELETE',pattern: /^\/user\/webhook_settings\.json$/ },
  { method: 'GET',  pattern: /^\/user\/webhook_settings\/test\.json$/ },
  { method: 'GET',  pattern: /^\/user\/webhooks\.json$/ },
];

/**
 * Check if a METHOD + path combination is on the allowlist.
 * Query string is stripped before matching.
 */
function isAllowlisted(method, path) {
  const normalizedPath = path.split('?')[0];
  return ALLOWLIST.some(
    e => e.method === method.toUpperCase() && e.pattern.test(normalizedPath)
  );
}

// ============================================================
// Token cache
// ============================================================
let _tokenCache = null; // { token: string, expiresAt: number }
let _tokenRefreshPromise = null;

async function getToken() {
  if (_tokenCache && _tokenCache.expiresAt > Date.now() + 60_000) {
    return _tokenCache.token;
  }

  if (_tokenRefreshPromise) {
    return _tokenRefreshPromise;
  }

  return _refreshToken();
}

async function _refreshToken() {
  if (_tokenRefreshPromise) {
    return _tokenRefreshPromise;
  }

  _tokenRefreshPromise = (async () => {
  const sandboxEmail = getSandboxEmail();
  const sandboxPassword = getSandboxPassword();
  const baseUrl = getApiBaseUrl();

  if (!sandboxEmail || !sandboxPassword) {
    throw new Error('GHIN sandbox credentials are missing (GHIN_SANDBOX_EMAIL / GHIN_SANDBOX_PASSWORD).');
  }

  const url = `${baseUrl}/users/login.json`;
  const response = await fetchWithTimeout(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      user: {
        email: sandboxEmail,
        password: sandboxPassword,
        remember_me: true
      }
    })
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`USGA login failed (${response.status}): ${text}`);
  }

  const data = await response.json();
  // USGA returns the token at data.token or nested under data.user.token
  const token = data.token ?? data.user?.token;
  if (!token) throw new Error('USGA login response missing token field');

  // Cache for 11.5 hours (token lasts ~12 hours per docs)
  _tokenCache = { token, expiresAt: Date.now() + 11.5 * 60 * 60 * 1000 };
  logger.info('USGA bearer token refreshed');
  return token;
  })();

  try {
    return await _tokenRefreshPromise;
  } finally {
    _tokenRefreshPromise = null;
  }
}

// ============================================================
// Core request helper
// ============================================================
async function request(method, path, params = {}) {
  if (!isAllowlisted(method, path)) {
    logger.warn('Blocked outbound USGA request — not allowlisted', {
      method,
      path,
      env: config.env
    });
    throw Object.assign(
      new Error(`USGA API call not allowlisted: ${method} ${path}`),
      { code: 'not_allowlisted' }
    );
  }

  const token = await getToken();

  const url = new URL(`${getApiBaseUrl()}${path}`);
  if (method === 'GET') {
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== null) url.searchParams.set(k, v);
    });
  }

  const fetchOptions = {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    }
  };
  if (method !== 'GET' && Object.keys(params).length) {
    fetchOptions.body = JSON.stringify(params);
  }

  let response = await fetchWithTimeout(url.toString(), fetchOptions);

  // Retry once on 401 — token may have expired mid-session
  if (response.status === 401) {
    _tokenCache = null;
    const freshToken = await _refreshToken();
    fetchOptions.headers.Authorization = `Bearer ${freshToken}`;
    response = await fetchWithTimeout(url.toString(), fetchOptions);
  }

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`USGA API ${response.status} on ${method} ${path}: ${text}`);
  }

  return response.json();
}

/**
 * Same as request(), but allows overriding base URL for endpoints hosted
 * on GHIN app API host (webhook settings/list/test).
 */
async function requestWithBase(method, path, params = {}, baseUrlOverride = null) {
  if (!baseUrlOverride) {
    return request(method, path, params);
  }

  if (!isAllowlisted(method, path)) {
    logger.warn('Blocked outbound USGA request — not allowlisted', {
      method,
      path,
      env: config.env
    });
    throw Object.assign(
      new Error(`USGA API call not allowlisted: ${method} ${path}`),
      { code: 'not_allowlisted' }
    );
  }

  const token = await getToken();

  const url = new URL(`${baseUrlOverride}${path}`);
  if (method === 'GET') {
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== null) url.searchParams.set(k, v);
    });
  }

  const fetchOptions = {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    }
  };
  if (method !== 'GET' && Object.keys(params).length) {
    fetchOptions.body = JSON.stringify(params);
  }

  let response = await fetchWithTimeout(url.toString(), fetchOptions);

  if (response.status === 401) {
    _tokenCache = null;
    const freshToken = await _refreshToken();
    fetchOptions.headers.Authorization = `Bearer ${freshToken}`;
    response = await fetchWithTimeout(url.toString(), fetchOptions);
  }

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`USGA API ${response.status} on ${method} ${path}: ${text}`);
  }

  return response.json();
}

// ============================================================
// Golfer endpoints
// ============================================================

/**
 * Fetch a single golfer by GHIN number.
 * Returns normalized player or null if not found.
 */
async function getGolfer(ghinNumber) {
  const data = await request('GET', '/golfers/search.json', {
    page: 1,
    per_page: 1,
    golfer_id: ghinNumber,
  });
  const golfers = data.golfers ?? [];
  if (!golfers.length) return null;
  return _normalizeGolfer(golfers[0]);
}

/**
 * Search golfers by GHIN number, first name, or last name.
 * Returns array of normalized players.
 */
async function searchGolfers(params) {
  const query = { page: 1, per_page: params.perPage ?? 20 };
  if (params.ghinNumber) query.golfer_id = params.ghinNumber;
  if (params.firstName)  query.first_name = params.firstName;
  if (params.lastName)   query.last_name  = params.lastName;

  const data = await request('GET', '/golfers/search.json', query);
  return (data.golfers ?? []).map(_normalizeGolfer);
}

// ============================================================
// Course endpoints
// ============================================================

/**
 * Fetch full course by GHIN course id.
 * Returns normalized course or null if not found.
 */
async function getCourse(courseId) {
  const data = await request('GET', `/courses/${courseId}.json`);
  if (!data || !data.Facility || !Array.isArray(data.TeeSets)) return null;
  return _normalizeCourse(data, String(courseId));
}

/**
 * Search courses using USGA courses/search endpoint.
 * Returns normalized lightweight results.
 */
async function searchCourses(params) {
  const query = { page: 1, per_page: params.perPage ?? 20 };

  if (params.courseName) query.name = params.courseName;
  if (params.state) {
    query.country = params.country ?? 'USA';
    // Default to US- prefix if no country prefix present (GHIN supports CA-, MX-, etc.)
    const state = String(params.state).trim();
    query.state = state.includes('-') ? state : `US-${state}`;
    if (!query.name) query.name = '';
  }
  if (params.facilityId) query.facility_id = params.facilityId;

  const data = await request('GET', '/courses/search.json', query);
  const courses = data.courses ?? [];
  return courses.map(_normalizeCourseSearchResult);
}

// ============================================================
// Webhook endpoints
// ============================================================

async function getWebhookSettings() {
  return requestWithBase('GET', '/user/webhook_settings.json', {}, getWebhookBaseUrl());
}

async function updateWebhookSettings(payload) {
  return requestWithBase('PATCH', '/user/webhook_settings.json', payload, getWebhookBaseUrl());
}

async function deleteWebhookSettings() {
  return requestWithBase('DELETE', '/user/webhook_settings.json', {}, getWebhookBaseUrl());
}

async function testWebhook(type) {
  return requestWithBase('GET', '/user/webhook_settings/test.json', { type }, getWebhookBaseUrl());
}

async function listWebhooks(params = {}) {
  const page = params.page || 1;
  const perPage = params.perPage || 25;
  return requestWithBase('GET', '/user/webhooks.json', { page, per_page: perPage }, getWebhookBaseUrl());
}

// ============================================================
// Normalization
// ============================================================

/**
 * Convert USGA golfer shape → our NormalizedPlayer shape.
 *
 * USGA plus-handicap representation:
 *   "+1.0" or "P1.0" = golfer is better than scratch
 *   We store these as negative floats (lower HI = better player).
 */
function _normalizeGolfer(g) {
  const handicapIndex = _parseHandicapIndex(g.handicap_index ?? g.hi ?? null);
  const lowHi         = _parseHandicapIndex(g.low_hi !== undefined ? String(g.low_hi) : null);

  return {
    ghinNumber:       String(g.ghin ?? g.id ?? ''),
    firstName:        g.first_name  ?? '',
    lastName:         g.last_name   ?? '',
    email:            g.email       ?? null,
    clubName:         g.club_name   ?? null,
    clubId:           g.club_id     != null ? String(g.club_id)         : null,
    associationId:    g.association_id != null ? String(g.association_id) : null,
    handicapIndex:    handicapIndex !== null ? String(handicapIndex) : null,
    lowHandicapIndex: lowHi,
    trendIndicator:   g.hi_trend    ?? null,
    lastRevisionDate: g.revision_date ? new Date(g.revision_date).toISOString() : null,
    gender:           g.gender      ?? null,
    status:           (g.status     ?? '').toLowerCase()
  };
}

/**
 * Parse USGA handicap index string to numeric.
 * "+1.0" / "P1.0"  → -1.0  (plus handicap, better than scratch)
 * "9.4"            → 9.4
 * null/undefined   → null
 */
function _parseHandicapIndex(raw) {
  if (raw === null || raw === undefined) return null;
  const str = String(raw).trim();
  if (str.startsWith('+') || str.toUpperCase().startsWith('P')) {
    return -parseFloat(str.replace(/^[+Pp]/, ''));
  }
  return parseFloat(str);
}

function _normalizeState(raw) {
  if (raw === null || raw === undefined) return null;
  const state = String(raw).trim();
  if (!state) return null;

  if (/^[A-Za-z]{2}$/.test(state)) {
    return state.toUpperCase();
  }

  const usPrefix = state.match(/^US[-_\s]?([A-Za-z]{2})$/i);
  if (usPrefix) {
    return usPrefix[1].toUpperCase();
  }

  return state;
}

function _normalizeIso(raw) {
  if (raw === null || raw === undefined) return null;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}

function _composeCourseDisplayName(facilityName, courseName, fullName = null) {
  const facility = facilityName ? String(facilityName).trim() : '';
  const course = courseName ? String(courseName).trim() : '';
  const full = fullName ? String(fullName).trim() : '';

  if (full) {
    return full;
  }

  if (!facility) {
    return course || null;
  }

  if (!course) {
    return facility;
  }

  if (facility.localeCompare(course, undefined, { sensitivity: 'accent' }) === 0) {
    return facility;
  }

  if (course.toLowerCase().includes(facility.toLowerCase())) {
    return course;
  }

  return `${facility} - ${course}`;
}

function _normalizeCourse(data, courseId) {
  const facility = data.Facility ?? {};
  const teeSets = data.TeeSets ?? [];
  const rawCourseName = data.CourseName ?? data.Name ?? facility.CourseName ?? facility.Name ?? null;
  const facilityName = facility.FacilityName ?? facility.Name ?? data.FacilityName ?? null;
  const displayName = _composeCourseDisplayName(facilityName, rawCourseName);

  return {
    courseId,
    courseName: displayName,
    facilityName,
    displayName,
    shortCourseName: rawCourseName ?? null,
    city: data.CourseCity ?? data.City ?? facility.City ?? null,
    state: _normalizeState(data.CourseState ?? data.State ?? facility.State),
    country: data.Country ?? null,
    facilityId: facility.FacilityId != null ? String(facility.FacilityId) : null,
    lastUpdatedUtc: _normalizeIso(
      data.UpdatedOn
      ?? data.LastUpdatedUtc
      ?? data.LastUpdatedAt
      ?? data.LastModifiedUtc
      ?? data.LastModifiedAt
      ?? facility.UpdatedOn
      ?? facility.LastUpdatedUtc
      ?? facility.LastUpdatedAt
    ),
    tees: teeSets.map((tee, idx) => {
      const ratings = tee.Ratings ?? [];
      const totalRating = ratings.find(r => String(r.RatingType).toLowerCase() === 'total') || {};
      const frontRating = ratings.find(r => String(r.RatingType).toLowerCase() === 'front') || {};
      const backRating  = ratings.find(r => String(r.RatingType).toLowerCase() === 'back')  || {};

      const holes = (tee.Holes ?? []).map(h => ({
        holeNumber: h.Number,
        par: h.Par,
        handicap: h.Allocation,
        yardage: h.Length
      }));

      const f9Holes = holes.filter(h => h.holeNumber >= 1 && h.holeNumber <= 9);
      const b9Holes = holes.filter(h => h.holeNumber >= 10 && h.holeNumber <= 18);

      return {
        teeId: tee.TeeSetRatingId != null ? String(tee.TeeSetRatingId) : `TEE-${idx + 1}`,
        teeName: tee.TeeSetRatingName ?? null,
        gender: (tee.Gender || '').toUpperCase().startsWith('M') ? 'M' : 'W',
        isDefault: idx === 0,
        teeSetSide: tee.TeeSetSide ?? 'All18',
        courseRating: totalRating.CourseRating ?? null,
        slope: totalRating.SlopeRating ?? null,
        par: tee.TotalPar ?? null,
        yardage: tee.TotalYardage ?? null,
        courseRatingF9: frontRating.CourseRating ?? null,
        slopeRatingF9: frontRating.SlopeRating ?? null,
        parF9: f9Holes.length === 9 ? f9Holes.reduce((s, h) => s + (h.par || 0), 0) : null,
        yardageF9: f9Holes.length === 9 ? f9Holes.reduce((s, h) => s + (h.yardage || 0), 0) : null,
        courseRatingB9: backRating.CourseRating ?? null,
        slopeRatingB9: backRating.SlopeRating ?? null,
        parB9: b9Holes.length === 9 ? b9Holes.reduce((s, h) => s + (h.par || 0), 0) : null,
        yardageB9: b9Holes.length === 9 ? b9Holes.reduce((s, h) => s + (h.yardage || 0), 0) : null,
        holes
      };
    })
  };
}

function _normalizeCourseSearchResult(c) {
  const facilityName = c.FacilityName ?? null;
  const rawCourseName = c.CourseName ?? null;
  const displayName = _composeCourseDisplayName(facilityName, rawCourseName, c.FullName ?? null);
  return {
    courseId: c.CourseID != null ? String(c.CourseID) : null,
    courseName: displayName,
    facilityName,
    displayName,
    shortCourseName: rawCourseName ?? null,
    city: c.City ?? null,
    state: c.State ?? null,
    country: c.Country ?? null,
    facilityId: c.FacilityID != null ? String(c.FacilityID) : null,
    lastUpdatedUtc: c.UpdatedOn ? new Date(c.UpdatedOn).toISOString() : null
  };
}

module.exports = {
  getGolfer,
  searchGolfers,
  getCourse,
  searchCourses,
  getWebhookSettings,
  updateWebhookSettings,
  deleteWebhookSettings,
  testWebhook,
  listWebhooks,
  isAllowlisted
};
