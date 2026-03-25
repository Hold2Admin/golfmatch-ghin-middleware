// ============================================================
// Configuration Loader
// ============================================================

// Note: Secrets are loaded from Key Vault via src/config/secrets.js
// process.env is populated either by:
// - Azure App Service (production) with Key Vault references
// - loadSecrets() in development (Key Vault or .env.local fallback)

function parseBoolean(value) {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.trim().toLowerCase();
  if (normalized === 'true' || normalized === '1' || normalized === 'yes') {
    return true;
  }
  if (normalized === 'false' || normalized === '0' || normalized === 'no') {
    return false;
  }

  return null;
}

function shouldUseMockMode() {
  // Explicit override wins when provided.
  const override = parseBoolean(process.env.GHIN_USE_MOCK);
  if (override !== null) {
    return override;
  }

  // Default: live mode when sandbox credentials exist.
  return !(process.env.GHIN_SANDBOX_EMAIL && process.env.GHIN_SANDBOX_PASSWORD);
}

module.exports = {
  // Server
  port: process.env.PORT || 5001,
  env: process.env.NODE_ENV || 'development',

  // Database (Middleware Cache)
  db: {
    server: process.env.GHIN_CACHE_DB_SERVER,
    database: process.env.GHIN_CACHE_DB_NAME,
    user: process.env.GHIN_CACHE_DB_USER,
    password: process.env.GHIN_CACHE_DB_PASSWORD,
    options: {
      encrypt: true,
      trustServerCertificate: false,
      connectionTimeout: 30000,
      requestTimeout: 30000
    }
  },

  // Redis Cache
  redis: {
    host: process.env.REDIS_HOST,
    password: process.env.REDIS_PASSWORD,
    port: parseInt(process.env.REDIS_PORT) || 6380,
    tls: process.env.REDIS_TLS_ENABLED === 'true',
    connectTimeout: 10000
  },

  // GHIN API
  ghin: {
    baseUrl: process.env.GHIN_API_BASE_URL || 'https://api.ghin.com/v2',
    sandboxEmail: process.env.GHIN_SANDBOX_EMAIL,
    sandboxPassword: process.env.GHIN_SANDBOX_PASSWORD,
    timeout: parseInt(process.env.GHIN_API_TIMEOUT_MS) || 10000,
    maxRps: parseInt(process.env.GHIN_API_MAX_RPS) || 20,
    get useMock() {
      return shouldUseMockMode();
    }
  },

  // Fore Play API
  foreplay: {
    baseUrl: process.env.FOREPLAY_API_BASE_URL,
    apiKey: process.env.FOREPLAY_API_KEY
  },

  // Rate Limiting
  rateLimit: {
    requestsPerMin: parseInt(process.env.RATE_LIMIT_REQUESTS_PER_MIN) || 100,
    requestsPerDay: parseInt(process.env.RATE_LIMIT_REQUESTS_PER_DAY) || 5000
  },

  // Cache TTLs (in seconds)
  cache: {
    playerTTL: parseInt(process.env.PLAYER_CACHE_TTL) || 86400, // 24 hours
    courseTTL: parseInt(process.env.COURSE_CACHE_TTL) || 2592000, // 30 days
    searchTTL: parseInt(process.env.SEARCH_CACHE_TTL) || 3600 // 1 hour
  },

  // Security
  security: {
    apiKeyHashSecret: process.env.API_KEY_HASH_SECRET,
    middlewareSecret: process.env.GHIN_MIDDLEWARE_SECRET
  },

  // Logging
  logging: {
    level: process.env.LOG_LEVEL || 'info',
    auditRetentionDays: parseInt(process.env.AUDIT_LOG_RETENTION_DAYS) || 90
  },

  // Azure Key Vault
  keyVault: {
    url: process.env.KEY_VAULT_URL || 'https://golfmatch-secrets.vault.azure.net'
  }
};
