// ============================================================
// Database Service
// ============================================================

const sql = require('mssql');
const config = require('../config');
const { createLogger } = require('../utils/logger');

const logger = createLogger('database');
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
    pool: {
      max: 10,
      min: 0,
      idleTimeoutMillis: 30000
    }
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

    pool = await sql.connect(dbConfig);
    isConnected = true;
    hasLoggedMissingConfig = false;
    logger.info(`Database connected: ${dbConfig.server}/${dbConfig.database}`);
    return pool;
  } catch (error) {
    logger.error('Database connection failed', { error: error.message });
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

module.exports = {
  connect,
  checkHealth,
  close,
  getPool,
  query,
  sql
};
