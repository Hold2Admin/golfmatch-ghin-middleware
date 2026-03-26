const { createLogger } = require('../utils/logger');
const usaGhinApiClient = require('./usaGhinApiClient');

const logger = createLogger('ghinWebhookService');

const WEBHOOK_TYPE = 'course';

function appendTokenQuery(baseUrl, token) {
  const url = new URL(baseUrl);
  if (token) {
    url.searchParams.set('token', token);
  }
  return url.toString();
}

function getEffectiveCallbackUrl(inputUrl) {
  const configuredUrl = inputUrl || process.env.GHIN_COURSE_WEBHOOK_URL;
  const verifyToken = process.env.GHIN_COURSE_WEBHOOK_TOKEN;

  if (!configuredUrl) {
    throw new Error('GHIN_COURSE_WEBHOOK_URL is required to manage webhook settings.');
  }
  if (!verifyToken) {
    throw new Error('GHIN_COURSE_WEBHOOK_TOKEN is required for inbound webhook authentication.');
  }

  return appendTokenQuery(configuredUrl, verifyToken);
}

function currentTypeValue(obj, typeName) {
  if (!obj || typeof obj !== 'object') {
    return null;
  }
  return obj[typeName] ?? null;
}

async function getCourseWebhookStatus() {
  const settings = await usaGhinApiClient.getWebhookSettings();
  const recent = await usaGhinApiClient.listWebhooks({ page: 1, perPage: 10 });

  return {
    type: WEBHOOK_TYPE,
    url: currentTypeValue(settings.webhook_url, WEBHOOK_TYPE),
    enabled: Boolean(currentTypeValue(settings.webhook_enabled, WEBHOOK_TYPE)),
    settings,
    recent
  };
}

async function ensureCourseWebhook(options = {}) {
  const desiredUrl = getEffectiveCallbackUrl(options.callbackUrl || null);
  const current = await usaGhinApiClient.getWebhookSettings();

  const currentUrl = currentTypeValue(current.webhook_url, WEBHOOK_TYPE);
  const currentEnabled = Boolean(currentTypeValue(current.webhook_enabled, WEBHOOK_TYPE));

  const needsPatch = !currentEnabled || currentUrl !== desiredUrl;

  let updated = false;
  let settings = current;
  if (needsPatch) {
    const payload = {
      webhook_url: {
        ...(current.webhook_url || {}),
        [WEBHOOK_TYPE]: desiredUrl
      },
      webhook_enabled: {
        ...(current.webhook_enabled || {}),
        [WEBHOOK_TYPE]: true
      }
    };

    settings = await usaGhinApiClient.updateWebhookSettings(payload);
    updated = true;
  }

  let testResult = null;
  if (options.runTest) {
    testResult = await usaGhinApiClient.testWebhook(WEBHOOK_TYPE);
  }

  logger.info('Course webhook ensure completed', {
    updated,
    enabled: Boolean(currentTypeValue(settings.webhook_enabled, WEBHOOK_TYPE))
  });

  return {
    type: WEBHOOK_TYPE,
    updated,
    desiredUrl,
    enabled: Boolean(currentTypeValue(settings.webhook_enabled, WEBHOOK_TYPE)),
    url: currentTypeValue(settings.webhook_url, WEBHOOK_TYPE),
    testResult
  };
}

module.exports = {
  WEBHOOK_TYPE,
  ensureCourseWebhook,
  getCourseWebhookStatus,
  getEffectiveCallbackUrl
};
