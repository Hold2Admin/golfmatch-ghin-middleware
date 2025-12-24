// ============================================================
// Application Insights Telemetry Configuration
// Sends request, dependency, and custom event data to Azure
// ============================================================

const appInsights = require('applicationinsights');
const { createLogger } = require('./logger');

const logger = createLogger('app-insights');

/**
 * Initialize Application Insights
 * Prefer APPLICATIONINSIGHTS_CONNECTION_STRING; fall back to APPINSIGHTS_INSTRUMENTATIONKEY
 */
function initializeAppInsights() {
  const connectionString =
    process.env.APPLICATIONINSIGHTS_CONNECTION_STRING || process.env.AppInsights__ConnectionString;
  const instrumentationKey = process.env.APPINSIGHTS_INSTRUMENTATIONKEY;

  if (!connectionString && !instrumentationKey) {
    logger.warn('Application Insights not configured (missing connection string / instrumentation key)');
    return null;
  }

  try {
    // Setup Application Insights (connection string removes deprecation warning)
    const setupValue = connectionString || instrumentationKey;
    appInsights
      .setup(setupValue)
      .setAutoDependencyCorrelation(true)
      .setAutoCollectRequests(true)
      .setAutoCollectPerformance(true)
      .setAutoCollectExceptions(true)
      .setAutoCollectDependencies(true)
      .setAutoCollectConsole(true)
      .setUseDiskRetryCaching(true)
      .start();

    const client = appInsights.defaultClient;

    // Set cloud role name for Azure
    client.config.aadEnabled = true; // Enable AAD authentication (managed identity)
    client.context.tags[client.context.keys.cloudRole] = 'ghin-middleware-api';
    client.context.tags[client.context.keys.cloudRoleInstance] = process.env.WEBSITE_INSTANCE_ID || 'local';

    logger.info('Application Insights initialized', {
      connectionString: connectionString ? connectionString.substring(0, 16) + '...' : undefined,
      instrumentationKey: instrumentationKey ? instrumentationKey.substring(0, 8) + '...' : undefined
    });

    return client;
  } catch (error) {
    logger.error('Failed to initialize Application Insights', {
      error: error.message
    });
    return null;
  }
}

/**
 * Track custom event in Application Insights
 * @param {string} eventName
 * @param {Object} properties
 * @param {Object} measurements
 */
function trackEvent(eventName, properties = {}, measurements = {}) {
  const client = appInsights.defaultClient;
  if (!client) return;

  try {
    client.trackEvent({
      name: eventName,
      properties,
      measurements
    });
  } catch (error) {
    logger.error('Failed to track event', { error: error.message });
  }
}

/**
 * Track dependency (e.g., GHIN API call, database query)
 * @param {string} name
 * @param {string} commandName
 * @param {number} duration
 * @param {boolean} success
 * @param {number} resultCode
 */
function trackDependency(name, commandName, duration, success, resultCode) {
  const client = appInsights.defaultClient;
  if (!client) return;

  try {
    client.trackDependency({
      target: name,
      name: commandName,
      duration,
      success,
      resultCode,
      dependencyTypeName: 'HTTP'
    });
  } catch (error) {
    logger.error('Failed to track dependency', { error: error.message });
  }
}

/**
 * Track exception in Application Insights
 * @param {Error} exception
 * @param {Object} properties
 */
function trackException(exception, properties = {}) {
  const client = appInsights.defaultClient;
  if (!client) return;

  try {
    client.trackException({
      exception,
      properties
    });
  } catch (error) {
    logger.error('Failed to track exception', { error: error.message });
  }
}

/**
 * Track request success/failure manually
 * @param {string} name
 * @param {number} duration
 * @param {number} resultCode
 * @param {boolean} success
 * @param {Object} properties
 */
function trackRequest(name, duration, resultCode, success, properties = {}) {
  const client = appInsights.defaultClient;
  if (!client) return;

  try {
    client.trackRequest({
      name,
      url: name,
      duration,
      resultCode,
      success,
      properties
    });
  } catch (error) {
    logger.error('Failed to track request', { error: error.message });
  }
}

module.exports = {
  initializeAppInsights,
  trackEvent,
  trackDependency,
  trackException,
  trackRequest,
  getClient: () => appInsights.defaultClient
};
