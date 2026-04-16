// ============================================================
// GHIN Middleware API - Entry Point
// ============================================================

const fs = require('fs');
const path = require('path');
const { Worker } = require('worker_threads');

const startupClock = {
  processStartMs: Date.now(),
  processStartIso: new Date().toISOString()
};

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

const startupDiagnosticsOverride = parseBoolean(process.env.STARTUP_DIAGNOSTICS);
const startupDiagnosticsEnabled = startupDiagnosticsOverride !== null
  ? startupDiagnosticsOverride
  : (process.env.NODE_ENV || 'development') !== 'development';
const startupFailFastTimeoutMs = Number(process.env.STARTUP_FAIL_FAST_TIMEOUT_MS || 90000);
const startupFailFastEnabled = (process.env.NODE_ENV || 'development') !== 'test'
  && Number.isFinite(startupFailFastTimeoutMs)
  && startupFailFastTimeoutMs > 0;
const startupWatchdogState = startupFailFastEnabled ? new Int32Array(new SharedArrayBuffer(4)) : null;
let startupWatchdog = null;

function noteStartupProgress() {
  if (!startupWatchdogState) {
    return;
  }

  Atomics.store(startupWatchdogState, 0, Math.floor(Date.now() / 1000));
}

function stopStartupWatchdog() {
  if (startupWatchdog) {
    startupWatchdog.terminate().catch(() => {});
    startupWatchdog = null;
  }
}

function startStartupWatchdog() {
  if (!startupFailFastEnabled || !startupWatchdogState) {
    return;
  }

  noteStartupProgress();
  startupWatchdog = new Worker(`
    const { workerData } = require('worker_threads');
    const state = new Int32Array(workerData.sharedBuffer);
    const timeoutSeconds = Math.max(1, Math.ceil(workerData.timeoutMs / 1000));
    const checkIntervalMs = Math.min(5000, Math.max(1000, Math.floor(workerData.timeoutMs / 4)));
    const siteName = workerData.siteName || 'ghin-middleware';

    const timer = setInterval(() => {
      const lastProgressSeconds = Atomics.load(state, 0);
      const ageSeconds = Math.floor(Date.now() / 1000) - lastProgressSeconds;

      if (ageSeconds < timeoutSeconds) {
        return;
      }

      console.error('[startup-phase]', JSON.stringify({
        phase: 'startup-fail-fast-timeout',
        at: new Date().toISOString(),
        timeoutMs: workerData.timeoutMs,
        stalledForMs: ageSeconds * 1000,
        siteName
      }));

      clearInterval(timer);

      try {
        process.kill(process.pid, 'SIGTERM');
      } catch (_) {
        process.exit(1);
      }
    }, checkIntervalMs);

    timer.unref();
  `, {
    eval: true,
    workerData: {
      sharedBuffer: startupWatchdogState.buffer,
      timeoutMs: startupFailFastTimeoutMs,
      siteName: process.env.WEBSITE_SITE_NAME || 'ghin-middleware'
    }
  });

  startupWatchdog.unref();
  startupWatchdog.on('error', (error) => {
    console.error('[startup-phase]', JSON.stringify({
      phase: 'startup-watchdog-error',
      at: new Date().toISOString(),
      error: error.message
    }));
  });

  if (startupDiagnosticsEnabled) {
    console.log('[startup-phase]', JSON.stringify({
      phase: 'startup-watchdog-start',
      at: new Date().toISOString(),
      elapsedMs: getStartupElapsedMs(),
      timeoutMs: startupFailFastTimeoutMs
    }));
  }
}

function getStartupElapsedMs() {
  return Date.now() - startupClock.processStartMs;
}

function logStartupPhase(phase, details = {}) {
  noteStartupProgress();

  if (!startupDiagnosticsEnabled) {
    return;
  }

  console.log('[startup-phase]', JSON.stringify({
    phase,
    at: new Date().toISOString(),
    elapsedMs: getStartupElapsedMs(),
    ...details
  }));
}

