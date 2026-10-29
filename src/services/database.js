// ============================================================
// Database Service
// ============================================================

const sql = require('mssql');
const { SQL_POOL_MAIN } = require('../config/sqlPoolConfig');
const config = require('../config');
const { createLogger } = require('../utils/logger');

const logger = createLogger('database');
const { trackDependency } = require('../utils/appinsights');

const SLOW_SQL_LOG_MS = Number(process.env.SLOW_SQL_LOG_MS || 1000);
const SLOW_ACQUIRE_LOG_MS = Number(process.env.SLOW_SQL_ACQUIRE_LOG_MS || 250);

function poolStats() {
  const p = pool && pool.pool;
  if (!p || typeof p.numUsed !== 'function') return {};
  return {
    used: p.numUsed(),
    free: p.numFree(),
    pendingAcquires: p.numPendingAcquires(),
    pendingCreates: p.numPendingCreates()
  };
}

function sqlLabel(text) {
  const flat = String(text || '').replace(/\s+/g, ' ').trim();
  const verb = (flat.match(/^(?:WITH\b.*?\)\s*)?(\w+)/i) || [])[1] || 'SQL';
  const table = (flat.match(/\b(?:FROM|INTO|UPDATE|MERGE(?:\s+INTO)?|JOIN|TABLE)\s+([\w.\[\]#]+)/i) || [])[1] || '';
  return `${verb.toUpperCase()} ${table}`.trim();
}

let mssqlInstrumented = false;
// Every mssql Request (pool, transaction, prepared) reports as a SQL dependency on the
// current request, and anything slow is logged with the pool state around it.
function instrumentMssql() {
  if (mssqlInstrumented) return;
  mssqlInstrumented = true;
  for (const method of ['query', 'batch', 'execute']) {
    const original = sql.Request.prototype[method];
    if (typeof original !== 'function') continue;
    sql.Request.prototype[method] = function instrumented(command, ...rest) {
      if (typeof rest[rest.length - 1] === 'function') {
        return original.call(this, command, ...rest);
      }
      const started = Date.now();
      const before = poolStats();
      const name = method === 'execute' ? `EXEC ${command}` : sqlLabel(command);
      const target = `${process.env.GHIN_CACHE_DB_SERVER || config.db.server || 'sql'} | ${process.env.GHIN_CACHE_DB_NAME || config.db.database || ''}`;
      const finish = (ok, error) => {
        const durationMs = Date.now() - started;
        const after = poolStats();
        trackDependency(target, name, durationMs, ok, ok ? 0 : (error && (error.number || error.code)) || 1, {
          type: 'SQL',
          data: String(command || '').replace(/\s+/g, ' ').slice(0, 1000),
          properties: { poolBefore: JSON.stringify(before), poolAfter: JSON.stringify(after) }
        });
        if (!ok || durationMs >= SLOW_SQL_LOG_MS) {
          logger[ok ? 'warn' : 'error'](ok ? 'Slow SQL' : 'SQL failed', {
            name, durationMs, poolBefore: before, poolAfter: after,
            error: error ? error.message : undefined
          });
        }
      };
      const result = original.call(this, command, ...rest);
      if (!result || typeof result.then !== 'function') return result;
      return result.then((value) => { finish(true); return value; }, (error) => { finish(false, error); throw error; });
    };
  }
}
instrumentMssql();

// Connection lifecycle from the underlying pool: opens, failures, closes, and slow waits
// for a free connection. This is what shows a dead/cold pool reconnecting.
function attachPoolDiagnostics(connectedPool) {
  const tarn = connectedPool && connectedPool.pool;
  if (!tarn || typeof tarn.on !== 'function' || tarn.__fpDiagnostics) return;
  tarn.__fpDiagnostics = true;
  const createStarts = new Map();
  const acquireStarts = new Map();
  tarn.on('createRequest', (eventId) => createStarts.set(eventId, Date.now()));
  tarn.on('createSuccess', (eventId) => {
    const ms = Date.now() - (createStarts.get(eventId) || Date.now());
    createStarts.delete(eventId);
    logger.info('SQL connection opened', { durationMs: ms, pool: poolStats() });
  });
  tarn.on('createFail', (eventId, error) => {
    const ms = Date.now() - (createStarts.get(eventId) || Date.now());
    createStarts.delete(eventId);
    logger.error('SQL connection open failed', { durationMs: ms, error: error && error.message, pool: poolStats() });
  });
  tarn.on('destroySuccess', () => logger.info('SQL connection closed', { pool: poolStats() }));
  tarn.on('acquireRequest', (eventId) => acquireStarts.set(eventId, Date.now()));
  tarn.on('acquireSuccess', (eventId) => {
    const ms = Date.now() - (acquireStarts.get(eventId) || Date.now());
    acquireStarts.delete(eventId);
    if (ms >= SLOW_ACQUIRE_LOG_MS) {
      logger.warn('Slow SQL connection acquire', { durationMs: ms, pool: poolStats() });
    }
  });
  tarn.on('acquireFail', (eventId, error) => {
    const ms = Date.now() - (acquireStarts.get(eventId) || Date.now());
    acquireStarts.delete(eventId);
    logger.error('SQL connection acquire failed', { durationMs: ms, error: error && error.message, pool: poolStats() });
  });
  connectedPool.on('error', (error) => {
    logger.error('SQL pool error', { error: error && error.message, pool: poolStats() });
  });
}
let pool = null;
let isConnected = false;
let hasLoggedMissingConfig = false;

function getRuntimeDbConfig() {
  const server = process.env.GHIN_CACHE_DB_SERVER || config.db.server;
  const database = process.env.GHIN_CACHE_DB_NAME || config.db.database;
  const user = process.env.GHIN_CACHE_DB_USER || config.db.user;
  const password = process.env.GHIN_CACHE_DB_PASSWORD || config.db.password;

  return {
    server,
    database,
    user,
    password,
    options: config.db.options,
    pool: { ...SQL_POOL_MAIN }
  };
}

function getMissingDbConfigFields(dbConfig) {
  const missing = [];
  if (!dbConfig.server) {
    missing.push('GHIN_CACHE_DB_SERVER');
  }
  if (!dbConfig.database) {
    missing.push('GHIN_CACHE_DB_NAME');
  }
  if (!dbConfig.user) {
    missing.push('GHIN_CACHE_DB_USER');
  }
  if (!dbConfig.password) {
    missing.push('GHIN_CACHE_DB_PASSWORD');
  }
  return missing;
}

/**
 * Initialize database connection pool
 */
async function connect() {
  if (pool && isConnected) {
    return pool;
  }

  try {
    const dbConfig = getRuntimeDbConfig();

    const missing = getMissingDbConfigFields(dbConfig);

    // Skip DB if required config is missing
    if (missing.length > 0) {
      if (!hasLoggedMissingConfig) {
        logger.warn('Database configuration missing; cache DB disabled until env is set', {
          missing,
          requiredForMode: 'DATABASE'
        });
        hasLoggedMissingConfig = true;
      }
      return null;
    }

    const connectStarted = Date.now();
    pool = await sql.connect(dbConfig);
    isConnected = true;
    hasLoggedMissingConfig = false;
    attachPoolDiagnostics(pool);
    logger.info('Database pool connected', {
      server: dbConfig.server, database: dbConfig.database,
      durationMs: Date.now() - connectStarted, pool: poolStats()
    });
    return pool;
  } catch (error) {
    logger.error('Database connection failed', { error: error.message, code: error.code });
    isConnected = false;
    throw error;
  }
}

/**
 * Check database health
 */
async function checkHealth() {
  if (!pool || !isConnected) {
    return { status: 'not_configured', connected: false };
  }

  try {
    const dbConfig = getRuntimeDbConfig();
    const result = await pool.request().query('SELECT 1 AS health');
    return { 
      status: 'healthy', 
      connected: true,
      server: dbConfig.server,
      database: dbConfig.database
    };
  } catch (error) {
    logger.error('Database health check failed', { error: error.message });
    return { 
      status: 'unhealthy', 
      connected: false, 
      error: error.message 
    };
  }
}

/**
 * Close database connection
 */
async function close() {
  if (pool) {
    await pool.close();
    pool = null;
    isConnected = false;
    logger.info('Database connection closed');
  }
}

/**
 * Get connection pool
 */
function getPool() {
  return pool;
}

/**
 * Execute a parameterized query against the configured middleware DB.
 */
async function query(sqlQuery, params = {}) {
  const activePool = await connect();
  if (!activePool) {
    const missing = getMissingDbConfigFields(getRuntimeDbConfig());
    throw new Error(`Database not configured (${missing.join(', ')})`);
  }

  const request = activePool.request();

  Object.entries(params).forEach(([key, value]) => {
    if (value && typeof value === 'object' && 'type' in value && 'value' in value) {
      request.input(key, value.type, value.value);
    } else {
      request.input(key, value);
    }
  });

  const result = await request.query(sqlQuery);
  return result.recordset;
}

/**
 * Execute a parameterized batch of several SELECTs in one round trip; returns every result set in order.
 */
async function queryRecordsets(sqlQuery, params = {}) {
  const activePool = await connect();
  if (!activePool) {
    const missing = getMissingDbConfigFields(getRuntimeDbConfig());
    throw new Error(`Database not configured (${missing.join(', ')})`);
  }

  const request = activePool.request();

  Object.entries(params).forEach(([key, value]) => {
    if (value && typeof value === 'object' && 'type' in value && 'value' in value) {
      request.input(key, value.type, value.value);
    } else {
      request.input(key, value);
    }
  });

  const result = await request.query(sqlQuery);
  return result.recordsets;
}

module.exports = {
  connect,
  checkHealth,
  close,
  getPool,
  query,
  queryRecordsets,
  sql
};
