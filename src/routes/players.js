// ============================================================
// Player Endpoints
// ============================================================

const express = require('express');
const router = express.Router();
const { body, param, query, validationResult } = require('express-validator');
const { createLogger } = require('../utils/logger');
const ghinClient = require('../services/ghinClient');
const { transformGhinPlayer } = require('../services/transformers/playerTransformer');
const config = require('../config');
const { createConcurrencyLimiter } = require('../utils/concurrencyLimiter');
const { resolveHandicapIndexAsOf } = require('../services/handicapIndexAsOfService');

const logger = createLogger('players');

// Shared across all in-flight /batch requests so parallel batches can't fan out unbounded.
// Course and single-player calls do not go through this limiter.
const limitBatchPlayerLookup = createConcurrencyLimiter(config.ghin.maxConcurrentPlayerLookups);

const ghinNumberValidator = (field) => field
  .isString()
  .trim()
  .matches(/^\d{1,10}$/)
  .withMessage('GHIN number must be 1-10 digits');

/**
 * GET /api/v1/players/:ghinNumber
 * Fetch a single player's handicap data
 */
router.get(
  '/:ghinNumber',
  [
    ghinNumberValidator(param('ghinNumber'))
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
    ghinNumberValidator(body('ghinNumbers.*'))
      .withMessage('Each GHIN number must be 1-10 digits')
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
    const startedAt = Date.now();

    try {
      logger.info('Batch player lookup requested', {
        correlationId: req.correlationId,
        requested: ghinNumbers.length,
        forceRefresh: forceRefresh === true,
      });

      // One USGA search per 25 IDs; any ID it doesn't return (or a failed bulk call) falls back
      // to the single lookup, so the result is never worse than per-player fetching.
      let bulkById = new Map();
      try {
        bulkById = await ghinClient.getPlayersBulk(ghinNumbers);
      } catch (bulkError) {
        logger.warn('Bulk player lookup failed; using single lookups', { correlationId: req.correlationId, error: bulkError.message });
      }
      const results = await Promise.allSettled(
        ghinNumbers.map((ghinNumber) => {
          const bulkPlayer = bulkById.get(String(ghinNumber).trim());
          if (bulkPlayer) return Promise.resolve(bulkPlayer);
          return limitBatchPlayerLookup(() => ghinClient.getPlayer(ghinNumber, { suppressSuccessLog: true }));
        })
      );
      const bulkHits = ghinNumbers.filter((n) => bulkById.has(String(n).trim())).length;

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

      logger.info('Batch player lookup completed', {
        correlationId: req.correlationId,
        requested: ghinNumbers.length,
        returned: players.length,
        bulkHits,
        notFound: notFound.length,
        errors: errors.length,
        forceRefresh: forceRefresh === true,
        duration: `${Date.now() - startedAt}ms`,
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
 * POST /api/v1/players/handicap-index-as-of/batch
 * Resolve each golfer's Handicap Index in effect on asOfDate (YYYY-MM-DD) in a single request
 */
router.post(
  '/handicap-index-as-of/batch',
  [
    body('ghinNumbers')
      .isArray({ min: 1, max: 50 })
      .withMessage('Must provide 1-50 GHIN numbers'),
    ghinNumberValidator(body('ghinNumbers.*'))
      .withMessage('Each GHIN number must be 1-10 digits'),
    body('asOfDate')
      .isString()
      .trim()
      .matches(/^\d{4}-\d{2}-\d{2}$/)
      .withMessage('asOfDate must be YYYY-MM-DD')
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

    const { ghinNumbers, asOfDate } = req.body;
    const startedAt = Date.now();

    try {
      logger.info('Batch handicap index as-of lookup requested', {
        correlationId: req.correlationId,
        requested: ghinNumbers.length,
        asOfDate,
      });

      const settled = await Promise.allSettled(
        ghinNumbers.map(ghinNumber => limitBatchPlayerLookup(() => resolveHandicapIndexAsOf(ghinNumber, asOfDate)))
      );

      const results = settled.map((result, index) => (
        result.status === 'fulfilled'
          ? result.value
          : { ghinNumber: ghinNumbers[index], error: result.reason?.message }
      ));

      logger.info('Batch handicap index as-of lookup completed', {
        correlationId: req.correlationId,
        requested: ghinNumbers.length,
        resolved: results.filter(result => !result.error).length,
        errors: results.filter(result => result.error).length,
        asOfDate,
        duration: `${Date.now() - startedAt}ms`,
      });

      res.json({ results });
    } catch (error) {
      logger.error('Batch handicap index as-of error', { error: error.message });
      res.status(500).json({
        error: {
          code: 'BATCH_FETCH_ERROR',
          message: 'Failed to resolve handicap indexes',
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
    body('ghinNumber').optional().isString().trim().matches(/^\d{1,10}$/).withMessage('GHIN number must be 1-10 digits'),
    body('firstName').optional().isString().trim().isLength({ min: 1, max: 50 }),
    body('lastName').optional().isString().trim().isLength({ min: 1, max: 50 }),
    body('email').optional().isEmail().withMessage('Valid email is required'),
    body('state').optional().isString().trim().isLength({ min: 2, max: 2 }),
    body('country').optional().isString().trim().isLength({ min: 3, max: 3 }),
    body('perPage').optional().isInt({ min: 1, max: 300 }),
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

    const { ghinNumber, firstName, lastName, email, state, country, perPage, clubName, associationId } = req.body;

    // Require at least one search parameter
    if (!ghinNumber && !firstName && !lastName && !email && !state && !country && !clubName && !associationId) {
      return res.status(400).json({
        error: {
          code: 'INVALID_REQUEST',
          message: 'Must provide at least one search parameter'
        }
      });
    }

    try {
      logger.info('Searching for players', { ghinNumber, firstName, lastName, email, state, country, perPage, clubName });

      const results = await ghinClient.searchPlayers({
        ghinNumber,
        firstName,
        lastName,
        email,
        state,
        country,
        perPage,
        clubName,
        associationId
      });

      res.json({
        results: results.map(transformGhinPlayer),
        totalResults: results.length,
        // A full page means USGA may have more matches than were asked for.
        truncated: results.length >= (perPage ?? 20)
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

/**
 * POST /api/v1/players/:ghinNumber/request-access
 * Request golfer product access for an acknowledged user.
 */
router.post(
  '/:ghinNumber/request-access',
  [
    ghinNumberValidator(param('ghinNumber')),
    body('email')
      .isEmail()
      .withMessage('Valid email is required')
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

    const { ghinNumber } = req.params;
    const { email } = req.body;

    try {
      logger.info(`Requesting golfer product access for ${ghinNumber}`);

      const player = await ghinClient.getPlayer(ghinNumber);
      if (!player) {
        return res.status(404).json({
          error: {
            code: 'GHIN_PLAYER_NOT_FOUND',
            message: `Player with GHIN number ${ghinNumber} not found`,
            retryable: false
          }
        });
      }

      const result = await ghinClient.requestGolferProductAccess(ghinNumber, email);

      res.json({
        ghinNumber,
        status: 'pending',
        requestedAt: new Date().toISOString(),
        result,
        player: transformGhinPlayer(player)
      });
    } catch (error) {
      logger.error('Error requesting golfer product access', { ghinNumber, error: error.message });
      res.status(502).json({
        error: {
          code: 'GHIN_API_ERROR',
          message: error.message || 'Failed to request golfer product access',
          retryable: false
        }
      });
    }
  }
);

router.get(
  '/:ghinNumber/access-status',
  [
    ghinNumberValidator(param('ghinNumber'))
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

    try {
      logger.info(`Fetching golfer product access status for ${ghinNumber}`);

      const result = await ghinClient.getGolferProductAccessStatus(ghinNumber);
      return res.json(result);
    } catch (error) {
      logger.error('Error fetching golfer product access status', { ghinNumber, error: error.message });
      return res.status(502).json({
        error: {
          code: 'GHIN_API_ERROR',
          message: error.message || 'Failed to fetch golfer product access status',
          retryable: true
        }
      });
    }
  }
);

router.post(
  '/:ghinNumber/approve-access',
  [
    ghinNumberValidator(param('ghinNumber'))
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

    try {
      logger.info(`Approving golfer product access for ${ghinNumber}`);

      const result = await ghinClient.updateGolferProductAccessStatus(ghinNumber, 'approved');

      res.json({
        ghinNumber,
        status: 'approved',
        updatedAt: new Date().toISOString(),
        result
      });
    } catch (error) {
      logger.error('Error approving golfer product access', { ghinNumber, error: error.message });
      res.status(502).json({
        error: {
          code: 'GHIN_API_ERROR',
          message: error.message || 'Failed to approve golfer product access',
          retryable: false
        }
      });
    }
  }
);

router.delete(
  '/:ghinNumber/revoke-access',
  [
    ghinNumberValidator(param('ghinNumber'))
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

    try {
      logger.info(`Revoking golfer product access for ${ghinNumber}`);

      const result = await ghinClient.revokeGolferProductAccess(ghinNumber);

      res.json({
        ghinNumber,
        status: 'inactive',
        updatedAt: new Date().toISOString(),
        result
      });
    } catch (error) {
      logger.error('Error revoking golfer product access', { ghinNumber, error: error.message });
      res.status(502).json({
        error: {
          code: 'GHIN_API_ERROR',
          message: error.message || 'Failed to revoke golfer product access',
          retryable: false
        }
      });
    }
  }
);


router.get(
  '/:ghinNumber/privacy-settings',
  [
    ghinNumberValidator(param('ghinNumber'))
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

    try {
      logger.info(`Fetching privacy settings for ${ghinNumber}`);
      const result = await ghinClient.getGolferPrivacySettings(ghinNumber);
      return res.json(result);
    } catch (error) {
      logger.error('Error fetching golfer privacy settings', { ghinNumber, error: error.message });
      return res.status(error.status || 502).json({
        error: {
          code: error.code || 'GHIN_API_ERROR',
          message: error.message || 'Failed to fetch golfer privacy settings',
          retryable: (error.status || 502) >= 500
        }
      });
    }
  }
);

router.get(
  '/:ghinNumber/scores',
  [
    ghinNumberValidator(param('ghinNumber')),
    query('club_id').optional({ nullable: true }).isString().trim().notEmpty()
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        error: {
          code: 'INVALID_REQUEST',
          message: 'Invalid golfer scores request',
          details: errors.array()
        }
      });
    }

    const { ghinNumber } = req.params;
    const clubId = req.query.club_id || req.query.clubId || null;

    try {
      logger.info(`Fetching golfer scores for ${ghinNumber}`, { club_id: clubId || null });
      const result = await ghinClient.getGolferScores(ghinNumber, { club_id: clubId });
      // Pass through USGA visibility fields unchanged.
      return res.json(result);
    } catch (error) {
      logger.error('Error fetching golfer scores', { ghinNumber, error: error.message });
      return res.status(error.status || 502).json({
        error: {
          code: error.code || 'GHIN_API_ERROR',
          message: error.message || 'Failed to fetch golfer scores',
          retryable: (error.status || 502) >= 500
        }
      });
    }
  }
);


module.exports = router;
