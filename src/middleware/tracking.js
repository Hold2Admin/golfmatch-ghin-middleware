function addCorrelationId(req, res, next) {
  if (!req.headers['x-correlation-id']) {
    req.headers['x-correlation-id'] = Math.random().toString(36).slice(2);
  }
  next();
}

function trackRequestMetrics(req, res, next) {
  next();
}

module.exports = { addCorrelationId, trackRequestMetrics };
// ============================================================
// Request Tracking Middleware
// Adds correlation IDs and tracks request lifecycle
// ============================================================

const { v4: uuidv4 } = require('uuid');
const { createLogger } = require('../utils/logger');

const logger = createLogger('request-tracking');

/**
 * Add correlation ID to all requests
 * Allows tracing a request across all logs and services
 */
function addCorrelationId(req, res, next) {
  // Check if X-Correlation-ID header already exists (from upstream service)
  const correlationId = req.get('x-correlation-id') || uuidv4();
  
  // Add to request object for use in controllers
  req.correlationId = correlationId;
  
  // Add to response header
  res.setHeader('X-Correlation-ID', correlationId);
  
  // Add to logger context
  logger.defaultMeta = {
    ...logger.defaultMeta,
    correlationId
  };
  
  next();
}

/**
 * Track request/response timing and metrics
 */
function trackRequestMetrics(req, res, next) {
  const startTime = Date.now();
  const startMemory = process.memoryUsage().heapUsed;

  // Track when response is sent
  const originalSend = res.send;
  res.send = function(data) {
    const duration = Date.now() - startTime;
    const memoryUsed = process.memoryUsage().heapUsed - startMemory;

    logger.info('Request completed', {
      correlationId: req.correlationId,
      method: req.method,
      path: req.path,
      status: res.statusCode,
      duration: `${duration}ms`,
      contentLength: res.get('content-length') || 'unknown',
      ip: req.ip,
      userAgent: req.get('user-agent')
    });

    // Call original send
    return originalSend.call(this, data);
  };

  next();
}

module.exports = {
  addCorrelationId,
  trackRequestMetrics
};