logStartupPhase('node-entry', {
  processStartIso: startupClock.processStartIso,
  pid: process.pid,
  nodeVersion: process.version
});
startStartupWatchdog();

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
  logStartupPhase('require-start', { moduleName });

  try {
    const loadedModule = require(moduleName);
    logStartupPhase('require-complete', { moduleName });
    return loadedModule;
  } catch (error) {
    logStartupPhase('require-failed', {
      moduleName,
      error: error.message,
      errorCode: error.code || null
    });
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
const { getRuntimeInfo } = safeRequire('./utils/runtimeInfo');

logStartupPhase('module-load-complete');

async function initializeSecrets() {
  if (process.env.NODE_ENV === 'test') {
    return { loaded: false, source: 'test' };
  }

  try {
    const secrets = await loadSecrets();
    Object.assign(process.env, secrets);

    // Sandbox override: GHIN_ENVIRONMENT=sandbox flips outbound GHIN calls to the
    // sandbox endpoint. Default (nothing set) uses Key Vault's GHIN-API-BASE-URL,
    // which is the staging URL.
    if (process.env.GHIN_ENVIRONMENT === 'sandbox') {
      process.env.GHIN_API_BASE_URL = 'https://app-sandbox.hcp2020.com/api/v1';
    }

    return { loaded: true, source: 'key-vault-or-local' };
  } catch (error) {
    return { loaded: false, source: 'process-env', warning: error.message };
  }
}

const app = express();
const logger = createLogger('app');

logStartupPhase('app-created');

function isWebhookRequest(req) {
  return typeof req.path === 'string' && req.path.startsWith('/api/v1/webhooks/');
}

function logWebhookIngress(req, _res, next) {
  if (isWebhookRequest(req)) {
    logger.info('Webhook ingress hit', {
      method: req.method,
      path: req.path,
      originalUrl: req.originalUrl,
      contentType: req.get('content-type') || null,
      contentLength: req.get('content-length') || null,
      ip: req.ip,
      userAgent: req.get('user-agent') || null
    });
  }

  next();
}

function isGeolocationCourseSearchRequest(req) {
  if (req.method !== 'POST') {
    return false;
  }

  const normalizedPath = typeof req.path === 'string' ? req.path.toLowerCase() : '';
  if (normalizedPath !== '/api/v1/courses/search') {
    return false;
  }

  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const query = req.query && typeof req.query === 'object' ? req.query : {};
  const latitude = body.latitude ?? body.lat ?? query.latitude ?? query.lat ?? null;
  const longitude = body.longitude ?? body.lng ?? query.longitude ?? query.lng ?? null;

  return latitude !== null && longitude !== null;
}

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
app.use(logWebhookIngress);
app.use(express.json({ limit: '10mb' })); // Parse JSON bodies with size limit
app.use(express.urlencoded({ extended: true, limit: '10mb' })); // Parse form bodies for inbound provider webhooks
app.use(sanitizeHeaders); // Sanitize headers
app.use(addCorrelationId); // Add correlation ID for request tracking
app.use(trackRequestMetrics); // Track request metrics and timing

// ============================================================
// Routes
// ============================================================

const healthRouter = require('./routes/health');
const playersRouter = require('./routes/players');
const coursesRouter = require('./routes/courses');
const scoresRouter = require('./routes/scores');
const webhooksRouter = require('./routes/webhooks');

app.use('/api/v1/webhooks', webhooksRouter);

app.use(validateRequest); // Validate request structure
app.use(conditionalAuth); // API Key authentication (except /health and /)
app.use(rateLimiter({
  windowMs: 60000,
  maxRequests: config.rateLimit.requestsPerMin,
  keyPrefix: 'default'
}));
app.use('/api/v1/scores', rateLimiter({
  windowMs: 60000,
  maxRequests: config.rateLimit.scoreRequestsPerMin,
  keyPrefix: 'scores'
}));
app.use((req, res, next) => {
  if (!isGeolocationCourseSearchRequest(req)) {
    return next();
  }

  return rateLimiter({
    windowMs: 60000,
    maxRequests: config.rateLimit.geolocationCourseSearchRequestsPerMin,
    keyPrefix: 'courses-geolocation'
  })(req, res, next);
});

app.use('/api/v1/health', healthRouter);
app.use('/api/v1/players', playersRouter);
app.use('/api/v1/courses', coursesRouter);
app.use('/api/v1/scores', scoresRouter);

// Root endpoint
app.get('/', (req, res) => {
  const runtimeInfo = getRuntimeInfo();
  res.json({
    service: 'GHIN Middleware API',
    version: runtimeInfo.appVersion,
    deployment: runtimeInfo,
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

  logStartupPhase('bootstrap-start', {
    environment: config.env,
    port: PORT
  });

  const secretsLoadStartedMs = Date.now();
  logStartupPhase('secrets-load-start');

  const secretStatus = await initializeSecrets();
  logStartupPhase('secrets-load-complete', {
    durationMs: Date.now() - secretsLoadStartedMs,
    loaded: secretStatus.loaded,
    source: secretStatus.source,
    usedWarningFallback: Boolean(secretStatus.warning)
  });

  if (secretStatus.warning) {
    logger.warn('Secrets loader fallback in use', { warning: secretStatus.warning });
  }

  // Lazy-initialize optional services in background (do not block readiness).
  setImmediate(async () => {
    logStartupPhase('background-service-init-start', {
      databaseConfigured: Boolean(process.env.GHIN_CACHE_DB_SERVER && process.env.GHIN_CACHE_DB_NAME),
      redisConfigured: Boolean(config.redis.host)
    });

    const dbConnectStartedMs = Date.now();
    try {
      await database.connect();
      logStartupPhase('background-database-connect-complete', {
        durationMs: Date.now() - dbConnectStartedMs
      });
    } catch (error) {
      logStartupPhase('background-database-connect-failed', {
        durationMs: Date.now() - dbConnectStartedMs,
        error: error.message
      });
      logger.warn('Database background connect failed', { error: error.message });
    }

    if (config.redis.host) {
      const redisConnectStartedMs = Date.now();
      try {
        await redis.connect();
        logStartupPhase('background-redis-connect-complete', {
          durationMs: Date.now() - redisConnectStartedMs
        });
      } catch (error) {
        logStartupPhase('background-redis-connect-failed', {
          durationMs: Date.now() - redisConnectStartedMs,
          error: error.message
        });
        logger.warn('Redis background connect failed', { error: error.message });
      }
    } else {
      logStartupPhase('background-redis-skip', {
        reason: 'not-configured'
      });
    }
  });

  const listenBindStartedMs = Date.now();
  logStartupPhase('listen-bind-start', { port: PORT });

  app.listen(PORT, () => {
    const ghinMode = config.ghin.useMock ? 'MOCK' : 'LIVE';
    const dbConfigured = Boolean(process.env.GHIN_CACHE_DB_SERVER && process.env.GHIN_CACHE_DB_NAME);
    const schedulerStartedMs = Date.now();
    const reconciliationScheduler = startReconciliationScheduler();
    const runtimeInfo = getRuntimeInfo();

    logStartupPhase('listen-ready', {
      port: PORT,
      bindDurationMs: Date.now() - listenBindStartedMs,
      schedulerInitDurationMs: Date.now() - schedulerStartedMs,
      uptimeSeconds: Number(process.uptime().toFixed(3))
    });
    stopStartupWatchdog();

    logger[startupDiagnosticsEnabled ? 'info' : 'debug']('Startup summary', {
      port: PORT,
      environment: config.env,
      ghinMode,
      dbConfigured,
      redisConfigured: Boolean(config.redis.host),
      secretsLoaded: secretStatus.loaded,
      secretsSource: secretStatus.source,
      reconciliationScheduler,
      deployment: runtimeInfo
    });
    logger.info(`✅ GHIN Middleware API listening on port ${PORT}`);
    const ghinEnvLabel = process.env.GHIN_API_BASE_URL?.includes('api-uat.ghin.com') ? 'Staging' : process.env.GHIN_API_BASE_URL?.includes('sandbox') ? 'Sandbox' : 'Unknown';
    logger.info(`🌐 GHIN environment: ${ghinEnvLabel} (${process.env.GHIN_API_BASE_URL})`);

    setImmediate(() => {
      const appInsightsStartedMs = Date.now();

      try {
        initializeAppInsights();
        logStartupPhase('appinsights-init-complete', {
          durationMs: Date.now() - appInsightsStartedMs
        });

        trackEvent('ApplicationStartup', {
          port: PORT.toString(),
          environment: config.env,
          ghinMode,
          dbConfigured: String(dbConfigured),
          secretsLoaded: String(secretStatus.loaded),
          deploymentVersion: runtimeInfo.deploymentVersion,
          commitSha: runtimeInfo.commitSha || ''
        });
      } catch (error) {
        logStartupPhase('appinsights-init-failed', {
          durationMs: Date.now() - appInsightsStartedMs,
          error: error.message
        });
        logger.warn('Application Insights background init failed', { error: error.message });
      }
    });
  });
}

bootstrap().catch((error) => {
  stopStartupWatchdog();
  logger.error('Startup failed', { error: error.message, stack: error.stack });
  process.exit(1);
});

module.exports = app;
