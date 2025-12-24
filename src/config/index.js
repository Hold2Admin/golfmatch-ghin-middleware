// ============================================================
// Configuration Loader
// ============================================================

// Note: Secrets are loaded from Key Vault via src/config/secrets.js
// process.env is populated either by:
// - Azure App Service (production) with Key Vault references
// - loadSecrets() in development (Key Vault or .env.local fallback)

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
    apiKey: process.env.GHIN_API_KEY,
    timeout: parseInt(process.env.GHIN_API_TIMEOUT_MS) || 10000,
    maxRps: parseInt(process.env.GHIN_API_MAX_RPS) || 20,
    useMock: !process.env.GHIN_API_KEY || process.env.GHIN_API_KEY === 'your-ghin-api-key-here'
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
