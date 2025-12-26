async function connect() {
  return;
}

module.exports = { connect };
// ============================================================
// Database Service
// ============================================================

const sql = require('mssql');
const config = require('../config');
const { createLogger } = require('../utils/logger');

const logger = createLogger('database');
let pool = null;
let isConnected = false;

/**
 * Initialize database connection pool
 */
async function connect() {
  if (pool && isConnected) {
    return pool;
  }

  try {
    // Skip DB if not configured
    if (!config.db.server || !config.db.database) {
      logger.info('Database not configured, skipping connection');
      return null;
    }

    const dbConfig = {
      server: config.db.server,
      database: config.db.database,
      user: config.db.user,
      password: config.db.password,
      options: config.db.options,
      pool: {
        max: 10,
        min: 0,
        idleTimeoutMillis: 30000
      }
    };

    pool = await sql.connect(dbConfig);
    isConnected = true;
    logger.info(`Database connected: ${config.db.server}/${config.db.database}`);
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
    const result = await pool.request().query('SELECT 1 AS health');
    return { 
      status: 'healthy', 
      connected: true,
      server: config.db.server,
      database: config.db.database
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

module.exports = {
  connect,
  checkHealth,
  close,
  getPool
};
