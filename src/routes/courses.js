// ============================================================
// Course Endpoints
// ============================================================

const express = require('express');
const router = express.Router();
const { param, body, query, validationResult } = require('express-validator');
const { createLogger } = require('../utils/logger');
const ghinClient = require('../services/ghinClient');
const { transformGhinCourse, transformGhinTee, transformGhinHole } = require('../services/transformers/courseTransformer');

const logger = createLogger('courses');

function parseSeasonMonthDay(value) {
  const match = String(value || '').trim().match(/^(\d{1,2})\/(\d{1,2})$/);
  if (!match) return null;

  const month = Number(match[1]);
  const day = Number(match[2]);
  if (!Number.isInteger(month) || !Number.isInteger(day) || month < 1 || month > 12 || day < 1 || day > 31) {
    return null;
  }

  return { month, day };
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
    return null;
  }

  const start = parseSeasonMonthDay(season.seasonStartDate);
  const end = parseSeasonMonthDay(season.seasonEndDate);
  if (!start || !end) {
    return null;
  }

  const played = toMonthDayNumber({ month: playedDate.getUTCMonth() + 1, day: playedDate.getUTCDate() });
  const startValue = toMonthDayNumber(start);
  const endValue = toMonthDayNumber(end);

  if (startValue <= endValue) {
    return played >= startValue && played <= endValue;
  }

  return played >= startValue || played <= endValue;
}

function isFuturePlayedAt(playedAt) {
  if (!playedAt) return null;

  const playedDate = new Date(`${playedAt}T00:00:00Z`);
  if (Number.isNaN(playedDate.getTime())) {
    return null;
  }

  const today = new Date();
  const todayUtc = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  return playedDate.getTime() > todayUtc.getTime();
}

function normalizePostingHoleCount(value) {
  return Number(value) === 9 ? 9 : 18;
}

function normalizePostingGender(value) {
  const normalized = String(value || '').trim().toUpperCase();
  if (normalized === 'W' || normalized === 'F') return 'F';
  return 'M';
}

function normalizePostingSide(value, numberOfHoles) {
  const normalized = String(value || '').trim().toUpperCase();
  if (numberOfHoles === 9) {
    return normalized === 'B9' ? 'B9' : 'F9';
  }
  return 'All18';
}

function summarizePostingRows(rows) {
  return rows.map((row) => ({
    teeSetRatingId: row.teeSetRatingId,
    legacyCrpTeeId: row.legacyCrpTeeId,
    displayName: row.displayName,
    teeSetRatingName: row.teeSetRatingName,
    teeSetSide: row.teeSetSide,
    ratingType: row.ratingType,
    gender: row.gender,
  }));
}

function resolvePostingTeeMatch(rows, requestedTeeSetId) {
  const normalizedRequestedId = String(requestedTeeSetId || '').trim();
  if (!normalizedRequestedId) {
    return { match: null, matchedBy: null };
  }

  const matchedByTeeSetRatingId = rows.find((row) => row.teeSetRatingId === normalizedRequestedId);
  if (matchedByTeeSetRatingId) {
    return { match: matchedByTeeSetRatingId, matchedBy: 'tee_set_rating_id' };
  }

  return { match: null, matchedBy: null };
}

/**
 * GET /api/v1/courses/:ghinCourseId
 * Fetch complete course data including all tees and holes
 */
