const { isAppServiceRuntime } = require('./appServiceRuntime');

/**
 * The browser origins allowed to call the middleware. In Azure App Service they come only from the
 * MIDDLEWARE_ALLOWED_ORIGINS app setting (comma-separated exact origins); a missing or empty list stops startup.
 * A local run (Hold2's laptop) always allows the fixed local web, API and middleware ports; nothing is set up locally.
 */
const LOCAL_ALLOWED_ORIGINS = Object.freeze([
  'http://localhost:5173',
  'http://localhost:5000',
  'http://localhost:5001',
]);

function readAllowedOrigins() {
  if (!isAppServiceRuntime()) {
    return [...LOCAL_ALLOWED_ORIGINS];
  }

  const rawOrigins = process.env.MIDDLEWARE_ALLOWED_ORIGINS;
  if (typeof rawOrigins !== 'string' || !rawOrigins.trim()) {
    throw new Error('MIDDLEWARE_ALLOWED_ORIGINS is not set; list the allowed CORS origins, comma-separated');
  }

  const origins = rawOrigins.split(',').map((origin) => origin.trim());
  origins.forEach((origin) => {
    const parsed = new URL(origin);
    if (parsed.origin !== origin) {
      throw new Error(`MIDDLEWARE_ALLOWED_ORIGINS entry ${origin} is not an exact origin (scheme://host[:port])`);
    }
  });
  return origins;
}

module.exports = { readAllowedOrigins, LOCAL_ALLOWED_ORIGINS };
