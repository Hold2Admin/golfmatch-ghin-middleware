/**
 * Secrets loader with Azure Key Vault integration
 * Follows golfmatch pattern: Key Vault via managed identity with .env.local fallback
 */

const { SecretClient } = require('@azure/keyvault-secrets');
const { DefaultAzureCredential } = require('@azure/identity');
const fs = require('fs');
const path = require('path');

const keyVaultName = 'golfmatch-secrets';
const keyVaultUrl = `https://${keyVaultName}.vault.azure.net`;

let secretsCache;

/**
 * Parse .env.local manually (fallback for local dev)
 */
function parseEnvLocal(envPath) {
  try {
    if (!fs.existsSync(envPath)) return null;
    const text = fs.readFileSync(envPath, 'utf8');
    const lines = text.split(/\r?\n/);
    const vars = {};
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      const val = trimmed.slice(eq + 1).trim();
      vars[key] = val;
    }
    return vars;
  } catch (e) {
    console.warn('⚠️ Failed to parse .env.local:', e.message);
    return null;
  }
}

/**
 * Load secrets from Key Vault or .env.local
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
      client.getSecret('GHIN-API-KEY').catch(() => null),
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

    const [appInsights, ghinKey, middlewareApiKey, apiKeySecret, sqlUser, sqlPassword, sqlServer, sqlDatabase, redisPassword] = 
      await Promise.race([secretsPromise, timeoutPromise]);

    secretsCache = {
      APPLICATIONINSIGHTS_CONNECTION_STRING: appInsights?.value,
      GHIN_API_KEY: ghinKey?.value,
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
    console.warn('⚠️ Key Vault failed, falling back to .env.local:', kvError.message);
    
    // Fallback to .env.local for local development
    const envPath = path.join(__dirname, '..', '..', '.env.local');
    const localVars = parseEnvLocal(envPath);
    
    if (localVars) {
      secretsCache = localVars;
      console.log('✅ Secrets loaded from .env.local');
      return secretsCache;
    }

    // Final fallback to process.env (Azure App Service sets these directly)
    console.log('ℹ️ Using process.env directly');
    secretsCache = process.env;
    return secretsCache;
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