router.get(
  '/:ghinCourseId/posting-season',
  [
    param('ghinCourseId').isString().trim().isLength({ min: 1, max: 100 }).withMessage('Invalid GHIN course ID')
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        error: {
          code: 'INVALID_REQUEST',
          message: 'Invalid course ID format',
          details: errors.array()
        }
      });
    }

    const { ghinCourseId } = req.params;
    const playedAt = typeof req.query.played_at === 'string' ? req.query.played_at.trim() : null;

    try {
      const season = await ghinClient.getCoursePostingSeason(ghinCourseId);
      if (!season) {
        return res.status(404).json({
          error: {
            code: 'GHIN_COURSE_NOT_FOUND',
            message: `Course with ID ${ghinCourseId} not found`,
            retryable: false
          }
        });
      }

      return res.json({
        success: true,
        courseId: season.courseId,
        courseName: season.courseName,
        facilityName: season.facilityName,
        state: season.state,
        seasonName: season.seasonName,
        seasonStartDate: season.seasonStartDate,
        seasonEndDate: season.seasonEndDate,
        isAllYear: season.isAllYear,
        playedAt,
        isFuturePlayedAt: isFuturePlayedAt(playedAt),
        isPlayableOnDate: isPlayedAtWithinSeason(playedAt, season)
      });
    } catch (error) {
      logger.error('Error fetching course posting season', { ghinCourseId, error: error.message, playedAt });
      return res.status(error.status || 502).json({
        error: {
          code: error.code || 'GHIN_API_ERROR',
          message: error.message || 'Failed to fetch course posting season',
          retryable: (error.status || 500) >= 500
        }
      });
    }
  }
);

router.get(
  '/:ghinCourseId/tee-posting-eligibility',
  [
    param('ghinCourseId').isString().trim().isLength({ min: 1, max: 100 }).withMessage('Invalid GHIN course ID'),
    query('tee_set_id').optional().isString().trim().isLength({ min: 1, max: 100 }).withMessage('Invalid tee_set_id'),
    query('gender').optional().isString().trim().isLength({ min: 1, max: 10 }).withMessage('Invalid gender'),
    query('number_of_holes').optional().isInt({ min: 9, max: 18 }).withMessage('Invalid number_of_holes'),
    query('tee_set_side').optional().isString().trim().isLength({ min: 1, max: 10 }).withMessage('Invalid tee_set_side')
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        error: {
          code: 'INVALID_REQUEST',
          message: 'Invalid tee posting eligibility request',
          details: errors.array()
        }
      });
    }

    const { ghinCourseId } = req.params;
    const requestedTeeSetId = String(req.query.tee_set_id || '').trim() || null;
    const numberOfHoles = normalizePostingHoleCount(req.query.number_of_holes);
    const teeSetSide = normalizePostingSide(req.query.tee_set_side, numberOfHoles);
    const gender = normalizePostingGender(req.query.gender);

    try {
      const eligibleRows = await ghinClient.getCourseTeePostingEligibility(ghinCourseId, {
        teeSetId: requestedTeeSetId,
        gender,
        numberOfHoles,
        teeSetStatus: 'Active'
      });
      const scopedRows = eligibleRows.filter((row) => row.teeSetSide === teeSetSide);
      const { match, matchedBy } = resolvePostingTeeMatch(scopedRows, requestedTeeSetId);

      return res.json({
        success: true,
        courseId: String(ghinCourseId),
        requestedTeeSetId,
        gender,
        numberOfHoles,
        teeSetSide,
        isEligible: Boolean(match),
        matchedBy,
        matchedTeeSetId: match?.teeSetRatingId || null,
        matchedLegacyCrpTeeId: match?.legacyCrpTeeId || null,
        matchedDisplayName: match?.displayName || null,
        matchedRatingType: match?.ratingType || null,
        eligibleTeeSets: summarizePostingRows(scopedRows)
      });
    } catch (error) {
      logger.error('Error fetching tee posting eligibility', {
        ghinCourseId,
        requestedTeeSetId,
        gender,
        numberOfHoles,
        teeSetSide,
        error: error.message
      });
      return res.status(error.status || 502).json({
        error: {
          code: error.code || 'GHIN_API_ERROR',
          message: error.message || 'Failed to fetch tee posting eligibility',
          retryable: (error.status || 500) >= 500
        }
      });
    }
  }
);

