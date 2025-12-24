// ============================================================
// Health Check Endpoint
// ============================================================

const express = require('express');
const router = express.Router();
const { createLogger } = require('../utils/logger');
const config = require('../config');
const { getClient } = require('../utils/appinsights');

const logger = createLogger('health');

/**
 * GET /api/v1/health
 * Health check for monitoring and load balancers
 */
router.get('/', async (req, res) => {
  const checks = [];

  const runCheck = async (name, fn) => {
    const started = Date.now();
    try {
      await fn();
      checks.push({ name, status: 'healthy', durationMs: Date.now() - started });
    } catch (error) {
      checks.push({
        name,
        status: 'unhealthy',
        durationMs: Date.now() - started,
        error: error.message
      });
    }
  };

  try {
    await runCheck('app', async () => undefined);

    await runCheck('appInsights', async () => {
      const client = getClient();
      if (!client) {
        throw new Error('Application Insights client not initialized');
      }
    });

    const allHealthy = checks.every((c) => c.status === 'healthy');

    const payload = {
      status: allHealthy ? 'healthy' : 'degraded',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      environment: config.env,
      ghinApiMode: config.ghin.useMock ? 'MOCK' : 'LIVE',
      version: '1.0.0',
      checks
    };

    res.status(allHealthy ? 200 : 503).json(payload);
  } catch (error) {
    logger.error('Health check failed', { error: error.message });
    res.status(503).json({
      status: 'unhealthy',
      error: error.message,
      checks
    });
  }
});

module.exports = router;
