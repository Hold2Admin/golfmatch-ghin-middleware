/**
 * Search for GHIN courses by name and optional state using the live USGA API.
 * Shows which results are already in the cache DB.
 *
 * Usage:
 *   node scripts/search-ghin-courses.js <name> [state]
 *   node scripts/search-ghin-courses.js --state=US-NY
 *   node scripts/search-ghin-courses.js --state=US-NY --count-only
 *   node scripts/search-ghin-courses.js --name="oak" --state=IL
 * Examples:
 *   node scripts/search-ghin-courses.js "oak"
 *   node scripts/search-ghin-courses.js "indian hill" IL
 *   node scripts/search-ghin-courses.js --state=US-NY
 *
 * To seed a result into cache:
 *   node scripts/seed-ghin-course.js <courseId>
 */

const sql = require('mssql');
const { loadSecrets } = require('../src/config/secrets');

const ALL_US_STATES = [
  'US-AL', 'US-AK', 'US-AZ', 'US-AR', 'US-CA', 'US-CO', 'US-CT', 'US-DE', 'US-FL', 'US-GA',
  'US-HI', 'US-ID', 'US-IL', 'US-IN', 'US-IA', 'US-KS', 'US-KY', 'US-LA', 'US-ME', 'US-MD',
  'US-MA', 'US-MI', 'US-MN', 'US-MS', 'US-MO', 'US-MT', 'US-NE', 'US-NV', 'US-NH', 'US-NJ',
  'US-NM', 'US-NY', 'US-NC', 'US-ND', 'US-OH', 'US-OK', 'US-OR', 'US-PA', 'US-RI', 'US-SC',
  'US-SD', 'US-TN', 'US-TX', 'US-UT', 'US-VT', 'US-VA', 'US-WA', 'US-WV', 'US-WI', 'US-WY'
];

async function mapLimit(items, limit, worker) {
  const results = new Array(items.length);
  let cursor = 0;

  async function runWorker() {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) {
        return;
      }
      results[index] = await worker(items[index], index);
    }
  }

  const workers = Array.from({ length: Math.min(limit, Math.max(items.length, 1)) }, () => runWorker());
  await Promise.all(workers);
  return results;
}

function chunk(items, size) {
  const chunks = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

function parseArgs(argv) {
  const positionals = [];
  let name = null;
  let state = null;
  let perPage = 50;
  let countOnly = false;

  for (const arg of argv) {
    if (arg === '--count-only' || arg === '--count') {
      countOnly = true;
      continue;
    }
    if (arg.startsWith('--name=')) {
      name = arg.slice('--name='.length).trim() || null;
      continue;
    }
    if (arg.startsWith('--state=')) {
      state = arg.slice('--state='.length).trim() || null;
      continue;
    }
    if (arg.startsWith('--per-page=')) {
      const parsed = Number(arg.slice('--per-page='.length));
      if (Number.isFinite(parsed) && parsed > 0) {
        perPage = Math.floor(parsed);
      }
      continue;
    }

    positionals.push(arg);
  }

  if (!name && positionals.length > 0) {
    name = positionals[0];
  }
  if (!state && positionals.length > 1) {
    state = positionals[1];
  }

  return { name, state, perPage, countOnly };
}

async function run() {
  const { name, state, perPage, countOnly } = parseArgs(process.argv.slice(2));

  if (!name && !state && !countOnly) {
    console.error('Usage: node scripts/search-ghin-courses.js <name> [state]');
    console.error('   or: node scripts/search-ghin-courses.js --state=US-NY');
    console.error('   or: node scripts/search-ghin-courses.js --state=US-NY --count-only');
    console.error('   or: node scripts/search-ghin-courses.js --count-only');
    console.error('   or: node scripts/search-ghin-courses.js --name="oak" --state=IL');
    process.exit(1);
  }

  // ── Load secrets and set env before requiring config-dependent modules ──
  const secrets = await loadSecrets();
  if (secrets.GHIN_SANDBOX_EMAIL)    process.env.GHIN_SANDBOX_EMAIL    = secrets.GHIN_SANDBOX_EMAIL;
  if (secrets.GHIN_SANDBOX_PASSWORD) process.env.GHIN_SANDBOX_PASSWORD = secrets.GHIN_SANDBOX_PASSWORD;
  if (secrets.GHIN_API_BASE_URL)     process.env.GHIN_API_BASE_URL     = secrets.GHIN_API_BASE_URL;

  // Require AFTER env is populated so config reads correct values
  const usaGhinApiClient = require('../src/services/usaGhinApiClient');

  let results = [];

  // ── Search live USGA API ─────────────────────────────────────────────────
  if (countOnly && !name && !state) {
    console.log('Searching USGA API for all US states...');
    const stateResults = await mapLimit(ALL_US_STATES, 8, async (stateCode) => {
      const stateCourses = await usaGhinApiClient.searchCourses({ state: stateCode, perPage });
      return stateCourses;
    });
    const uniqueByCourseId = new Map();
    stateResults.flat().forEach((course) => {
      const courseId = String(course?.courseId || '').trim();
      if (!courseId || uniqueByCourseId.has(courseId)) return;
      uniqueByCourseId.set(courseId, course);
    });
    results = Array.from(uniqueByCourseId.values());
  } else {
    const searchLabel = [name ? `"${name}"` : null, state ? `in ${state}` : null].filter(Boolean).join(' ');
    console.log(`Searching USGA API for ${searchLabel}...`);
    results = await usaGhinApiClient.searchCourses({ courseName: name, state, perPage });
  }

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
    options:  { encrypt: true, enableArithAbort: true },
    requestTimeout: 60000
  });

  let cachedSet = new Set();
  if (safeIds.length) {
    for (const idsChunk of chunk(safeIds, 500)) {
      const inList = idsChunk.map(id => `'${id}'`).join(',');
      const cached = await pool.request().query(
        `SELECT CourseId AS courseId FROM dbo.GHIN_Courses WHERE CourseId IN (${inList})`
      );
      cached.recordset.forEach((row) => {
        if (row.courseId != null) {
          cachedSet.add(String(row.courseId));
        }
      });
    }
  }

  await pool.close();

  const notCached = results.filter(r => !cachedSet.has(r.courseId));

  if (countOnly) {
    console.log(`Total Count: ${results.length}`);
    console.log(`Not Yet In Cache: ${notCached.length}`);
    return;
  }

  // ── Print results ────────────────────────────────────────────────────────
  console.log(`\n${results.length} result(s):\n`);

  results.forEach(r => {
    const tag = cachedSet.has(r.courseId) ? '[CACHED    ]' : '[NOT CACHED]';
    const location = [r.city, r.state].filter(Boolean).join(', ');
    const label = r.displayName || r.courseName;
    console.log(`  ${tag}  ${String(r.courseId).padEnd(10)}  ${label}${location ? `  —  ${location}` : ''}`);
  });

  if (notCached.length) {
    console.log(`\n  ${notCached.length} not yet in cache. To seed one:`);
    console.log('  node scripts/seed-ghin-course.js <courseId>');
  }
}

run().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
