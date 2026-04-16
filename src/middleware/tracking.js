// ============================================================
// Request Tracking Middleware
// Adds correlation IDs and tracks request lifecycle
// ============================================================

const { v4: uuidv4 } = require('uuid');
const { createLogger } = require('../utils/logger');

const logger = createLogger('request-tracking');

function getUserAgent(req) {
  return req.get('user-agent') || null;
}

function isPlatformProbe(req) {
  const userAgent = (getUserAgent(req) || '').toLowerCase();
  return userAgent.includes('healthcheck/1.0') || userAgent.includes('alwayson');
}

function getRequestLogLevel(req, statusCode) {
  if (statusCode >= 500) {
    return 'error';
  }

  if (statusCode >= 400) {
    return isPlatformProbe(req) ? 'debug' : 'warn';
  }

  if (isPlatformProbe(req)) {
    return 'debug';
  }

  return 'info';
}

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

  // Track when response is sent
  const originalSend = res.send;
  res.send = function(data) {
    const duration = Date.now() - startTime;

    logger[getRequestLogLevel(req, res.statusCode)]('Request completed', {
      correlationId: req.correlationId,
      method: req.method,
      path: req.path,
      status: res.statusCode,
      duration: `${duration}ms`,
      contentLength: res.get('content-length') || 'unknown',
      ip: req.ip,
      userAgent: getUserAgent(req)
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
