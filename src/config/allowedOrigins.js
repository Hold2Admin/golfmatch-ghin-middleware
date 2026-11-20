/**
 * The browser origins allowed to call the middleware: MIDDLEWARE_ALLOWED_ORIGINS,
 * a comma-separated list of exact origins (the App Service setting in Azure,
 * .env.local in development, loaded by src/config/localEnv.js). One reader; a missing or empty list stops startup.
 */
function readAllowedOrigins() {
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

module.exports = { readAllowedOrigins };
