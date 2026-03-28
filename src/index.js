// ============================================================
// GHIN Middleware API - Entry Point
// ============================================================

const fs = require('fs');
const path = require('path');

function safeStat(targetPath) {
  try {
    const stats = fs.statSync(targetPath);
    return {
      exists: true,
      isDirectory: stats.isDirectory(),
      size: stats.size
    };
  } catch {
    return { exists: false };
  }
}

function listEntries(targetPath, limit = 20) {
  try {
    return fs.readdirSync(targetPath).slice(0, limit);
  } catch (error) {
    return [`<unavailable: ${error.message}>`];
  }
}

function logStartupRequireFailure(moduleName, error) {
  const appRoot = path.resolve(__dirname, '..');
  const nodeModulesPath = path.join(appRoot, 'node_modules');
  const expressPackagePath = path.join(nodeModulesPath, 'express', 'package.json');
  const diagnostics = {
    moduleName,
    errorMessage: error.message,
    errorCode: error.code,
    nodeVersion: process.version,
    cwd: process.cwd(),
    dirname: __dirname,
    appRoot,
    entrypoint: __filename,
    packageJson: safeStat(path.join(appRoot, 'package.json')),
    nodeModules: safeStat(nodeModulesPath),
    expressPackage: safeStat(expressPackagePath),
    resolvePaths: typeof require.resolve.paths === 'function' ? require.resolve.paths(moduleName) : null,
    appRootEntries: listEntries(appRoot),
    srcEntries: listEntries(__dirname)
  };

  console.error('[startup] module resolution failure', JSON.stringify(diagnostics, null, 2));
}

function safeRequire(moduleName) {
  try {
    return require(moduleName);
  } catch (error) {
    logStartupRequireFailure(moduleName, error);
    throw error;
  }
}

const express = safeRequire('express');
const cors = safeRequire('cors');
const helmet = safeRequire('helmet');
const { createLogger } = safeRequire('./utils/logger');
const { initializeAppInsights, trackEvent } = safeRequire('./utils/appinsights');
const config = safeRequire('./config');
const { conditionalAuth } = safeRequire('./middleware/auth');
const { validateRequest, sanitizeHeaders } = safeRequire('./middleware/validation');
const { addCorrelationId, trackRequestMetrics } = safeRequire('./middleware/tracking');
const { rateLimiter } = safeRequire('./middleware/rate-limit');
const database = safeRequire('./services/database');
const redis = safeRequire('./services/redis');
const { loadSecrets } = safeRequire('./config/secrets');
const { startReconciliationScheduler } = safeRequire('./services/reconciliationScheduler');

async function initializeSecrets() {
  if (process.env.NODE_ENV === 'test') {
    return { loaded: false, source: 'test' };
  }

  try {
    const secrets = await loadSecrets();
    Object.assign(process.env, secrets);
    return { loaded: true, source: 'key-vault-or-local' };
  } catch (error) {
    return { loaded: false, source: 'process-env', warning: error.message };
  }
}

const app = express();
const logger = createLogger('app');

// ============================================================
// Middleware
// ============================================================

app.use(helmet()); // Security headers

// CORS configuration - only allow golfmatch-api and local dev
const corsOptions = {
  origin: (origin, callback) => {
    const allowedOrigins = [
      'https://golfmatch-api.azurewebsites.net',
      'https://api.golfmatch.claytoncobb.com',
      'https://golfmatch-web.azurewebsites.net',
      'http://localhost:5000',
      'http://localhost:5001',
      'http://localhost:5173'
    ];
    
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('CORS not allowed'), false);
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'X-API-Key', 'Authorization', 'X-GHIN-Webhook-Token'],
  maxAge: 86400
};

app.use(cors(corsOptions));
app.use(express.json({ limit: '10mb' })); // Parse JSON bodies with size limit
app.use(sanitizeHeaders); // Sanitize headers
app.use(addCorrelationId); // Add correlation ID for request tracking
app.use(trackRequestMetrics); // Track request metrics and timing
app.use(validateRequest); // Validate request structure
app.use(conditionalAuth); // API Key authentication (except /health and /)
app.use(rateLimiter({ windowMs: 60000, maxRequests: 100 })); // Rate limiting

// ============================================================
// Routes
// ============================================================

const healthRouter = require('./routes/health');
const playersRouter = require('./routes/players');
const coursesRouter = require('./routes/courses');
const scoresRouter = require('./routes/scores');
const webhooksRouter = require('./routes/webhooks');

app.use('/api/v1/health', healthRouter);
app.use('/api/v1/players', playersRouter);
app.use('/api/v1/courses', coursesRouter);
app.use('/api/v1/scores', scoresRouter);
app.use('/api/v1/webhooks', webhooksRouter);

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

async function bootstrap() {
  if (process.env.NODE_ENV === 'test') {
    return;
  }

  const secretStatus = await initializeSecrets();
  if (secretStatus.warning) {
    logger.warn('Secrets loader fallback in use', { warning: secretStatus.warning });
  }

  // Initialize Application Insights after secrets are loaded/fallback is known.
  initializeAppInsights();

  // Lazy-initialize optional services in background (do not block readiness).
  setImmediate(async () => {
    try {
      await database.connect();
    } catch (error) {
      logger.warn('Database background connect failed', { error: error.message });
    }

    if (config.redis.host) {
      try {
        await redis.connect();
      } catch (error) {
        logger.warn('Redis background connect failed', { error: error.message });
      }
    }
  });

  app.listen(PORT, () => {
    const ghinMode = config.ghin.useMock ? 'MOCK' : 'LIVE';
    const dbConfigured = Boolean(process.env.GHIN_CACHE_DB_SERVER && process.env.GHIN_CACHE_DB_NAME);
    const reconciliationScheduler = startReconciliationScheduler();

    logger.info('Startup summary', {
      port: PORT,
      environment: config.env,
      ghinMode,
      dbConfigured,
      redisConfigured: Boolean(config.redis.host),
      secretsLoaded: secretStatus.loaded,
      secretsSource: secretStatus.source,
      reconciliationScheduler
    });
    logger.info(`GHIN Middleware API listening on port ${PORT}`);
    logger.info('✅ Startup complete - middleware is ready to accept requests');

    trackEvent('ApplicationStartup', {
      port: PORT.toString(),
      environment: config.env,
      ghinMode,
      dbConfigured: String(dbConfigured),
      secretsLoaded: String(secretStatus.loaded)
    });
  });
}

bootstrap().catch((error) => {
  logger.error('Startup failed', { error: error.message, stack: error.stack });
  process.exit(1);
});

module.exports = app;
