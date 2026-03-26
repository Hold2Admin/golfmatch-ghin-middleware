/**
 * Search for GHIN courses by name and optional state using the live USGA API.
 * Shows which results are already in the cache DB.
 *
 * Usage: node scripts/search-ghin-courses.js <name> [state]
 * Examples:
 *   node scripts/search-ghin-courses.js "oak"
 *   node scripts/search-ghin-courses.js "indian hill" IL
 *
 * To seed a result into cache:
 *   node scripts/seed-ghin-course.js <courseId>
 */

const sql = require('mssql');
const { loadSecrets } = require('../src/config/secrets');

async function run() {
  const name  = process.argv[2];
  const state = process.argv[3] || null;

  if (!name) {
    console.error('Usage: node scripts/search-ghin-courses.js <name> [state]');
    console.error('  Example: node scripts/search-ghin-courses.js "oak" IL');
    process.exit(1);
  }

  // ── Load secrets and set env before requiring config-dependent modules ──
  const secrets = await loadSecrets();
  if (secrets.GHIN_SANDBOX_EMAIL)    process.env.GHIN_SANDBOX_EMAIL    = secrets.GHIN_SANDBOX_EMAIL;
  if (secrets.GHIN_SANDBOX_PASSWORD) process.env.GHIN_SANDBOX_PASSWORD = secrets.GHIN_SANDBOX_PASSWORD;
  if (secrets.GHIN_API_BASE_URL)     process.env.GHIN_API_BASE_URL     = secrets.GHIN_API_BASE_URL;

  // Require AFTER env is populated so config reads correct values
  const usaGhinApiClient = require('../src/services/usaGhinApiClient');

  // ── Search live USGA API ─────────────────────────────────────────────────
  console.log(`Searching USGA API for "${name}"${state ? ` in ${state}` : ''}...`);
  const results = await usaGhinApiClient.searchCourses({ courseName: name, state, perPage: 50 });

  if (!results.length) {
    console.log('No results found.');
    return;
  }

  // ── Check which courseIds are already in cacheDB ─────────────────────────
  // courseIds from the USGA API are always numeric strings — validate before using in query
  const safeIds = results
    .map(r => r.courseId)
    .filter(id => /^\d+$/.test(String(id)));

  const pool = await sql.connect({
    server:   secrets.GHIN_CACHE_DB_SERVER,
    database: secrets.GHIN_CACHE_DB_NAME,
    user:     secrets.GHIN_CACHE_DB_USER,
    password: secrets.GHIN_CACHE_DB_PASSWORD,
    options:  { encrypt: true, enableArithAbort: true }
  });

  let cachedSet = new Set();
  if (safeIds.length) {
    // Safe to interpolate — all values validated as numeric strings above
    const inList = safeIds.map(id => `'${id}'`).join(',');
    const cached = await pool.request().query(
      `SELECT courseId FROM GHIN_Courses WHERE courseId IN (${inList})`
    );
    cachedSet = new Set(cached.recordset.map(r => r.courseId));
  }

  await pool.close();

  // ── Print results ────────────────────────────────────────────────────────
  console.log(`\n${results.length} result(s):\n`);

  results.forEach(r => {
    const tag = cachedSet.has(r.courseId) ? '[CACHED    ]' : '[NOT CACHED]';
    const location = [r.city, r.state].filter(Boolean).join(', ');
    const label = r.displayName || r.courseName;
    console.log(`  ${tag}  ${String(r.courseId).padEnd(10)}  ${label}${location ? `  —  ${location}` : ''}`);
  });

  const notCached = results.filter(r => !cachedSet.has(r.courseId));
  if (notCached.length) {
    console.log(`\n  ${notCached.length} not yet in cache. To seed one:`);
    console.log('  node scripts/seed-ghin-course.js <courseId>');
  }
}

run().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
