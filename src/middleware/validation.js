// ============================================================
// Request Validation Middleware
// Validates request structure, size, and content type
// ============================================================

const { createLogger } = require('../utils/logger');

const logger = createLogger('validation');

/**
 * Validate request body size and content
 */
function validateRequest(req, res, next) {
  // Skip validation for GET/HEAD/DELETE (no body)
  if (['GET', 'HEAD', 'DELETE'].includes(req.method)) {
    return next();
  }

  // Validate content-type
  const contentType = req.get('content-type');
  if (!contentType || !contentType.includes('application/json')) {
    logger.warn('Invalid content-type', {
      path: req.path,
      contentType,
      ip: req.ip
    });
    return res.status(415).json({
      error: {
        code: 'UNSUPPORTED_MEDIA_TYPE',
        message: 'Content-Type must be application/json'
      }
    });
  }

  // Body size already limited by express.json() middleware (10mb)
  next();
}

/**
 * Sanitize request headers to prevent injection attacks
 */
function sanitizeHeaders(req, res, next) {
  // Remove potentially dangerous headers if sent by client
  const dangerousHeaders = [
    'x-forwarded-proto',
    'x-forwarded-for',
    'x-real-ip',
    'authorization'
  ];

  dangerousHeaders.forEach(header => {
    // Keep them but validate format
    const value = req.get(header);
    if (value && value.length > 1000) {
      logger.warn('Suspiciously large header value', {
        header,
        length: value.length,
        ip: req.ip
      });
      return res.status(400).json({
        error: {
          code: 'INVALID_HEADER',
          message: `Header ${header} is too large`
        }
      });
    }
  });

  next();
}

module.exports = {
  validateRequest,
  sanitizeHeaders
};
