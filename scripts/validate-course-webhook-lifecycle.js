/**
 * Validate course webhook lifecycle end-to-end against middleware routes.
 * Sequence:
 * 1) ensure webhook settings
 * 2) trigger course webhook test
 * 3) fetch status
 * 4) fetch webhook list
 *
 * Usage:
 *   node scripts/validate-course-webhook-lifecycle.js
 */

const { loadSecrets } = require('../src/config/secrets');

async function callJson(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();

  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch (_) {
    body = text;
  }

  return {
    ok: response.ok,
    status: response.status,
    body
  };
}

async function run() {
  const secrets = await loadSecrets();
  Object.assign(process.env, secrets);

  const middlewareBase = process.env.GHIN_MIDDLEWARE_BASE_URL || 'http://localhost:5001';
  const apiKey = process.env.GHIN_MIDDLEWARE_API_KEY;

  if (!apiKey) {
    throw new Error('GHIN_MIDDLEWARE_API_KEY is required.');
  }

  const headers = {
    'content-type': 'application/json',
    'x-api-key': apiKey
  };

  console.log('1) Ensuring course webhook settings...');
  const ensure = await callJson(`${middlewareBase}/api/v1/webhooks/ghin/course/ensure`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ runTest: false })
  });
  if (!ensure.ok) {
    throw new Error(`Ensure failed (${ensure.status}): ${JSON.stringify(ensure.body)}`);
  }
  console.log(`   ensure status=${ensure.status}`);

  console.log('2) Triggering course webhook test...');
  const test = await callJson(`${middlewareBase}/api/v1/webhooks/ghin/course/test`, {
    method: 'POST',
    headers,
    body: JSON.stringify({})
  });
  if (!test.ok) {
    throw new Error(`Test failed (${test.status}): ${JSON.stringify(test.body)}`);
  }
  console.log(`   test status=${test.status}`);

  console.log('3) Reading course webhook status...');
  const status = await callJson(`${middlewareBase}/api/v1/webhooks/ghin/course/status`, {
    method: 'GET',
    headers
  });
  if (!status.ok) {
    throw new Error(`Status failed (${status.status}): ${JSON.stringify(status.body)}`);
  }
  console.log(`   status status=${status.status}`);

  console.log('4) Reading course webhook list...');
  const list = await callJson(`${middlewareBase}/api/v1/webhooks/ghin/course/list?page=1&perPage=10`, {
    method: 'GET',
    headers
  });
  if (!list.ok) {
    throw new Error(`List failed (${list.status}): ${JSON.stringify(list.body)}`);
  }
  console.log(`   list status=${list.status}`);

  console.log('\nValidation complete: ensure + test + status + list all succeeded.');
}

run().catch((error) => {
  console.error('Validation failed:', error.message);
  process.exit(1);
});
