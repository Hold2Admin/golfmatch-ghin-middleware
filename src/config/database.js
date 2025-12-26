const sql = require('mssql');
const { createLogger } = require('../utils/logger');
const logger = createLogger('database');

let pool = null;

/**
 * Get database configuration from environment variables
 */
function getDbConfig() {
  return {
    server: process.env.AZURE_SQL_SERVER,
    database: process.env.AZURE_SQL_DATABASE,
    user: process.env.AZURE_SQL_USER,
    password: process.env.AZURE_SQL_PASSWORD,
    options: {
      encrypt: true,
      trustServerCertificate: false,
      enableArithAbort: true,
      connectTimeout: 30000,
      requestTimeout: 30000
    },
    pool: {
      max: 10,
      min: 0,
      idleTimeoutMillis: 30000
    }
  };
}

/**
 * Get or create SQL connection pool
 */
async function getPool() {
  if (pool && pool.connected) {
    return pool;
  }

  try {
    const config = getDbConfig();
    logger.info('Connecting to GHIN mock database', {
      server: config.server,
      database: config.database
    });

    pool = await sql.connect(config);
    logger.info('✅ Connected to GHIN mock database');
    
    return pool;
  } catch (error) {
    logger.error('❌ Database connection failed', { error: error.message });
    throw error;
  }
}

/**
 * Execute a query against the GHIN mock database
 */
async function query(sqlQuery, params = {}) {
  try {
    const pool = await getPool();
    const request = pool.request();
    
    // Bind parameters (supports typed and untyped)
    Object.entries(params).forEach(([key, value]) => {
      if (value && typeof value === 'object' && 'type' in value && 'value' in value) {
        request.input(key, value.type, value.value);
      } else {
        request.input(key, value);
      }
    });
    
    const result = await request.query(sqlQuery);
    return result.recordset;
  } catch (error) {
    logger.error('Query execution failed', { 
      error: error.message,
      query: sqlQuery.substring(0, 100) 
    });
    throw error;
  }
}

/**
 * Close database connection pool
 */
async function closePool() {
  if (pool) {
    await pool.close();
    pool = null;
    logger.info('Database connection pool closed');
  }
}

module.exports = {
  getPool,
  query,
  closePool,
  sql // Export sql types for parameter binding
};
