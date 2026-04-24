// ============================================================
// Supporting Calculation Endpoints
// ============================================================

const express = require('express');
const router = express.Router();
const { body, validationResult } = require('express-validator');
const { createLogger } = require('../utils/logger');
const ghinClient = require('../services/ghinClient');

const logger = createLogger('calculations');

// ============================================================
// POST /api/v1/calculations/manual-course-handicap
//
// Compute Course Handicap and Playing Handicap for one golfer
// using explicitly supplied tee metrics (no GHIN course lookup).
//
// Body:
//   golferId        {string}  optional — GHIN number; supply this OR handicapIndex
//   handicapIndex   {string}  optional — explicit HI string (e.g. "+6.4", "10.2")
//   courseRating    {number}  required
//   slopeRating     {number}  required
//   par             {number}  required
//   numberOfHoles   {number}  required — 9 or 18
//   handicapAllowance {number} optional — default 100
//
// Response:
//   { courseHandicap, courseHandicapDisplay, playingHandicap, playingHandicapDisplay }
// ============================================================
router.post(
  '/manual-course-handicap',
  [
    body('courseRating').isFloat({ min: 20, max: 100 }).withMessage('courseRating must be a number between 20 and 100'),
    body('slopeRating').isInt({ min: 55, max: 155 }).withMessage('slopeRating must be an integer between 55 and 155'),
    body('par').isInt({ min: 27, max: 80 }).withMessage('par must be an integer between 27 and 80'),
    body('numberOfHoles').isIn([9, 18]).withMessage('numberOfHoles must be 9 or 18'),
    body('handicapAllowance').optional().isFloat({ min: 0, max: 100 }).withMessage('handicapAllowance must be between 0 and 100'),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        error: {
          code: 'INVALID_REQUEST',
          message: 'Invalid calculation request',
          details: errors.array(),
        },
      });
    }

    const { golferId, handicapIndex, courseRating, slopeRating, par, numberOfHoles, handicapAllowance } = req.body;

    if (!golferId && handicapIndex == null) {
      return res.status(400).json({
        error: {
          code: 'INVALID_REQUEST',
          message: 'Provide golferId or handicapIndex',
        },
      });
    }

    try {
      logger.info('[LIVE] manual-course-handicap', {
        golferId: golferId || null,
        handicapIndex: handicapIndex != null ? '(provided)' : null,
        courseRating,
        slopeRating,
        par,
        numberOfHoles,
        handicapAllowance: handicapAllowance ?? 100,
      });

      const result = await ghinClient.getManualCourseHandicap({
        golferId: golferId || undefined,
        handicapIndex: golferId ? undefined : handicapIndex,
        courseRating: Number(courseRating),
        slopeRating: Number(slopeRating),
        par: Number(par),
        numberOfHoles: Number(numberOfHoles),
        handicapAllowance: handicapAllowance != null ? Number(handicapAllowance) : 100,
      });

      return res.json({
        courseHandicap: result.courseHandicap,
        courseHandicapDisplay: result.courseHandicapDisplay,
        playingHandicap: result.playingHandicap,
        playingHandicapDisplay: result.playingHandicapDisplay,
      });
    } catch (err) {
      logger.error('manual-course-handicap failed', { error: err.message });
      return res.status(502).json({
        error: {
          code: 'GHIN_UPSTREAM_ERROR',
          message: err.message || 'GHIN calculation request failed',
          retryable: true,
        },
      });
    }
  }
);

// ============================================================
// POST /api/v1/calculations/playing-handicaps
//
// Compute Playing Handicap for a group of golfers by their
// GHIN-registered tee sets. Uses GHIN-authoritative tee identity.
//
// Body:
//   golfers  {array} required — each entry:
//     golferId      {string}  optional
//     handicapIndex {string}  optional — supply this OR golferId
//     teeSetId      {string}  required
//     teeSetSide    {string}  required — "All18" | "F9" | "B9"
//
// Response:
//   { allowances: [{ allowance, golfers: [{ key, golferId, playingHandicap, playingHandicapDisplay, shotsOff }] }] }
// ============================================================
router.post(
  '/playing-handicaps',
  [
    body('golfers').isArray({ min: 1 }).withMessage('golfers must be a non-empty array'),
    body('golfers.*.teeSetId').notEmpty().withMessage('Each golfer must have a teeSetId'),
    body('golfers.*.teeSetSide').isIn(['All18', 'F9', 'B9']).withMessage('teeSetSide must be All18, F9, or B9'),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        error: {
          code: 'INVALID_REQUEST',
          message: 'Invalid playing-handicaps request',
          details: errors.array(),
        },
      });
    }

    const { golfers } = req.body;

    for (const g of golfers) {
      if (!g.golferId && g.handicapIndex == null) {
        return res.status(400).json({
          error: {
            code: 'INVALID_REQUEST',
            message: 'Each golfer must have golferId or handicapIndex',
          },
        });
      }
    }

    try {
      logger.info('[LIVE] playing-handicaps', { golferCount: golfers.length });

      const result = await ghinClient.getPlayingHandicaps(
        golfers.map((g) => ({
          golferId: g.golferId || undefined,
          handicapIndex: g.golferId ? undefined : g.handicapIndex,
          teeSetId: g.teeSetId,
          teeSetSide: g.teeSetSide,
        }))
      );

      return res.json(result);
    } catch (err) {
      logger.error('playing-handicaps failed', { error: err.message });
      return res.status(502).json({
        error: {
          code: 'GHIN_UPSTREAM_ERROR',
          message: err.message || 'GHIN playing-handicaps request failed',
          retryable: true,
        },
      });
    }
  }
);

module.exports = router;
