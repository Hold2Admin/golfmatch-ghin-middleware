const { createLogger } = require('../utils/logger');
const ghinClient = require('./ghinClient');

const logger = createLogger('score-posting-service');

function normalizeMode(mode) {
  const normalized = String(mode || '').trim().toLowerCase();
  if (!['hbh', 'adjusted'].includes(normalized)) {
    throw Object.assign(new Error('Unsupported score posting mode'), {
      status: 400,
      code: 'INVALID_MODE'
    });
  }
  return normalized;
}

function extractScoreId(payload) {
  const scoreId = payload?.score_id
    ?? payload?.scoreId
    ?? payload?.id
    ?? payload?.score?.id
    ?? payload?.data?.score_id
    ?? payload?.data?.scoreId
    ?? payload?.data?.id
    ?? null;

  return scoreId == null ? null : String(scoreId);
}

function extractConfirmationRequired(payload) {
  return Boolean(
    payload?.confirmation_required
    ?? payload?.confirmationRequired
    ?? payload?.override_confirmation_required
    ?? payload?.requires_confirmation
    ?? payload?.requiresConfirmation
    ?? false
  );
}

function parseSeasonMonthDay(value) {
  const match = String(value || '').trim().match(/^(\d{1,2})\/(\d{1,2})$/);
  if (!match) return null;

  const month = Number(match[1]);
  const day = Number(match[2]);
  if (!Number.isInteger(month) || !Number.isInteger(day) || month < 1 || month > 12 || day < 1 || day > 31) {
    return null;
  }

  return { month, day, value: `${String(month).padStart(2, '0')}/${String(day).padStart(2, '0')}` };
}

function toMonthDayNumber(parts) {
  return (parts.month * 100) + parts.day;
}

function isPlayedAtWithinSeason(playedAt, season) {
  if (!playedAt || !season || season.isAllYear) {
    return true;
  }

  const playedDate = new Date(`${playedAt}T00:00:00Z`);
  if (Number.isNaN(playedDate.getTime())) {
    return true;
  }

  const start = parseSeasonMonthDay(season.seasonStartDate);
  const end = parseSeasonMonthDay(season.seasonEndDate);
  if (!start || !end) {
    return true;
  }

  const played = toMonthDayNumber({ month: playedDate.getUTCMonth() + 1, day: playedDate.getUTCDate() });
  const startValue = toMonthDayNumber(start);
  const endValue = toMonthDayNumber(end);

  if (startValue <= endValue) {
    return played >= startValue && played <= endValue;
  }

  return played >= startValue || played <= endValue;
}

async function validatePostingSeason(scorePayload, correlationId) {
  if (!scorePayload?.course_id || !scorePayload?.played_at) {
    return null;
  }

  const season = await ghinClient.getCoursePostingSeason(scorePayload.course_id);
  if (!season || isPlayedAtWithinSeason(scorePayload.played_at, season)) {
    return season;
  }

  const seasonWindow = season.isAllYear
    ? 'all year'
    : `${season.seasonStartDate || 'unknown'} to ${season.seasonEndDate || 'unknown'}`;

  logger.info('Score post blocked by GHIN course posting season', {
    correlationId,
    courseId: scorePayload.course_id,
    playedAt: scorePayload.played_at,
    seasonStartDate: season.seasonStartDate,
    seasonEndDate: season.seasonEndDate,
    isAllYear: season.isAllYear
  });

  throw Object.assign(
    new Error(`${season.courseName || 'This course'} accepts scores ${season.isAllYear ? 'all year' : `from ${seasonWindow}`}. Played date ${scorePayload.played_at} is outside that GHIN posting season.`),
    {
      status: 400,
      code: 'OUT_OF_POSTING_SEASON',
      responsePayload: {
        courseId: season.courseId,
        courseName: season.courseName,
        state: season.state,
        playedAt: scorePayload.played_at,
        seasonName: season.seasonName,
        seasonStartDate: season.seasonStartDate,
        seasonEndDate: season.seasonEndDate,
        isAllYear: season.isAllYear
      }
    }
  );
}

async function postScore(mode, scorePayload, correlationId) {
  const normalizedMode = normalizeMode(mode);
  await validatePostingSeason(scorePayload, correlationId);
  const providerResponse = await ghinClient.postScore(normalizedMode, scorePayload);
  const ghinScoreId = extractScoreId(providerResponse);
  const confirmationRequired = extractConfirmationRequired(providerResponse);

  logger.info('Score posted to GHIN middleware provider', {
    correlationId,
    mode: normalizedMode,
    ghinScoreId,
    confirmationRequired
  });

  return {
    success: true,
    mode: normalizedMode,
    ghinScoreId,
    confirmationRequired,
    correlationId,
    providerResponse
  };
}

async function searchScores(filters = {}, correlationId) {
  const results = await ghinClient.searchScores(filters);
  return {
    success: true,
    correlationId,
    results,
    totalResults: Array.isArray(results) ? results.length : 0
  };
}

async function getScore(scoreId, correlationId) {
  const score = await ghinClient.getScore(scoreId);
  return {
    success: true,
    correlationId,
    score
  };
}

module.exports = {
  postScore,
  searchScores,
  getScore
};