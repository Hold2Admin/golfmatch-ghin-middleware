const metrics = {
  received: 0,
  processedNochange: 0,
  processedUpdated: 0,
  failed: 0,
  lastSuccessfulCourseSyncAt: null,
  lastReconciliationRunAt: null,
  lastReconciliationSummary: null
};

function nowIso() {
  return new Date().toISOString();
}

function recordReceived() {
  metrics.received += 1;
}

function recordProcessedNochange() {
  metrics.processedNochange += 1;
  metrics.lastSuccessfulCourseSyncAt = nowIso();
}

function recordProcessedUpdated() {
  metrics.processedUpdated += 1;
  metrics.lastSuccessfulCourseSyncAt = nowIso();
}

function recordFailed() {
  metrics.failed += 1;
}

function recordReconciliationRun(summary) {
  metrics.lastReconciliationRunAt = nowIso();
  metrics.lastReconciliationSummary = summary || null;
}

function getMetricsSnapshot() {
  return {
    received: metrics.received,
    processedNochange: metrics.processedNochange,
    processedUpdated: metrics.processedUpdated,
    failed: metrics.failed,
    lastSuccessfulCourseSyncAt: metrics.lastSuccessfulCourseSyncAt,
    lastReconciliationRunAt: metrics.lastReconciliationRunAt,
    lastReconciliationSummary: metrics.lastReconciliationSummary
  };
}

module.exports = {
  recordReceived,
  recordProcessedNochange,
  recordProcessedUpdated,
  recordFailed,
  recordReconciliationRun,
  getMetricsSnapshot
};
