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

function tryParseJson(text) {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function buildUsgaApiError(status, method, path, responseText) {
  const parsed = tryParseJson(responseText);
  const playedAtErrors = Array.isArray(parsed?.errors?.played_at) ? parsed.errors.played_at : [];
  const outOfSeasonMessage = playedAtErrors.find((message) =>
    String(message || '').toLowerCase().includes('active score posting season')
  );

  if (outOfSeasonMessage) {
    return Object.assign(new Error(outOfSeasonMessage), {
      status,
      code: 'OUT_OF_POSTING_SEASON',
      responsePayload: parsed || responseText
    });
  }

  return Object.assign(
    new Error(`USGA API ${status} on ${method} ${path}: ${responseText}`),
    {
      status,
      code: status >= 500 ? 'USGA_API_UPSTREAM_ERROR' : 'USGA_API_REQUEST_REJECTED',
      responsePayload: parsed || responseText
    }
  );
}

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
  { method: 'GET',  pattern: /^\/Courses\/[^/]+\/TeeSetRatingsForScorePosting\.json$/ },
  { method: 'GET',  pattern: /^\/users\/accesses\.json$/ },
  { method: 'POST', pattern: /^\/scores\/hbh\.json$/ },
  { method: 'POST', pattern: /^\/scores\/adjusted\.json$/ },
  { method: 'POST', pattern: /^\/scores\.json$/ },
  { method: 'GET',  pattern: /^\/scores\/search\.json$/ },
  { method: 'GET',  pattern: /^\/scores\/[^/]+\.json$/ },
  { method: 'GET',  pattern: /^\/course_handicaps\.json$/ },
  { method: 'POST', pattern: /^\/manual_course_handicap\.json$/ },
  { method: 'POST', pattern: /^\/playing_handicaps\.json$/ },
  { method: 'POST', pattern: /^\/users\/golfers\/\d+\/request_golfer_product_access\.json$/ },
  { method: 'POST', pattern: /^\/users\/\d+\/golfers\/\d+\/update_golfer_product_access_status\.json$/ },
  { method: 'DELETE', pattern: /^\/users\/golfers\/\d+\/revoke_golfer_product_access\.json$/ },
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
let _tokenCache = null; // { token: string, userId: string|null, expiresAt: number }
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

async function getVendorUserId() {
  if (_tokenCache && _tokenCache.userId && _tokenCache.expiresAt > Date.now() + 60_000) {
    return _tokenCache.userId;
  }

  await _refreshToken();
  if (!_tokenCache?.userId) {
    throw new Error('USGA login response missing vendor user id');
  }

  return _tokenCache.userId;
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
  const userId = data.user?.id ?? data.id ?? null;
  if (!token) throw new Error('USGA login response missing token field');

  // Cache for 11.5 hours (token lasts ~12 hours per docs)
  _tokenCache = { token, userId: userId != null ? String(userId) : null, expiresAt: Date.now() + 11.5 * 60 * 60 * 1000 };
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
    throw buildUsgaApiError(response.status, method, path, text);
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
    throw buildUsgaApiError(response.status, method, path, text);
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

async function getCoursePostingSeason(courseId) {
  const data = await request('GET', `/courses/${courseId}.json`);
  if (!data) return null;
  return _normalizeCoursePostingSeason(data, String(courseId));
}

function _normalizePostingHoleCount(value) {
  const parsed = Number(value);
  return parsed === 9 ? 9 : 18;
}

function _normalizePostingGender(value) {
  const normalized = String(value || '').trim().toUpperCase();
  if (normalized === 'W' || normalized === 'F') return 'F';
  return 'M';
}

function _normalizePostingRatingType(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'front') return 'Front';
  if (normalized === 'back') return 'Back';
  return 'Total';
}

function _normalizePostingTeeSetSide(ratingType) {
  if (ratingType === 'Front') return 'F9';
  if (ratingType === 'Back') return 'B9';
  return 'All18';
}

function _normalizeCourseTeePostingRow(row) {
  const ratingType = _normalizePostingRatingType(row?.RatingType);
  return {
    teeSetRatingId: row?.TeeSetRatingId != null ? String(row.TeeSetRatingId) : null,
    teeSetStatus: row?.TeeSetStatus ?? null,
    displayName: row?.DisplayName ?? null,
    gender: _normalizePostingGender(row?.Gender),
    teeSetRatingName: row?.TeeSetRatingName ?? null,
    legacyCrpTeeId: row?.LegacyCRPTeeId != null ? String(row.LegacyCRPTeeId) : null,
    ratingType,
    teeSetSide: _normalizePostingTeeSetSide(ratingType),
    courseRating: row?.CourseRating ?? null,
    slopeRating: row?.SlopeRating ?? null,
    bogeyRating: row?.BogeyRating ?? null,
    strokeAllocation: typeof row?.StrokeAllocation === 'boolean' ? row.StrokeAllocation : null,
    totalPar: row?.TotalPar ?? null,
  };
}

async function getCourseTeePostingEligibility(courseId, options = {}) {
  const normalizedCourseId = String(courseId || '').trim();
  if (!normalizedCourseId) {
    throw new Error('courseId is required');
  }

  const data = await request(
    'GET',
    `/Courses/${encodeURIComponent(normalizedCourseId)}/TeeSetRatingsForScorePosting.json`,
    {
      gender: _normalizePostingGender(options.gender),
      number_of_holes: _normalizePostingHoleCount(options.numberOfHoles),
      tee_set_status: String(options.teeSetStatus || 'Active').trim() || 'Active'
    }
  );

  return Array.isArray(data) ? data.map(_normalizeCourseTeePostingRow) : [];
}

/**
 * Search courses using USGA courses/search endpoint.
 * Returns normalized lightweight results.
 */
async function searchCourses(params) {
  const query = {
    page: params.page ?? 1,
    per_page: params.perPage ?? 20
  };

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
// Golfer product access endpoints
// ============================================================

async function requestGolferProductAccess(ghinNumber, email) {
  const golferId = String(ghinNumber || '').trim();
  if (!golferId) {
    throw new Error('GHIN number is required');
  }
  if (!email || !String(email).trim()) {
    throw new Error('Golfer email is required');
  }

  return request(
    'POST',
    `/users/golfers/${encodeURIComponent(golferId)}/request_golfer_product_access.json`,
    { email: String(email).trim() }
  );
}

async function updateGolferProductAccessStatus(ghinNumber, status) {
  const golferId = String(ghinNumber || '').trim();
  const nextStatus = String(status || '').trim().toLowerCase();
  if (!golferId) {
    throw new Error('GHIN number is required');
  }
  if (!['pending', 'approved', 'inactive'].includes(nextStatus)) {
    throw new Error('Invalid golfer product access status');
  }

  const vendorUserId = await getVendorUserId();
  return request(
    'POST',
    `/users/${encodeURIComponent(vendorUserId)}/golfers/${encodeURIComponent(golferId)}/update_golfer_product_access_status.json?gpa_status=${encodeURIComponent(nextStatus)}`,
    {}
  );
}

async function revokeGolferProductAccess(ghinNumber) {
  const golferId = String(ghinNumber || '').trim();
  if (!golferId) {
    throw new Error('GHIN number is required');
  }

  return request(
    'DELETE',
    `/users/golfers/${encodeURIComponent(golferId)}/revoke_golfer_product_access.json`,
    {}
  );
}

async function getGolferProductAccessStatus(ghinNumber) {
  const golferId = String(ghinNumber || '').trim();
  if (!golferId) {
    throw new Error('GHIN number is required');
  }

  const data = await request('GET', '/users/accesses.json', {
    golfer_id: golferId,
    page: 1,
    per_page: 25
  });

  const golfers = Array.isArray(data?.golfers) ? data.golfers : [];
  const matched = golfers.find((entry) => String(entry?.golfer?.id || '') === golferId) || golfers[0] || null;
  const rawStatus = String(matched?.user_access?.gpa_status || '').trim().toLowerCase();
  const normalizedStatus = ['pending', 'approved', 'inactive'].includes(rawStatus)
    ? rawStatus
    : 'inactive';

  return {
    ghinNumber: golferId,
    status: normalizedStatus,
    userAccessId: matched?.user_access?.id ? String(matched.user_access.id) : null,
    golferName: matched?.user_access?.golfer_name || null,
    hasAccess: Boolean(matched)
  };
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

async function postScore(mode, payload) {
  const normalizedMode = String(mode || '').trim().toLowerCase();
  if (!['hbh', 'adjusted'].includes(normalizedMode)) {
    throw new Error('Unsupported GHIN score posting mode');
  }

  const endpoint = normalizedMode === 'adjusted'
    ? '/scores/adjusted.json'
    : '/scores/hbh.json';

  return request('POST', endpoint, payload);
}

async function searchScores(params = {}) {
  const query = {
    page: params.page ?? 1,
    per_page: params.per_page ?? params.perPage ?? 25
  };

  if (params.golfer_id) query.golfer_id = params.golfer_id;
  if (params.played_at_from) query.played_at_from = params.played_at_from;
  if (params.played_at_to) query.played_at_to = params.played_at_to;
  if (params.mode) query.mode = params.mode;

  return request('GET', '/scores/search.json', query);
}

async function getScore(scoreId) {
  const normalizedScoreId = String(scoreId || '').trim();
  if (!normalizedScoreId) {
    throw new Error('scoreId is required');
  }

  return request('GET', `/scores/${encodeURIComponent(normalizedScoreId)}.json`);
}

function _normalizeSupportingTeeSetSide(value) {
  const normalized = String(value || '').trim().toUpperCase().replace(/\s+/g, '');
  if (normalized === 'F9') return 'F9';
  if (normalized === 'B9') return 'B9';
  return 'All18';
}

function _normalizeSupportingPlayingTeeSetSide(value) {
  const normalized = _normalizeSupportingTeeSetSide(value);
  return normalized === 'All18' ? 'All 18' : normalized;
}

function _normalizeCourseHandicapTeeSet(row) {
  return {
    teeSetId: row?.tee_set_id != null ? String(row.tee_set_id) : null,
    name: row?.name ?? null,
    gender: row?.gender ?? null,
    ratings: Array.isArray(row?.ratings)
      ? row.ratings.map((rating) => ({
          teeSetSide: _normalizeSupportingTeeSetSide(rating?.tee_set_side),
          courseRating: Number.isFinite(Number(rating?.course_rating)) ? Number(rating.course_rating) : null,
          slopeRating: Number.isFinite(Number(rating?.slope_rating)) ? Number(rating.slope_rating) : null,
          courseHandicap: Number.isFinite(Number(rating?.course_handicap)) ? Number(rating.course_handicap) : null,
          courseHandicapDisplay: rating?.course_handicap_display != null ? String(rating.course_handicap_display) : null,
          par: Number.isFinite(Number(rating?.par)) ? Number(rating.par) : null,
        }))
      : []
  };
}

async function getCourseHandicaps(params = {}) {
  const courseId = String(params.courseId || '').trim();
  const golferId = params.golferId != null ? String(params.golferId).trim() : '';
  const handicapIndex = params.handicapIndex != null ? String(params.handicapIndex).trim() : '';

  if (!courseId) {
    throw new Error('courseId is required');
  }
  if (!golferId && !handicapIndex) {
    throw new Error('golferId or handicapIndex is required');
  }

  const data = await request('GET', '/course_handicaps.json', {
    course_id: courseId,
    golfer_id: golferId || undefined,
    handicap_index: handicapIndex || undefined,
    played_at: params.playedAt || undefined,
  });

  return Array.isArray(data?.tee_sets)
    ? data.tee_sets.map(_normalizeCourseHandicapTeeSet)
    : [];
}

function _normalizeManualCourseHandicapResponse(data) {
  const course = data?.manual_course_handicap ?? null;
  const playing = data?.manual_playing_handicap ?? null;

  return {
    courseHandicap: Number.isFinite(Number(course?.course_handicap)) ? Number(course.course_handicap) : null,
    courseHandicapDisplay: course?.course_handicap_display != null ? String(course.course_handicap_display) : null,
    playingHandicap: Number.isFinite(Number(playing?.playing_handicap)) ? Number(playing.playing_handicap) : null,
    playingHandicapDisplay: playing?.playing_handicap_display != null ? String(playing.playing_handicap_display) : null,
  };
}

async function getManualCourseHandicap(params = {}) {
  const golferId = params.golferId != null ? String(params.golferId).trim() : '';
  const handicapIndex = params.handicapIndex != null ? String(params.handicapIndex).trim() : '';
  const courseRating = params.courseRating != null ? String(params.courseRating).trim() : '';
  const slopeRating = params.slopeRating != null ? String(params.slopeRating).trim() : '';
  const par = params.par != null ? String(params.par).trim() : '';
  const numberOfHoles = params.numberOfHoles != null ? String(params.numberOfHoles).trim() : '';

  if (!golferId && !handicapIndex) {
    throw new Error('golferId or handicapIndex is required');
  }
  if (!courseRating || !slopeRating || !par) {
    throw new Error('courseRating, slopeRating, and par are required');
  }

  const data = await request('POST', '/manual_course_handicap.json', {
    golfer_id: golferId || undefined,
    handicap_index: handicapIndex || undefined,
    course_rating: courseRating,
    slope_rating: slopeRating,
    par,
    number_of_holes: numberOfHoles || undefined,
    handicap_allowance: params.handicapAllowance != null ? String(params.handicapAllowance).trim() : undefined,
  });

  return _normalizeManualCourseHandicapResponse(data);
}

function _normalizePlayingHandicapAllowanceRow(allowanceKey, allowanceData, requestGolfers = []) {
  const normalizedAllowance = Number(allowanceKey);
  const golferEntries = requestGolfers.map((golfer, index) => {
    const expectedKey = golfer?.golfer_id != null
      ? String(golfer.golfer_id)
      : `manual_golfer_${index + 1}`;
    const row = allowanceData?.[expectedKey] || null;
    return {
      key: expectedKey,
      golferId: golfer?.golfer_id != null ? String(golfer.golfer_id) : null,
      handicapIndex: golfer?.handicap_index != null ? String(golfer.handicap_index) : null,
      teeSetId: golfer?.tee_set_id != null ? String(golfer.tee_set_id) : null,
      teeSetSide: _normalizeSupportingTeeSetSide(golfer?.tee_set_side),
      playingHandicap: Number.isFinite(Number(row?.playing_handicap)) ? Number(row.playing_handicap) : null,
      playingHandicapDisplay: row?.playing_handicap_display != null ? String(row.playing_handicap_display) : null,
      shotsOff: row?.shots_off != null ? String(row.shots_off) : null,
    };
  });

  return {
    allowance: Number.isFinite(normalizedAllowance) ? normalizedAllowance : allowanceKey,
    golfers: golferEntries,
  };
}

async function getPlayingHandicaps(golfers = []) {
  if (!Array.isArray(golfers) || golfers.length === 0) {
    throw new Error('At least one golfer payload is required');
  }

  const payloadGolfers = golfers.map((golfer) => {
    const normalized = {
      tee_set_id: golfer?.teeSetId != null ? String(golfer.teeSetId).trim() : golfer?.tee_set_id != null ? String(golfer.tee_set_id).trim() : null,
      tee_set_side: _normalizeSupportingPlayingTeeSetSide(golfer?.teeSetSide ?? golfer?.tee_set_side),
    };

    if (!normalized.tee_set_id) {
      throw new Error('Each golfer must include teeSetId');
    }

    if (golfer?.golferId != null || golfer?.golfer_id != null) {
      normalized.golfer_id = String(golfer.golferId ?? golfer.golfer_id).trim();
    } else if (golfer?.handicapIndex != null || golfer?.handicap_index != null) {
      normalized.handicap_index = String(golfer.handicapIndex ?? golfer.handicap_index).trim();
    } else {
      throw new Error('Each golfer must include golferId or handicapIndex');
    }

    return normalized;
  });

  const data = await request('POST', '/playing_handicaps.json', {
    golfers: payloadGolfers
  });

  return Object.entries(data || {})
    .filter(([key]) => /^\d+$/.test(String(key)))
    .sort((a, b) => Number(a[0]) - Number(b[0]))
    .map(([allowanceKey, allowanceData]) => _normalizePlayingHandicapAllowanceRow(allowanceKey, allowanceData, payloadGolfers));
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
  const hiModified = Boolean(g.hi_modified);
  const hiWithdrawn = Boolean(g.hi_withdrawn);
  const hiValue = g.hi_value ?? null;
  const handicapIndexDisplay = _normalizeHandicapDisplay(
    g.hi_display ?? g.handicap_index ?? g.hi ?? null,
    { hiModified, hiWithdrawn, hiValue }
  );
  const handicapIndex = _parseHandicapIndex(g.handicap_index ?? g.hi_display ?? g.hi ?? null);
  const lowHi = _parseHandicapIndex(g.low_hi !== undefined ? String(g.low_hi) : null);
  const status = _normalizeGolferStatus(g.status, {
    hiModified,
    hiWithdrawn,
    hiValue,
    handicapIndexDisplay
  });

  return {
    ghinNumber:       String(g.ghin ?? g.id ?? ''),
    firstName:        g.first_name  ?? '',
    lastName:         g.last_name   ?? '',
    email:            g.email       ?? null,
    clubName:         g.club_name   ?? null,
    clubId:           g.club_id     != null ? String(g.club_id)         : null,
    associationId:    g.association_id != null ? String(g.association_id) : null,
    handicapIndex:    handicapIndex !== null ? String(handicapIndex) : null,
    handicapIndexDisplay,
    handicapFlags: {
      modified: hiModified,
      withdrawn: hiWithdrawn,
      noHandicap: handicapIndexDisplay === 'NH'
    },
    lowHandicapIndex: lowHi,
    trendIndicator:   g.hi_trend    ?? null,
    lastRevisionDate: g.revision_date ? new Date(g.revision_date).toISOString() : null,
    gender:           g.gender      ?? null,
    status,
    membershipStatus: (g.status ?? '').trim().toLowerCase() || null
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
  if (!str) return null;

  const upper = str.toUpperCase();
  if (upper === 'NH' || upper === 'WD') {
    return null;
  }

  const normalized = upper.endsWith('M') ? str.slice(0, -1).trim() : str;
  if (normalized.startsWith('+') || normalized.toUpperCase().startsWith('P')) {
    const plusValue = parseFloat(normalized.replace(/^[+Pp]/, ''));
    return Number.isFinite(plusValue) ? -plusValue : null;
  }

  const parsed = parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function _normalizeHandicapDisplay(raw, { hiModified = false, hiWithdrawn = false, hiValue = null } = {}) {
  if (hiWithdrawn) {
    return 'WD';
  }

  const value = String(raw ?? '').trim();
  const upper = value.toUpperCase();
  if (!value) {
    if (hiValue === 999) return 'NH';
    return null;
  }

  if (upper === 'NH' || hiValue === 999) {
    return 'NH';
  }

  if (upper === 'WD') {
    return 'WD';
  }

  if (hiModified && !upper.endsWith('M')) {
    return `${value}M`;
  }

  return value;
}

function _normalizeGolferStatus(status, { hiModified = false, hiWithdrawn = false, hiValue = null, handicapIndexDisplay = null } = {}) {
  const normalizedStatus = String(status ?? '').trim().toLowerCase();
  const normalizedDisplay = String(handicapIndexDisplay ?? '').trim().toUpperCase();

  if (hiWithdrawn || normalizedDisplay === 'WD') {
    return 'withdrawn';
  }

  if (normalizedDisplay === 'NH' || hiValue === 999) {
    return 'no-handicap';
  }

  if (hiModified || normalizedDisplay.endsWith('M')) {
    return 'modified';
  }

  if (normalizedStatus) {
    return normalizedStatus;
  }

  return 'unknown';
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

function _normalizeCoursePostingSeason(data, courseId) {
  const facility = data.Facility ?? {};
  const season = data.Season ?? {};
  const rawCourseName = data.CourseName ?? data.Name ?? facility.CourseName ?? facility.Name ?? null;
  const facilityName = facility.FacilityName ?? facility.Name ?? data.FacilityName ?? null;

  return {
    courseId: String(courseId),
    courseName: _composeCourseDisplayName(facilityName, rawCourseName),
    facilityName,
    state: _normalizeState(data.CourseState ?? data.State ?? facility.State),
    seasonName: season.SeasonName ?? null,
    seasonStartDate: season.SeasonStartDate ?? null,
    seasonEndDate: season.SeasonEndDate ?? null,
    isAllYear: Boolean(season.IsAllYear)
  };
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
  getCoursePostingSeason,
  getCourseTeePostingEligibility,
  searchCourses,
  postScore,
  searchScores,
  getScore,
  getCourseHandicaps,
  getManualCourseHandicap,
  getPlayingHandicaps,
  requestGolferProductAccess,
  getGolferProductAccessStatus,
  updateGolferProductAccessStatus,
  revokeGolferProductAccess,
  getWebhookSettings,
  updateWebhookSettings,
  deleteWebhookSettings,
  testWebhook,
  listWebhooks,
  isAllowlisted
};
