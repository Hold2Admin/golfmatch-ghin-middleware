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

// Winston is loaded before applicationinsights.setup(), so the SDK's auto-capture never
// patches it and no middleware log line reached App Insights. Forward explicitly.
const AI_SEVERITY = { error: 3, warn: 2, info: 1, http: 0, verbose: 0, debug: 0, silly: 0 };
class AppInsightsTraceTransport extends winston.Transport {
  log(info, callback) {
    try {
      const client = require.cache[require.resolve('applicationinsights')]
        ? require('applicationinsights').defaultClient
        : null;
      if (client) {
        const { level, message, timestamp, service, module: mod, stack, ...meta } = info;
        const properties = { module: mod, service };
        for (const [key, value] of Object.entries(meta)) {
          if (typeof key === 'symbol') continue;
          properties[key] = value !== null && typeof value === 'object' ? JSON.stringify(value) : String(value);
        }
        if (stack) properties.stack = String(stack);
        client.trackTrace({
          message: `[${mod || 'app'}] ${message}`,
          severity: AI_SEVERITY[level] ?? 1,
          properties
        });
      }
    } catch (_) {
      // never let telemetry break logging
    }
    callback();
  }
}

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

  transports.push(new AppInsightsTraceTransport({ level: process.env.APPINSIGHTS_TRACE_LEVEL || 'info' }));

  return winston.createLogger({
    level: config.logging.level,
    format: logFormat,
    defaultMeta: { service: 'ghin-middleware', module },
    transports
  });
}

module.exports = { createLogger };