router.get(
  '/:ghinCourseId',
  [
    param('ghinCourseId')
      .isString()
      .trim()
      .isLength({ min: 1, max: 100 })
      .withMessage('Invalid GHIN course ID')
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        error: {
          code: 'INVALID_REQUEST',
          message: 'Invalid course ID format',
          details: errors.array()
        }
      });
    }

    const { ghinCourseId } = req.params;

    try {
      logger.info(`Fetching course ${ghinCourseId}`);

      // TODO: Check cache first
      
      // Fetch from GHIN API (currently mock)
      const ghinCourse = await ghinClient.getCourse(ghinCourseId);
      
      if (!ghinCourse) {
        return res.status(404).json({
          error: {
            code: 'GHIN_COURSE_NOT_FOUND',
            message: `Course with ID ${ghinCourseId} not found`,
            retryable: false
          }
        });
      }

      // Transform to normalized format
      const normalizedCourse = transformGhinCourse(ghinCourse);

      // TODO: Cache the result

      res.json(normalizedCourse);
    } catch (error) {
      logger.error('Error fetching course', { ghinCourseId, error: error.message });
      res.status(502).json({
        error: {
          code: 'GHIN_API_ERROR',
          message: 'Failed to fetch course from GHIN API',
          retryable: true
        }
      });
    }
  }
);

/**
 * POST /api/v1/courses/search
 * Search for courses by name, city, or state
 */
router.post(
  '/search',
  [
    body('courseName').optional().isString().trim().isLength({ min: 1, max: 200 }),
    body('city').optional().isString().trim().isLength({ min: 1, max: 100 }),
    body('state').optional().isString().trim().isLength({ min: 2, max: 50 }),
    body('country').optional().isString().trim().isLength({ min: 2, max: 50 })
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        error: {
          code: 'INVALID_REQUEST',
          message: 'Invalid search parameters',
          details: errors.array()
        }
      });
    }

    const { courseName, city, state, country } = req.body;

    // Require at least one search parameter
    if (!courseName && !city && !state && !country) {
      return res.status(400).json({
        error: {
          code: 'INVALID_REQUEST',
          message: 'Must provide at least one search parameter'
        }
      });
    }

    try {
      logger.info('Searching for courses', { courseName, city, state });

      // TODO: Check cache first
      
      // Search GHIN API (currently mock)
      const results = await ghinClient.searchCourses({
        courseName,
        city,
        state,
        country
      });

      res.json({
        results,
        totalResults: results.length
      });
    } catch (error) {
      logger.error('Course search error', { error: error.message });
      res.status(502).json({
        error: {
          code: 'GHIN_API_ERROR',
          message: 'Course search failed',
          retryable: true
        }
      });
    }
  }
);

/**
 * POST /api/v1/courses/import
 * Import a GHIN course into Fore Play database
 */
router.post(
  '/import',
  [
    body('ghinCourseId').isString().trim().notEmpty(),
    body('selectTees').isArray({ min: 1 }),
    body('selectTees.*.ghinTeeId').isString().trim().notEmpty(),
    body('selectTees.*.gender').isIn(['M', 'W']),
    body('callbackUrl').isURL()
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        error: {
          code: 'INVALID_REQUEST',
          message: 'Invalid import request',
          details: errors.array()
        }
      });
    }

    const { ghinCourseId, selectTees, callbackUrl } = req.body;

    try {
      logger.info(`Importing course ${ghinCourseId}`, { selectTees });

      // TODO: Create import job in database
      // TODO: Fetch course from GHIN
      // TODO: Transform data
      // TODO: POST to callbackUrl
      // TODO: Store mapping

      // For now, return mock response
      const jobId = require('crypto').randomUUID();

      res.status(202).json({
        importJobId: jobId,
        status: 'processing',
        estimatedCompletionSeconds: 5
      });
    } catch (error) {
      logger.error('Course import error', { error: error.message });
      res.status(500).json({
        error: {
          code: 'IMPORT_FAILED',
          message: 'Failed to import course',
          retryable: true
        }
      });
    }
  }
);

/**
 * GET /api/v1/courses/state/:state
 * Lightweight listing of courses by state (preview format)
 */
router.get(
  '/state/:state',
  [
    param('state').isString().trim().isLength({ min: 2, max: 50 }).withMessage('Invalid state')
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        error: { code: 'INVALID_REQUEST', message: 'Invalid state', details: errors.array() }
      });
    }
    const { state } = req.params;
    try {
      logger.info('Listing courses by state', { state });
      const results = await ghinClient.searchCourses({ state });
      res.json({ results, totalResults: results.length });
    } catch (error) {
      logger.error('State course list error', { error: error.message });
      res.status(502).json({
        error: { code: 'GHIN_API_ERROR', message: 'Failed to list courses', retryable: true }
      });
    }
  }
);

