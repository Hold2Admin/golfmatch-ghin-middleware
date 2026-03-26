/**
 * Secrets loader with Azure Key Vault integration
 * Key Vault via managed identity (Azure CLI locally, managed identity in Azure).
 * No fallbacks — if Key Vault is unreachable, startup fails explicitly.
 */

const { SecretClient } = require('@azure/keyvault-secrets');
const { DefaultAzureCredential } = require('@azure/identity');

const keyVaultName = 'golfmatch-secrets';
const keyVaultUrl = `https://${keyVaultName}.vault.azure.net`;

let secretsCache;

async function getFirstSecret(client, names) {
  for (const name of names) {
    try {
      const secret = await client.getSecret(name);
      if (secret?.value && String(secret.value).trim()) {
        return String(secret.value).trim();
      }
    } catch (_) {
      // Try next candidate name.
    }
  }
  return null;
}

/**
 * Load secrets from Key Vault
 */
async function loadSecrets() {
  if (secretsCache) return secretsCache;

  // Try Key Vault first (works with managed identity in Azure and locally with Azure CLI)
  console.log('🔐 Attempting Key Vault via managed identity');
  const credential = new DefaultAzureCredential();
  const client = new SecretClient(keyVaultUrl, credential);

  try {
    const secretsPromise = Promise.all([
      client.getSecret('applicationinsights-connection-string').catch(() => null),
      client.getSecret('GHIN-SANDBOX-EMAIL').catch(() => null),
      client.getSecret('GHIN-SANDBOX-PASSWORD').catch(() => null),
      client.getSecret('GHIN-API-BASE-URL').catch(() => null),
      client.getSecret('GHIN-MIDDLEWARE-API-KEY').catch(() => null),
      client.getSecret('API-KEY-HASH-SECRET').catch(() => null),
      client.getSecret('AZURE-SQL-USER').catch(() => null),
      client.getSecret('AZURE-SQL-PASSWORD').catch(() => null),
      client.getSecret('AZURE-SQL-SERVER').catch(() => null),
      client.getSecret('AZURE-SQL-DATABASE').catch(() => null),
      client.getSecret('REDIS-PASSWORD').catch(() => null)
    ]);

    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Key Vault timeout (30s)')), 30000)
    );

    const [appInsights, ghinEmail, ghinPassword, ghinBaseUrl, middlewareApiKey, apiKeySecret, sqlUser, sqlPassword, sqlServer, sqlDatabase, redisPassword] = 
      await Promise.race([secretsPromise, timeoutPromise]);

    const [cacheDbServer, cacheDbName, cacheDbUser, cacheDbPassword, ghinMiddlewareSecret] = await Promise.all([
      getFirstSecret(client, ['GHIN-CACHE-DB-SERVER', 'GHIN_CACHE_DB_SERVER']),
      getFirstSecret(client, ['GHIN-CACHE-DB-NAME', 'GHIN_CACHE_DB_NAME']),
      getFirstSecret(client, ['GHIN-CACHE-DB-USER', 'GHIN_CACHE_DB_USER']),
      getFirstSecret(client, ['GHIN-CACHE-DB-PASSWORD', 'GHIN_CACHE_DB_PASSWORD']),
      client.getSecret('GHIN-MIDDLEWARE-SECRET').then((s) => s?.value?.trim() || null).catch(() => null)
    ]);

    const [courseWebhookUrl, courseWebhookToken, webhookBaseUrl, importCallbackUrl] = await Promise.all([
      getFirstSecret(client, ['GHIN-COURSE-WEBHOOK-URL', 'GHIN_COURSE_WEBHOOK_URL']),
      getFirstSecret(client, ['GHIN-COURSE-WEBHOOK-TOKEN', 'GHIN_COURSE_WEBHOOK_TOKEN']),
      getFirstSecret(client, ['GHIN-WEBHOOK-BASE-URL', 'GHIN_WEBHOOK_BASE_URL']),
      getFirstSecret(client, ['GHIN-IMPORT-CALLBACK-URL', 'GHIN_IMPORT_CALLBACK_URL'])
    ]);

    secretsCache = {
      APPLICATIONINSIGHTS_CONNECTION_STRING: appInsights?.value,
      GHIN_SANDBOX_EMAIL: ghinEmail?.value,
      GHIN_SANDBOX_PASSWORD: ghinPassword?.value,
      GHIN_API_BASE_URL: ghinBaseUrl?.value,
      GHIN_MIDDLEWARE_API_KEY: middlewareApiKey?.value,
      GHIN_COURSE_WEBHOOK_URL: courseWebhookUrl,
      GHIN_COURSE_WEBHOOK_TOKEN: courseWebhookToken,
      GHIN_WEBHOOK_BASE_URL: webhookBaseUrl,
      GHIN_IMPORT_CALLBACK_URL: importCallbackUrl,
      API_KEY_HASH_SECRET: apiKeySecret?.value,
      GHIN_CACHE_DB_SERVER: cacheDbServer,
      GHIN_CACHE_DB_NAME: cacheDbName,
      GHIN_CACHE_DB_USER: cacheDbUser,
      GHIN_CACHE_DB_PASSWORD: cacheDbPassword,
      GHIN_MIDDLEWARE_SECRET: ghinMiddlewareSecret,
      AZURE_SQL_USER: sqlUser?.value,
      AZURE_SQL_PASSWORD: sqlPassword?.value,
      AZURE_SQL_SERVER: sqlServer?.value,
      AZURE_SQL_DATABASE: sqlDatabase?.value,
      REDIS_PASSWORD: redisPassword?.value
    };

    console.log('✅ Secrets loaded from Key Vault');
    return secretsCache;

  } catch (kvError) {
    throw new Error(`Key Vault unavailable — cannot start without secrets: ${kvError.message}`);
  }
}

/**
 * Get a secret value
 */
async function getSecret(key) {
  const secrets = await loadSecrets();
  return secrets[key] || process.env[key];
}

module.exports = {
  loadSecrets,
  getSecret
};
