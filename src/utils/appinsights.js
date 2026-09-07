// ============================================================
// Application Insights Telemetry Configuration
// Sends request, dependency, and custom event data to Azure
// ============================================================

const { createLogger } = require('./logger');

const logger = createLogger('app-insights');
let appInsightsModule = null;

function getAppInsightsModule() {
  if (appInsightsModule) {
    return appInsightsModule;
  }

  appInsightsModule = require('applicationinsights');
  return appInsightsModule;
}

/**
 * Initialize Application Insights
 * Prefer APPLICATIONINSIGHTS_CONNECTION_STRING; fall back to APPINSIGHTS_INSTRUMENTATIONKEY
 */
let alreadyInitialized = false;

function initializeAppInsights() {
  if (alreadyInitialized && appInsightsModule?.defaultClient) {
    return appInsightsModule.defaultClient;
  }

  const connectionString =
    process.env.APPLICATIONINSIGHTS_CONNECTION_STRING || process.env.AppInsights__ConnectionString;
  const instrumentationKey = process.env.APPINSIGHTS_INSTRUMENTATIONKEY;

  if (!connectionString && !instrumentationKey) {
    logger.warn('Application Insights not configured (missing connection string / instrumentation key)');
    return null;
  }

  // Key Vault reference must be resolved by App Service before setup; refuse the unresolved marker.
  if (typeof connectionString === 'string' && connectionString.startsWith('@Microsoft.KeyVault')) {
    logger.error('Application Insights connection string is an unresolved Key Vault reference');
    return null;
  }

  try {
    const appInsights = getAppInsightsModule();

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


function scrubTelemetrySecrets(envelope) {
  try {
    const data = envelope?.data?.baseData;
    if (!data) return true;
    const scrub = (value) => {
      if (!value || typeof value !== 'string') return value;
      return value.replace(/([?&]token=)[^&]*/gi, '$1REDACTED');
    };
    if (data.url) data.url = scrub(data.url);
    if (data.name) data.name = scrub(data.name);
    if (data.target) data.target = scrub(data.target);
    if (data.data) data.data = scrub(data.data);
  } catch (_) {
    // never block telemetry on scrub failure
  }
  return true;
}

    client.addTelemetryProcessor(scrubTelemetrySecrets);

    // Connection-string / ikey ingestion. Do not enable AAD without setAzureTokenCredential.
    client.context.tags[client.context.keys.cloudRole] = 'ghin-middleware-api';
    client.context.tags[client.context.keys.cloudRoleInstance] = process.env.WEBSITE_INSTANCE_ID || 'local';

    alreadyInitialized = true;

    logger.info('Application Insights initialized', {
      connectionString: connectionString ? connectionString.substring(0, 16) + '...' : undefined,
      instrumentationKey: instrumentationKey ? instrumentationKey.substring(0, 8) + '...' : undefined,
      cloudRole: 'ghin-middleware-api'
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
  const client = appInsightsModule?.defaultClient;
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
  const client = appInsightsModule?.defaultClient;
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
  const client = appInsightsModule?.defaultClient;
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
  const client = appInsightsModule?.defaultClient;
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
  getClient: () => appInsightsModule?.defaultClient || null
};
