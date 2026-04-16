// ============================================================
// Winston Logger Configuration
// ============================================================

const fs = require('fs');
const path = require('path');
const winston = require('winston');
const config = require('../config');

const logFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.errors({ stack: true }),
  winston.format.splat(),
  winston.format.json()
);

function createLogger(module) {
  const useColor = Boolean(process.stdout.isTTY) && process.env.NO_COLOR !== '1';
  const consoleFormats = [
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' })
  ];

  if (useColor) {
    consoleFormats.push(winston.format.colorize());
  }

  consoleFormats.push(
    winston.format.printf(({ timestamp, level, message, module, ...meta }) => {
      const metaStr = Object.keys(meta).length ? JSON.stringify(meta) : '';
      return `${timestamp} [${module}] ${level}: ${message} ${metaStr}`;
    })
  );

  const transports = [
    new winston.transports.Console({
      format: winston.format.combine(...consoleFormats)
    })
  ];

  const preferredLogDir = process.env.LOG_DIR
    || (process.env.WEBSITE_INSTANCE_ID ? '/home/LogFiles/ghin-middleware' : path.join(process.cwd(), 'logs'));

  try {
    fs.mkdirSync(preferredLogDir, { recursive: true });
    transports.push(
      new winston.transports.File({
        filename: path.join(preferredLogDir, 'error.log'),
        level: 'error',
        maxsize: 5242880,
        maxFiles: 5
      })
    );
    transports.push(
      new winston.transports.File({
        filename: path.join(preferredLogDir, 'combined.log'),
        maxsize: 5242880,
        maxFiles: 5
      })
    );
  } catch (error) {
    console.warn(`[logger] file transports disabled: ${error.message}`);
  }

  return winston.createLogger({
    level: config.logging.level,
    format: logFormat,
    defaultMeta: { service: 'ghin-middleware', module },
    transports
  });
}

module.exports = { createLogger };
