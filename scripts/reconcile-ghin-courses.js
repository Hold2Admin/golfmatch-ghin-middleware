/**
 * Reconcile GHIN courses through the shared sync pipeline.
 * With IDs: targeted reconciliation for those courses.
 * Without IDs: full-sweep reconciliation across all candidates.
 *
 * Usage:
 *   node scripts/reconcile-ghin-courses.js
 *   node scripts/reconcile-ghin-courses.js 14914 3857
 */

const { loadSecrets } = require('../src/config/secrets');

async function run() {
  const courseIds = process.argv.slice(2).map((id) => String(id).trim()).filter(Boolean);

  const secrets = await loadSecrets();
  Object.assign(process.env, secrets);

  const { reconcileCourses, reconcileAllCandidates } = require('../src/services/courseSyncService');
  const summary = courseIds.length
    ? await reconcileCourses(courseIds, { runContext: 'script-explicit' })
    : await reconcileAllCandidates({
      batchSize: Number(process.env.GHIN_RECONCILIATION_BATCH_SIZE || 100),
      runContext: 'script-full-sweep'
    });

  console.log(JSON.stringify(summary, null, 2));
}

run().catch((error) => {
  console.error('Reconciliation failed:', error.message);
  process.exit(1);
});
