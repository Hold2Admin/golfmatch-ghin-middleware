// ============================================================
// GHIN Middleware API - Entry Point
// ============================================================

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const { createLogger } = require('./utils/logger');
const config = require('./config');

const app = express();
const logger = createLogger('app');

// ============================================================
// Middleware
// ============================================================

app.use(helmet()); // Security headers
app.use(cors()); // CORS for Fore Play API
app.use(express.json()); // Parse JSON bodies

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

app.listen(PORT, () => {
  logger.info(`GHIN Middleware API listening on port ${PORT}`);
  logger.info(`Environment: ${config.env}`);
  logger.info(`GHIN API Mode: ${config.ghin.useMock ? 'MOCK' : 'LIVE'}`);
});

module.exports = app;
