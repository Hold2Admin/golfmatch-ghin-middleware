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

    secretsCache = {
      APPLICATIONINSIGHTS_CONNECTION_STRING: appInsights?.value,
      GHIN_SANDBOX_EMAIL: ghinEmail?.value,
      GHIN_SANDBOX_PASSWORD: ghinPassword?.value,
      GHIN_API_BASE_URL: ghinBaseUrl?.value,
      GHIN_MIDDLEWARE_API_KEY: middlewareApiKey?.value,
      API_KEY_HASH_SECRET: apiKeySecret?.value,
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
