/**
 * Force one reconciliation cycle through middleware API and print sync metrics.
 * Default mode is full-sweep (all candidate courses), chunked internally.
 *
 * Usage:
 *   node scripts/run-reconciliation-cycle-and-metrics.js
 *   node scripts/run-reconciliation-cycle-and-metrics.js 14914
 */

const { loadSecrets } = require('../src/config/secrets');

async function callJson(url, options = {}, timeoutMs = 300000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let response;
  try {
    response = await fetch(url, {
      ...options,
      signal: controller.signal
    });
  } finally {
    clearTimeout(timer);
  }

  const text = await response.text();
  let body = null;

  try {
    body = text ? JSON.parse(text) : null;
  } catch (_) {
    body = text;
  }

  return { ok: response.ok, status: response.status, body };
}

async function run() {
  const courseIds = process.argv.slice(2).map((x) => String(x).trim()).filter(Boolean);
  const timeoutMs = Number(process.env.GHIN_SCRIPT_HTTP_TIMEOUT_MS || 300000);

  console.log('Loading secrets from Key Vault...');
  const secrets = await loadSecrets();
  Object.assign(process.env, secrets);
  console.log('Secrets loaded from Key Vault.');

  const middlewareBase = process.env.GHIN_MIDDLEWARE_BASE_URL || 'http://localhost:5001';
  const apiKey = process.env.GHIN_MIDDLEWARE_API_KEY;

  if (!apiKey) {
    throw new Error('GHIN_MIDDLEWARE_API_KEY is required.');
  }

  const headers = {
    'content-type': 'application/json',
    'x-api-key': apiKey
  };

  const mode = courseIds.length ? `targeted (${courseIds.join(', ')})` : 'full-sweep';
  console.log(`Using middleware base URL: ${middlewareBase}`);
  console.log(`Calling middleware reconcile endpoint in ${mode} mode (timeout ${timeoutMs}ms)...`);

  const reconcile = await callJson(`${middlewareBase}/api/v1/webhooks/ghin/course/reconcile`, {
    method: 'POST',
    headers,
    body: JSON.stringify(courseIds.length ? { courseIds } : {})
  }, timeoutMs);

  if (!reconcile.ok) {
    throw new Error(`Reconcile failed (${reconcile.status}): ${JSON.stringify(reconcile.body)}`);
  }

  console.log(`Reconcile request completed with HTTP ${reconcile.status}. Fetching metrics...`);

  const metrics = await callJson(`${middlewareBase}/api/v1/webhooks/ghin/course/metrics`, {
    method: 'GET',
    headers: { 'x-api-key': apiKey }
  }, timeoutMs);

  if (!metrics.ok) {
    throw new Error(`Metrics read failed (${metrics.status}): ${JSON.stringify(metrics.body)}`);
  }

  console.log('Reconcile summary:');
  console.log(JSON.stringify(reconcile.body, null, 2));
  console.log('\nMetrics snapshot:');
  console.log(JSON.stringify(metrics.body, null, 2));
}

run().catch((error) => {
  if (error && error.name === 'AbortError') {
    console.error('Cycle verification failed: request timed out before middleware responded.');
  } else {
    console.error('Cycle verification failed:', error.message);
  }
  process.exit(1);
});
