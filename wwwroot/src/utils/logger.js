// ============================================================
// Winston Logger Configuration
// ============================================================

const winston = require('winston');
const config = require('../config');

const logFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.errors({ stack: true }),
  winston.format.splat(),
  winston.format.json()
);

function createLogger(module) {
  return winston.createLogger({
    level: config.logging.level,
    format: logFormat,
    defaultMeta: { service: 'ghin-middleware', module },
    transports: [
      // Console output
      new winston.transports.Console({
        format: winston.format.combine(
          winston.format.colorize(),
          winston.format.printf(({ timestamp, level, message, module, ...meta }) => {
            const metaStr = Object.keys(meta).length ? JSON.stringify(meta) : '';
            return `${timestamp} [${module}] ${level}: ${message} ${metaStr}`;
          })
        )
      }),
      
      // File output (errors only)
      new winston.transports.File({
        filename: 'logs/error.log',
        level: 'error',
        maxsize: 5242880, // 5MB
        maxFiles: 5
      }),
      
      // File output (all logs)
      new winston.transports.File({
        filename: 'logs/combined.log',
        maxsize: 5242880,
        maxFiles: 5
      })
    ]
  });
}

module.exports = { createLogger };
