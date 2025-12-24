// ============================================================
// API Key Authentication Middleware
// Validates X-API-Key header against Key Vault secret
// ============================================================

const { createLogger } = require('../utils/logger');

const logger = createLogger('auth-middleware');

/**
 * API Key Authentication Middleware
 * - Validates X-API-Key header
 * - Rejects requests without valid key
 * - Tracks authentication attempts for audit
 */
function apiKeyAuth(req, res, next) {
  const apiKey = req.headers['x-api-key'];
  const expectedKey = process.env.GHIN_MIDDLEWARE_API_KEY;

  // Log request for audit trail
  logger.debug('Authentication attempt', {
    path: req.path,
    method: req.method,
    hasApiKey: !!apiKey,
    ip: req.ip,
    userAgent: req.get('user-agent')
  });

  // Check if API key is present
  if (!apiKey) {
    logger.warn('Missing API key', {
      path: req.path,
      ip: req.ip
    });
    return res.status(401).json({
      error: {
        code: 'MISSING_API_KEY',
        message: 'X-API-Key header is required'
      }
    });
  }

  // Validate API key (constant-time comparison to prevent timing attacks)
  const isValid = constantTimeCompare(apiKey, expectedKey);

  if (!isValid) {
    logger.warn('Invalid API key', {
      path: req.path,
      ip: req.ip,
      keyLength: apiKey.length
    });
    return res.status(403).json({
      error: {
        code: 'INVALID_API_KEY',
        message: 'Invalid API key'
      }
    });
  }

  logger.debug('API key validated', {
    path: req.path,
    method: req.method
  });

  // Key is valid, continue to next middleware
  next();
}

/**
 * Constant-time string comparison to prevent timing attacks
 * @param {string} a
 * @param {string} b
 * @returns {boolean}
 */
function constantTimeCompare(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') {
    return false;
  }

  if (a.length !== b.length) {
    return false;
  }

  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

/**
 * Endpoint exclusions - routes that don't require API key
 * Health check is public for load balancers
 */
const excludedPaths = ['/api/v1/health', '/'];

/**
 * Conditional auth middleware
 * Applies auth to protected routes, skips public routes
 */
function conditionalAuth(req, res, next) {
  // Skip auth for excluded paths
  if (excludedPaths.includes(req.path)) {
    return next();
  }

  // Apply auth to all other routes
  apiKeyAuth(req, res, next);
}

module.exports = {
  apiKeyAuth,
  conditionalAuth,
  constantTimeCompare
};
