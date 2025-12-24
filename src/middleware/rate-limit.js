// ============================================================
// Rate Limiting Middleware (In-Memory)
// Limits requests per API key per time window
// Note: For distributed rate limiting across instances, use Redis
// ============================================================

const { createLogger } = require('../utils/logger');

const logger = createLogger('rate-limiting');

// Store: { apiKey: { count, resetTime } }
const rateLimitStore = new Map();

const DEFAULT_WINDOW_MS = 60 * 1000; // 1 minute
const DEFAULT_MAX_REQUESTS = 100; // 100 requests per minute

/**
 * In-memory rate limiter
 * - Tracks requests per API key
 * - Resets counter after time window
 * - Returns 429 when limit exceeded
 * 
 * Note: This is per-instance. Use Redis in production for distributed rate limiting.
 */
function rateLimiter(options = {}) {
  const windowMs = options.windowMs || DEFAULT_WINDOW_MS;
  const maxRequests = options.maxRequests || DEFAULT_MAX_REQUESTS;

  return (req, res, next) => {
    const apiKey = req.headers['x-api-key'] || req.ip; // Fall back to IP if no API key
    const now = Date.now();

    // Initialize or get existing record
    if (!rateLimitStore.has(apiKey)) {
      rateLimitStore.set(apiKey, { count: 0, resetTime: now + windowMs });
    }

    const record = rateLimitStore.get(apiKey);

    // Reset counter if window has passed
    if (now > record.resetTime) {
      record.count = 0;
      record.resetTime = now + windowMs;
    }

    // Increment counter
    record.count++;

    // Check if limit exceeded
    if (record.count > maxRequests) {
      const retryAfter = Math.ceil((record.resetTime - now) / 1000);
      
      logger.warn('Rate limit exceeded', {
        apiKey: apiKey.substring(0, 8) + '...',
        count: record.count,
        maxRequests,
        retryAfter
      });

      res.set('Retry-After', retryAfter);
      return res.status(429).json({
        error: {
          code: 'RATE_LIMIT_EXCEEDED',
          message: `Too many requests. Try again in ${retryAfter} seconds.`,
          retryAfter
        }
      });
    }

    // Add rate limit info to response headers
    res.set('X-RateLimit-Limit', maxRequests);
    res.set('X-RateLimit-Remaining', maxRequests - record.count);
    res.set('X-RateLimit-Reset', record.resetTime);

    next();
  };
}

/**
 * Clear rate limit store (useful for testing)
 */
function clearRateLimitStore() {
  rateLimitStore.clear();
}

module.exports = {
  rateLimiter,
  clearRateLimitStore
};
