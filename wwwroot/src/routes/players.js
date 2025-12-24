// ============================================================
// Player Endpoints
// ============================================================

const express = require('express');
const router = express.Router();
const { body, param, validationResult } = require('express-validator');
const { createLogger } = require('../utils/logger');
const ghinClient = require('../services/ghinClient');
const { transformGhinPlayer } = require('../services/transformers/playerTransformer');

const logger = createLogger('players');

/**
 * GET /api/v1/players/:ghinNumber
 * Fetch a single player's handicap data
 */
router.get(
  '/:ghinNumber',
  [
    param('ghinNumber')
      .isNumeric()
      .isLength({ min: 6, max: 10 })
      .withMessage('GHIN number must be 6-10 digits')
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        error: {
          code: 'INVALID_REQUEST',
          message: 'Invalid GHIN number format',
          details: errors.array()
        }
      });
    }

    const { ghinNumber } = req.params;
    const forceRefresh = req.query.force === 'true';

    try {
      logger.info(`Fetching player ${ghinNumber}`, { forceRefresh });

      // TODO: Check cache first (unless forceRefresh)
      
      // Fetch from GHIN API (currently mock)
      const ghinPlayer = await ghinClient.getPlayer(ghinNumber);
      
      if (!ghinPlayer) {
        return res.status(404).json({
          error: {
            code: 'GHIN_PLAYER_NOT_FOUND',
            message: `Player with GHIN number ${ghinNumber} not found`,
            retryable: false
          }
        });
      }

      // Transform to normalized format
      const normalizedPlayer = transformGhinPlayer(ghinPlayer);

      // TODO: Cache the result

      res.json(normalizedPlayer);
    } catch (error) {
      logger.error('Error fetching player', { ghinNumber, error: error.message });
      res.status(502).json({
        error: {
          code: 'GHIN_API_ERROR',
          message: 'Failed to fetch player from GHIN API',
          retryable: true
        }
      });
    }
  }
);

/**
 * POST /api/v1/players/batch
 * Fetch multiple players in a single request
 */
router.post(
  '/batch',
  [
    body('ghinNumbers')
      .isArray({ min: 1, max: 50 })
      .withMessage('Must provide 1-50 GHIN numbers'),
    body('ghinNumbers.*')
      .isNumeric()
      .isLength({ min: 6, max: 10 })
      .withMessage('Each GHIN number must be 6-10 digits')
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        error: {
          code: 'INVALID_REQUEST',
          message: 'Invalid request body',
          details: errors.array()
        }
      });
    }

    const { ghinNumbers, forceRefresh = false } = req.body;

    try {
      logger.info(`Fetching ${ghinNumbers.length} players in batch`);

      const results = await Promise.allSettled(
        ghinNumbers.map(ghinNumber => ghinClient.getPlayer(ghinNumber))
      );

      const players = [];
      const notFound = [];
      const errors = [];

      results.forEach((result, index) => {
        const ghinNumber = ghinNumbers[index];
        if (result.status === 'fulfilled' && result.value) {
          players.push(transformGhinPlayer(result.value));
        } else if (result.status === 'fulfilled' && !result.value) {
          notFound.push(ghinNumber);
        } else {
          errors.push({ ghinNumber, error: result.reason?.message });
        }
      });

      res.json({
        players,
        notFound,
        errors
      });
    } catch (error) {
      logger.error('Batch fetch error', { error: error.message });
      res.status(500).json({
        error: {
          code: 'BATCH_FETCH_ERROR',
          message: 'Failed to fetch players',
          retryable: true
        }
      });
    }
  }
);

/**
 * POST /api/v1/players/search
 * Search for players by name or club
 */
router.post(
  '/search',
  [
    body('firstName').optional().isString().trim().isLength({ min: 1, max: 50 }),
    body('lastName').optional().isString().trim().isLength({ min: 1, max: 50 }),
    body('clubName').optional().isString().trim().isLength({ min: 1, max: 100 }),
    body('associationId').optional().matches(/^[A-Z]{2,4}$/)
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

    const { firstName, lastName, clubName, associationId } = req.body;

    // Require at least one search parameter
    if (!firstName && !lastName && !clubName && !associationId) {
      return res.status(400).json({
        error: {
          code: 'INVALID_REQUEST',
          message: 'Must provide at least one search parameter'
        }
      });
    }

    try {
      logger.info('Searching for players', { firstName, lastName, clubName });

      // TODO: Implement GHIN search (currently returns mock data)
      const results = await ghinClient.searchPlayers({
        firstName,
        lastName,
        clubName,
        associationId
      });

      res.json({
        results: results.map(transformGhinPlayer),
        totalResults: results.length
      });
    } catch (error) {
      logger.error('Player search error', { error: error.message });
      res.status(502).json({
        error: {
          code: 'GHIN_API_ERROR',
          message: 'Player search failed',
          retryable: true
        }
      });
    }
  }
);

module.exports = router;
