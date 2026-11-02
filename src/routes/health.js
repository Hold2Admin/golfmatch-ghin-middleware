// ============================================================
// Health Check Endpoint
// ============================================================

const express = require('express');
const router = express.Router();
const { createLogger } = require('../utils/logger');
const config = require('../config');
const { getClient } = require('../utils/appinsights');
const database = require('../services/database');
const redis = require('../services/redis');
const { getRuntimeInfo } = require('../utils/runtimeInfo');

const logger = createLogger('health');
const SLOW_HEALTH_MS = 1000;

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
      // App Insights is optional - don't fail if not configured
      if (!client) {
        logger.debug('Application Insights not configured');
      }
    });

    await runCheck('database', async () => {
      const dbHealth = await database.checkHealth();
      // Only fail if unhealthy, not if not_configured
      if (dbHealth.status === 'unhealthy') {
        throw new Error(dbHealth.error || 'Database unhealthy');
      }
      // not_configured is treated as healthy (optional service)
    });

    await runCheck('redis', async () => {
      const redisHealth = await redis.checkHealth();
      // Only fail if unhealthy, not if not_configured
      if (redisHealth.status === 'unhealthy') {
        throw new Error(redisHealth.error || 'Redis unhealthy');
      }
      // not_configured is treated as healthy (optional service)
    });

    let runtimeInfo;
    await runCheck('runtimeInfo', async () => {
      runtimeInfo = getRuntimeInfo();
    });

    const allHealthy = checks.every((c) => c.status === 'healthy');
    const totalMs = checks.reduce((sum, c) => sum + c.durationMs, 0);
    if (totalMs >= SLOW_HEALTH_MS) {
      // Each step's time goes to App Insights, so a slow probe shows which step took the time.
      logger.warn('Slow health check', {
        totalMs,
        ...Object.fromEntries(checks.map((c) => [`${c.name}Ms`, c.durationMs]))
      });
    }

    const payload = {
      status: allHealthy ? 'healthy' : 'degraded',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      environment: config.env,
      ghinApiMode: config.ghin.useMock ? 'MOCK' : 'LIVE',
      version: runtimeInfo.appVersion,
      deployment: runtimeInfo,
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
