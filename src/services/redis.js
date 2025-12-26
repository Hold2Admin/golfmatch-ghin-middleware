// ============================================================
// Redis Cache Service
// ============================================================

const redis = require('redis');
const config = require('../config');
const { createLogger } = require('../utils/logger');

const logger = createLogger('redis');
let client = null;
let isConnected = false;

/**
 * Initialize Redis connection
 */
async function connect() {
  if (client && isConnected) {
    return client;
  }

  // Skip Redis if not configured or in test mode
  if (!config.redis.host || process.env.NODE_ENV === 'test') {
    return null;
  }

  try {

    const redisConfig = {
      socket: {
        host: config.redis.host,
        port: config.redis.port,
        tls: config.redis.tls,
        connectTimeout: config.redis.connectTimeout,
        reconnectStrategy: false // Don't auto-reconnect
      }
    };

    if (config.redis.password) {
      redisConfig.password = config.redis.password;
    }

    client = redis.createClient(redisConfig);

    client.on('error', (err) => {
      // Suppress errors if not connected (likely config issue)
      if (isConnected) {
        logger.error('Redis client error', { error: err.message });
      }
      isConnected = false;
    });

    client.on('connect', () => {
      logger.info(`Redis connected: ${config.redis.host}:${config.redis.port}`);
      isConnected = true;
    });

    client.on('disconnect', () => {
      logger.warn('Redis disconnected');
      isConnected = false;
    });

    await client.connect();
    return client;
  } catch (error) {
    logger.error('Redis connection failed', { error: error.message });
    isConnected = false;
    return null;
  }
}

/**
 * Check Redis health
 */
async function checkHealth() {
  if (!client || !isConnected) {
    return { status: 'not_configured', connected: false };
  }

  try {
    const pong = await client.ping();
    return { 
      status: 'healthy', 
      connected: true,
      host: config.redis.host,
      port: config.redis.port,
      response: pong
    };
  } catch (error) {
    logger.error('Redis health check failed', { error: error.message });
    return { 
      status: 'unhealthy', 
      connected: false, 
      error: error.message 
    };
  }
}

/**
 * Close Redis connection
 */
async function close() {
  if (client) {
    await client.quit();
    client = null;
    isConnected = false;
    logger.info('Redis connection closed');
  }
}

/**
 * Get Redis client
 */
function getClient() {
  return client;
}

module.exports = {
  connect,
  checkHealth,
  close,
  getClient
};
