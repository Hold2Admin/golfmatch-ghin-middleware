// ============================================================
// Health Check Endpoint
// ============================================================

const express = require('express');
const router = express.Router();
const { createLogger } = require('../utils/logger');
const config = require('../config');

const logger = createLogger('health');

/**
 * GET /api/v1/health
 * Health check for monitoring and load balancers
 */
router.get('/', async (req, res) => {
  try {
    const health = {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      environment: config.env,
      ghinApiMode: config.ghin.useMock ? 'MOCK' : 'LIVE',
      version: '1.0.0'
    };

    // TODO: Add database connectivity check
    // TODO: Add Redis connectivity check
    // TODO: Add GHIN API connectivity check

    res.json(health);
  } catch (error) {
    logger.error('Health check failed', { error: error.message });
    res.status(503).json({
      status: 'unhealthy',
      error: error.message
    });
  }
});

module.exports = router;
