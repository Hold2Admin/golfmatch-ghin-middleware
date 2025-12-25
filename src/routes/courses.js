// ============================================================
// Course Endpoints
// ============================================================

const express = require('express');
const router = express.Router();
const { param, body, validationResult } = require('express-validator');
const { createLogger } = require('../utils/logger');
const ghinClient = require('../services/ghinClient');
const { transformGhinCourse, transformGhinTee, transformGhinHole } = require('../services/transformers/courseTransformer');

const logger = createLogger('courses');

/**
 * GET /api/v1/courses/:ghinCourseId
 * Fetch complete course data including all tees and holes
 */
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
        isDefault: Boolean(ghinCourse.tees.find((x) => x.teeId === t.ghinTeeId)?.isDefault)
      }));
      res.json({ courseId: ghinCourseId, tees });
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
