const express = require('express');
const { body, param, query, validationResult } = require('express-validator');
const { createLogger } = require('../utils/logger');
const scorePostingService = require('../services/scorePostingService');

const router = express.Router();
const logger = createLogger('scores');

function failValidation(req, res) {
  const errors = validationResult(req);
  if (errors.isEmpty()) {
    return null;
  }

  return res.status(400).json({
    error: {
      code: 'INVALID_REQUEST',
      message: 'Invalid score posting request',
      details: errors.array()
    }
  });
}

router.post(
  '/post',
  [
    body('mode').isIn(['hbh', 'adjusted']).withMessage('mode must be hbh or adjusted'),
    body('golfer_id').isString().trim().notEmpty().withMessage('golfer_id is required'),
    body('course_id').isString().trim().notEmpty().withMessage('course_id is required'),
    body('tee_set_id').isString().trim().notEmpty().withMessage('tee_set_id is required'),
    body('tee_set_side').isIn(['All18', 'F9', 'B9']).withMessage('tee_set_side must be All18, F9, or B9'),
    body('played_at').matches(/^\d{4}-\d{2}-\d{2}$/).withMessage('played_at must be YYYY-MM-DD'),
    body('score_type').isIn(['H', 'A', 'T']).withMessage('score_type must be H, A, or T'),
    body('number_of_holes').custom((value) => ['9', '18', 9, 18].includes(value)).withMessage('number_of_holes must be 9 or 18'),
    body('number_of_played_holes').optional({ nullable: true }).isInt({ min: 1, max: 18 }).withMessage('number_of_played_holes must be 1-18'),
    body('gender').isIn(['M', 'F']).withMessage('gender must be M or F'),
    body('override_confirmation').optional({ nullable: true }).isBoolean().withMessage('override_confirmation must be boolean'),
    body('is_manual').optional({ nullable: true }).isBoolean().withMessage('is_manual must be boolean'),
    body('hole_details').optional({ nullable: true }).isArray({ min: 1, max: 18 }).withMessage('hole_details must be an array with 1-18 entries')
  ],
  async (req, res) => {
    const validationFailure = failValidation(req, res);
    if (validationFailure) {
      return validationFailure;
    }

    if (req.body.mode === 'hbh' && !Array.isArray(req.body.hole_details)) {
      return res.status(400).json({
        error: {
          code: 'INVALID_REQUEST',
          message: 'hole_details is required for hbh posting mode'
        }
      });
    }

    try {
      const { mode, ...scorePayload } = req.body;
      const result = await scorePostingService.postScore(mode, scorePayload, req.correlationId);
      return res.json(result);
    } catch (error) {
      logger.error('Score post failed', {
        correlationId: req.correlationId,
        error: error.message,
        mode: req.body?.mode
      });
      return res.status(error.status || 502).json({
        error: {
          code: error.code || 'SCORE_POST_FAILED',
          message: error.message
        },
        correlationId: req.correlationId
      });
    }
  }
);

router.get(
  '/search',
  [
    query('golfer_id').optional().isString().trim().notEmpty(),
    query('played_at_from').optional().matches(/^\d{4}-\d{2}-\d{2}$/),
    query('played_at_to').optional().matches(/^\d{4}-\d{2}-\d{2}$/),
    query('mode').optional().isIn(['hbh', 'adjusted']),
    query('page').optional().isInt({ min: 1, max: 10000 }),
    query('per_page').optional().isInt({ min: 1, max: 100 })
  ],
  async (req, res) => {
    const validationFailure = failValidation(req, res);
    if (validationFailure) {
      return validationFailure;
    }

    try {
      const result = await scorePostingService.searchScores(req.query, req.correlationId);
      return res.json(result);
    } catch (error) {
      logger.error('Score search failed', {
        correlationId: req.correlationId,
        error: error.message
      });
      return res.status(error.status || 502).json({
        error: {
          code: error.code || 'SCORE_SEARCH_FAILED',
          message: error.message
        },
        correlationId: req.correlationId
      });
    }
  }
);

router.get(
  '/:scoreId',
  [param('scoreId').isString().trim().notEmpty().withMessage('scoreId is required')],
  async (req, res) => {
    const validationFailure = failValidation(req, res);
    if (validationFailure) {
      return validationFailure;
    }

    try {
      const result = await scorePostingService.getScore(req.params.scoreId, req.correlationId);
      return res.json(result);
    } catch (error) {
      logger.error('Score fetch failed', {
        correlationId: req.correlationId,
        error: error.message,
        scoreId: req.params.scoreId
      });
      return res.status(error.status || 502).json({
        error: {
          code: error.code || 'SCORE_FETCH_FAILED',
          message: error.message
        },
        correlationId: req.correlationId
      });
    }
  }
);

module.exports = router;