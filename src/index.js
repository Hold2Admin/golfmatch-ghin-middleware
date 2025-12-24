// ============================================================
// GHIN Middleware API - Entry Point
// ============================================================

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env.local') });

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const { createLogger } = require('./utils/logger');
const { initializeAppInsights, trackEvent } = require('./utils/appinsights');
const config = require('./config');
const { conditionalAuth } = require('./middleware/auth');
const { validateRequest, sanitizeHeaders } = require('./middleware/validation');
const { addCorrelationId, trackRequestMetrics } = require('./middleware/tracking');
const { rateLimiter } = require('./middleware/rate-limit');
const database = require('./services/database');
const redis = require('./services/redis');

// Initialize Application Insights FIRST, before everything else
initializeAppInsights();

const app = express();
const logger = createLogger('app');

// ============================================================
// Middleware
// ============================================================

app.use(helmet()); // Security headers
app.use(cors()); // CORS for Fore Play API
app.use(express.json({ limit: '10mb' })); // Parse JSON bodies with size limit
app.use(sanitizeHeaders); // Sanitize headers
app.use(addCorrelationId); // Add correlation ID for request tracking
app.use(trackRequestMetrics); // Track request metrics and timing
app.use(validateRequest); // Validate request structure
app.use(conditionalAuth); // API Key authentication (except /health and /)
app.use(rateLimiter({ windowMs: 60000, maxRequests: 100 })); // Rate limiting

// Request logging
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    logger.info({
      method: req.method,
      path: req.path,
      status: res.statusCode,
      duration: `${duration}ms`,
      ip: req.ip
    });
  });
  next();
});

// ============================================================
// Routes
// ============================================================

const healthRouter = require('./routes/health');
const playersRouter = require('./routes/players');
const coursesRouter = require('./routes/courses');

app.use('/api/v1/health', healthRouter);
app.use('/api/v1/players', playersRouter);
app.use('/api/v1/courses', coursesRouter);

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    service: 'GHIN Middleware API',
    version: '1.0.0',
    status: 'running',
    documentation: '/api/v1/health'
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    error: {
      code: 'NOT_FOUND',
      message: `Endpoint ${req.method} ${req.path} not found`
    }
  });
});

// Global error handler
app.use((err, req, res, next) => {
  logger.error('Unhandled error', { error: err.message, stack: err.stack });
  res.status(err.status || 500).json({
    error: {
      code: err.code || 'INTERNAL_ERROR',
      message: err.message || 'An unexpected error occurred',
      ...(config.env === 'development' && { stack: err.stack })
    }
  });
});

// ============================================================
// Start Server
// ============================================================

const PORT = config.port;

// Lazy-initialize optional services in background (don't block startup)
if (process.env.NODE_ENV !== 'test') {
  setImmediate(async () => {
    if (config.db.server) {
      try {
        await database.connect();
      } catch (error) {
        logger.warn('Database connection failed in background', { error: error.message });
      }
    }

    if (config.redis.host) {
      try {
        await redis.connect();
      } catch (error) {
        logger.warn('Redis connection failed in background', { error: error.message });
      }
    }
  });
}

// Only start server if not in test mode
if (process.env.NODE_ENV !== 'test') {
  app.listen(PORT, () => {
    logger.info(`GHIN Middleware API listening on port ${PORT}`);
    logger.info(`Environment: ${config.env}`);
    logger.info(`GHIN API Mode: ${config.ghin.useMock ? 'MOCK' : 'LIVE'}`);
    
    // Track startup event
    trackEvent('ApplicationStartup', {
      port: PORT.toString(),
      environment: config.env,
      ghinMode: config.ghin.useMock ? 'MOCK' : 'LIVE'
    });
  });
}

module.exports = app;
