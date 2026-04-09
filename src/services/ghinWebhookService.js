const { createLogger } = require('../utils/logger');
const usaGhinApiClient = require('./usaGhinApiClient');

const logger = createLogger('ghinWebhookService');

const COURSE_WEBHOOK_TYPE = 'course';
const GPA_WEBHOOK_TYPE = 'gpa';
const WEBHOOK_CONFIG = {
  [COURSE_WEBHOOK_TYPE]: {
    urlEnvKey: 'GHIN_COURSE_WEBHOOK_URL',
    tokenEnvKey: 'GHIN_COURSE_WEBHOOK_TOKEN'
  },
  [GPA_WEBHOOK_TYPE]: {
    urlEnvKey: 'GHIN_GPA_WEBHOOK_URL',
    tokenEnvKey: 'GHIN_GPA_WEBHOOK_TOKEN'
  }
};

function getWebhookConfig(type) {
  const webhookType = String(type || '').trim().toLowerCase();
  const config = WEBHOOK_CONFIG[webhookType];

  if (!config) {
    throw new Error(`Unsupported webhook type: ${type}`);
  }

  return {
    type: webhookType,
    ...config
  };
}

function appendTokenQuery(baseUrl, token) {
  const url = new URL(baseUrl);
  if (token) {
    url.searchParams.set('token', token);
  }
  return url.toString();
}

function getEffectiveCallbackUrl(type, inputUrl) {
  const webhook = getWebhookConfig(type);
  const configuredUrl = inputUrl || process.env[webhook.urlEnvKey];
  const verifyToken = process.env[webhook.tokenEnvKey];

  if (!configuredUrl) {
    throw new Error(`${webhook.urlEnvKey} is required to manage webhook settings.`);
  }
  if (!verifyToken) {
    throw new Error(`${webhook.tokenEnvKey} is required for inbound webhook authentication.`);
  }

  return appendTokenQuery(configuredUrl, verifyToken);
}

function currentTypeValue(obj, typeName) {
  if (!obj || typeof obj !== 'object') {
    return null;
  }
  return obj[typeName] ?? null;
}

async function getWebhookStatus(type) {
  const webhook = getWebhookConfig(type);
  const settings = await usaGhinApiClient.getWebhookSettings();
  const recent = await usaGhinApiClient.listWebhooks({ page: 1, perPage: 10 });

  return {
    type: webhook.type,
    url: currentTypeValue(settings.webhook_url, webhook.type),
    enabled: Boolean(currentTypeValue(settings.webhook_enabled, webhook.type)),
    settings,
    recent
  };
}

async function ensureWebhook(type, options = {}) {
  const webhook = getWebhookConfig(type);
  const desiredUrl = getEffectiveCallbackUrl(webhook.type, options.callbackUrl || null);
  const current = await usaGhinApiClient.getWebhookSettings();

  const currentUrl = currentTypeValue(current.webhook_url, webhook.type);
  const currentEnabled = Boolean(currentTypeValue(current.webhook_enabled, webhook.type));

  const needsPatch = !currentEnabled || currentUrl !== desiredUrl;

  let updated = false;
  let settings = current;
  if (needsPatch) {
    const payload = {
      webhook_url: {
        ...(current.webhook_url || {}),
        [webhook.type]: desiredUrl
      },
      webhook_enabled: {
        ...(current.webhook_enabled || {}),
        [webhook.type]: true
      }
    };

    settings = await usaGhinApiClient.updateWebhookSettings(payload);
    updated = true;
  }

  let testResult = null;
  if (options.runTest) {
    testResult = await usaGhinApiClient.testWebhook(webhook.type);
  }

  logger.info('Webhook ensure completed', {
    type: webhook.type,
    updated,
    enabled: Boolean(currentTypeValue(settings.webhook_enabled, webhook.type))
  });

  return {
    type: webhook.type,
    updated,
    desiredUrl,
    enabled: Boolean(currentTypeValue(settings.webhook_enabled, webhook.type)),
    url: currentTypeValue(settings.webhook_url, webhook.type),
    testResult
  };
}

async function getCourseWebhookStatus() {
  return getWebhookStatus(COURSE_WEBHOOK_TYPE);
}

async function ensureCourseWebhook(options = {}) {
  return ensureWebhook(COURSE_WEBHOOK_TYPE, options);
}

async function getGpaWebhookStatus() {
  return getWebhookStatus(GPA_WEBHOOK_TYPE);
}

async function ensureGpaWebhook(options = {}) {
  return ensureWebhook(GPA_WEBHOOK_TYPE, options);
}

module.exports = {
  WEBHOOK_TYPE: COURSE_WEBHOOK_TYPE,
  COURSE_WEBHOOK_TYPE,
  GPA_WEBHOOK_TYPE,
  ensureCourseWebhook,
  getCourseWebhookStatus,
  ensureGpaWebhook,
  getGpaWebhookStatus,
  getEffectiveCallbackUrl
};