/**
 * GET /api/v1/courses/:ghinCourseId/tees
 * Return normalized tees for a course
 */
router.get(
  '/:ghinCourseId/tees',
  [
    param('ghinCourseId').isString().trim().isLength({ min: 1, max: 100 })
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        error: { code: 'INVALID_REQUEST', message: 'Invalid course ID', details: errors.array() }
      });
    }
    const { ghinCourseId } = req.params;
    try {
      const ghinCourse = await ghinClient.getCourse(ghinCourseId);
      if (!ghinCourse) {
        return res.status(404).json({
          error: { code: 'GHIN_COURSE_NOT_FOUND', message: `Course ${ghinCourseId} not found` }
        });
      }
      const tees = (ghinCourse.tees || []).map(transformGhinTee).map((t) => ({
        ghinTeeId: t.ghinTeeId,
        teeName: t.teeName,
        gender: t.gender,
        courseRating: t.courseRating,
        slope: t.slope,
        par: t.par,
        yardage: t.yardage || null,
        isDefault: Boolean(ghinCourse.tees.find((x) => x.teeId === t.ghinTeeId)?.isDefault),
        lastUpdatedUtc: (ghinCourse.tees.find((x) => x.teeId === t.ghinTeeId)?.lastUpdatedUtc) 
          || (ghinCourse.tees.find((x) => x.teeId === t.ghinTeeId)?.updatedAt) 
          || null
      }));
      res.json({ courseId: ghinCourseId, lastUpdatedUtc: (ghinCourse.lastUpdatedUtc || ghinCourse.updatedAt || null), tees });
    } catch (error) {
      logger.error('Fetch tees error', { ghinCourseId, error: error.message });
      res.status(502).json({
        error: { code: 'GHIN_API_ERROR', message: 'Failed to fetch tees', retryable: true }
      });
    }
  }
);

/**
 * GET /api/v1/courses/:ghinCourseId/holes?teeId=...&gender=...
 * Return 18-hole par/handicap for a tee+gender
 */
router.get(
  '/:ghinCourseId/holes',
  [
    param('ghinCourseId').isString().trim().isLength({ min: 1, max: 100 }),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        error: { code: 'INVALID_REQUEST', message: 'Invalid course ID', details: errors.array() }
      });
    }
    const { ghinCourseId } = req.params;
    const { teeId, gender } = req.query;
    if (!teeId || !gender) {
      return res.status(400).json({
        error: { code: 'INVALID_REQUEST', message: 'teeId and gender are required' }
      });
    }
    try {
      const ghinCourse = await ghinClient.getCourse(ghinCourseId);
      if (!ghinCourse) {
        return res.status(404).json({
          error: { code: 'GHIN_COURSE_NOT_FOUND', message: `Course ${ghinCourseId} not found` }
        });
      }
      const tee = (ghinCourse.tees || []).find((t) => String(t.teeId) === String(teeId) && String(t.gender).toUpperCase() === String(gender).toUpperCase());
      if (!tee) {
        return res.status(404).json({
          error: { code: 'TEE_NOT_FOUND', message: `Tee ${teeId} (${gender}) not found` }
        });
      }
      const holes = (tee.holes || []).map(transformGhinHole);
      if (holes.length !== 18) {
        return res.status(422).json({
          error: { code: 'INVALID_BASELINE', message: 'Expected 18 holes' }
        });
      }
      res.json({ courseId: ghinCourseId, teeId, gender: String(gender).toUpperCase(), holes });
    } catch (error) {
      logger.error('Fetch holes error', { ghinCourseId, error: error.message });
      res.status(502).json({
        error: { code: 'GHIN_API_ERROR', message: 'Failed to fetch holes', retryable: true }
      });
    }
  }
);

module.exports = router;
