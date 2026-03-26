const crypto = require('crypto');
const database = require('./database');
const { getMetricsSnapshot } = require('./syncMetricsService');
const { createLogger } = require('../utils/logger');

const logger = createLogger('reconciliationHistoryService');

let schemaEnsured = false;

function asNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function asIsoDateOrNow(value) {
  if (!value) {
    return new Date().toISOString();
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return new Date().toISOString();
  }

  return parsed.toISOString();
}

function parseEnvNumber(name, fallback) {
  const raw = process.env[name];
  if (raw == null || raw === '') {
    return fallback;
  }

  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function buildSummaryShape(summary) {
  return {
    mode: String(summary.mode || 'explicit'),
    batchSize: asNumber(summary.batchSize, 0),
    requested: asNumber(summary.requested, 0),
    updated: asNumber(summary.updated, 0),
    nochange: asNumber(summary.nochange, 0),
    failed: asNumber(summary.failed, 0),
    notFound: asNumber(summary.notFound, 0),
    completed: summary.completed !== false,
    resumeOffset: asNumber(summary.resumeOffset, 0),
    startedAt: asIsoDateOrNow(summary.startedAt),
    finishedAt: asIsoDateOrNow(summary.finishedAt)
  };
}

function buildAlert(type, severity, message, details = {}) {
  return { type, severity, message, details };
}

async function ensureSchema() {
  if (schemaEnsured) {
    return;
  }

  await database.query(`
    IF OBJECT_ID('dbo.GHIN_ReconciliationRuns', 'U') IS NULL
    BEGIN
      CREATE TABLE dbo.GHIN_ReconciliationRuns (
        runId UNIQUEIDENTIFIER NOT NULL PRIMARY KEY,
        runContext NVARCHAR(40) NOT NULL,
        mode NVARCHAR(40) NOT NULL,
        batchSize INT NOT NULL,
        startedAt DATETIME2(3) NOT NULL,
        finishedAt DATETIME2(3) NOT NULL,
        completed BIT NOT NULL,
        resumeOffset INT NOT NULL,
        requested INT NOT NULL,
        updated INT NOT NULL,
        nochange INT NOT NULL,
        failed INT NOT NULL,
        notFound INT NOT NULL,
        createdAt DATETIME2(3) NOT NULL CONSTRAINT DF_GHIN_ReconciliationRuns_createdAt DEFAULT (SYSUTCDATETIME())
      );

      CREATE INDEX IX_GHIN_ReconciliationRuns_createdAt
        ON dbo.GHIN_ReconciliationRuns (createdAt DESC);
    END
  `);

  await database.query(`
    IF OBJECT_ID('dbo.GHIN_ReconciliationRunResults', 'U') IS NULL
    BEGIN
      CREATE TABLE dbo.GHIN_ReconciliationRunResults (
        id BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        runId UNIQUEIDENTIFIER NOT NULL,
        courseId VARCHAR(50) NOT NULL,
        status NVARCHAR(30) NOT NULL,
        skipped BIT NULL,
        payloadHash VARCHAR(64) NULL,
        errorMessage NVARCHAR(2000) NULL,
        createdAt DATETIME2(3) NOT NULL CONSTRAINT DF_GHIN_ReconciliationRunResults_createdAt DEFAULT (SYSUTCDATETIME()),
        CONSTRAINT FK_GHIN_ReconciliationRunResults_runId
          FOREIGN KEY (runId) REFERENCES dbo.GHIN_ReconciliationRuns(runId)
      );

      CREATE INDEX IX_GHIN_ReconciliationRunResults_runId
        ON dbo.GHIN_ReconciliationRunResults (runId);
    END
  `);

  await database.query(`
    IF OBJECT_ID('dbo.GHIN_ReconciliationAlerts', 'U') IS NULL
    BEGIN
      CREATE TABLE dbo.GHIN_ReconciliationAlerts (
        id BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        runId UNIQUEIDENTIFIER NULL,
        alertType NVARCHAR(50) NOT NULL,
        severity NVARCHAR(20) NOT NULL,
        message NVARCHAR(500) NOT NULL,
        detailsJson NVARCHAR(MAX) NULL,
        createdAt DATETIME2(3) NOT NULL CONSTRAINT DF_GHIN_ReconciliationAlerts_createdAt DEFAULT (SYSUTCDATETIME())
      );

      CREATE INDEX IX_GHIN_ReconciliationAlerts_createdAt
        ON dbo.GHIN_ReconciliationAlerts (createdAt DESC);
    END
  `);

  schemaEnsured = true;
}

async function getRecentRunBaselines(runId, lookbackRuns) {
  const sql = database.sql;

  const rows = await database.query(
    `SELECT TOP (@lookbackRuns) failed, notFound, requested
     FROM dbo.GHIN_ReconciliationRuns
     WHERE runId <> @runId
     ORDER BY createdAt DESC`,
    {
      lookbackRuns: { type: sql.Int, value: lookbackRuns },
      runId: { type: sql.UniqueIdentifier, value: runId }
    }
  );

  return rows;
}

function average(values) {
  if (!values.length) {
    return 0;
  }
  const total = values.reduce((sum, value) => sum + value, 0);
  return total / values.length;
}

async function evaluateAlerts({ runId, summary }) {
  const alerts = [];
  const requested = asNumber(summary.requested, 0);
  const failed = asNumber(summary.failed, 0);
  const notFound = asNumber(summary.notFound, 0);

  const failureRateThreshold = parseEnvNumber('GHIN_ALERT_FAILURE_RATE_THRESHOLD', 0.2);
  const failureCountMin = Math.max(1, parseEnvNumber('GHIN_ALERT_FAILURE_COUNT_MIN', 25));
  const notFoundRateThreshold = parseEnvNumber('GHIN_ALERT_NOTFOUND_RATE_THRESHOLD', 0.3);
  const notFoundCountMin = Math.max(1, parseEnvNumber('GHIN_ALERT_NOTFOUND_COUNT_MIN', 50));
  const lookbackRuns = Math.max(1, parseEnvNumber('GHIN_ALERT_LOOKBACK_RUNS', 5));
  const spikeMultiplier = Math.max(1.1, parseEnvNumber('GHIN_ALERT_SPIKE_MULTIPLIER', 2));
  const staleSyncHours = Math.max(1, parseEnvNumber('GHIN_ALERT_STALE_SYNC_HOURS', 72));

  const failureRate = requested > 0 ? failed / requested : 0;
  if (failed >= failureCountMin && failureRate >= failureRateThreshold) {
    alerts.push(buildAlert(
      'failure_rate_threshold',
      'high',
      `Failure rate ${failureRate.toFixed(3)} exceeded threshold ${failureRateThreshold.toFixed(3)}.`,
      { requested, failed, failureRate, threshold: failureRateThreshold, minimumCount: failureCountMin }
    ));
  }

  const notFoundRate = requested > 0 ? notFound / requested : 0;
  if (notFound >= notFoundCountMin && notFoundRate >= notFoundRateThreshold) {
    alerts.push(buildAlert(
      'not_found_rate_threshold',
      'medium',
      `Not-found rate ${notFoundRate.toFixed(3)} exceeded threshold ${notFoundRateThreshold.toFixed(3)}.`,
      { requested, notFound, notFoundRate, threshold: notFoundRateThreshold, minimumCount: notFoundCountMin }
    ));
  }

  const baselines = await getRecentRunBaselines(runId, lookbackRuns);
  if (baselines.length >= 3) {
    const baselineFailedAvg = average(baselines.map((row) => asNumber(row.failed, 0)));
    const baselineNotFoundAvg = average(baselines.map((row) => asNumber(row.notFound, 0)));

    if (failed > 0 && failed >= Math.ceil(baselineFailedAvg * spikeMultiplier)) {
      alerts.push(buildAlert(
        'failure_spike',
        'high',
        `Failures spiked to ${failed}; baseline average is ${baselineFailedAvg.toFixed(2)}.`,
        { failed, baselineFailedAvg, spikeMultiplier, lookbackRuns }
      ));
    }

    if (notFound > 0 && notFound >= Math.ceil(baselineNotFoundAvg * spikeMultiplier)) {
      alerts.push(buildAlert(
        'not_found_spike',
        'medium',
        `Not-found count spiked to ${notFound}; baseline average is ${baselineNotFoundAvg.toFixed(2)}.`,
        { notFound, baselineNotFoundAvg, spikeMultiplier, lookbackRuns }
      ));
    }
  }

  const metrics = getMetricsSnapshot();
  if (metrics.lastSuccessfulCourseSyncAt) {
    const lastSuccessMs = new Date(metrics.lastSuccessfulCourseSyncAt).getTime();
    if (!Number.isNaN(lastSuccessMs)) {
      const ageHours = (Date.now() - lastSuccessMs) / (1000 * 60 * 60);
      if (ageHours >= staleSyncHours) {
        alerts.push(buildAlert(
          'stale_successful_sync',
          'high',
          `Last successful course sync is stale (${ageHours.toFixed(1)} hours old).`,
          { lastSuccessfulCourseSyncAt: metrics.lastSuccessfulCourseSyncAt, staleHours: ageHours, thresholdHours: staleSyncHours }
        ));
      }
    }
  }

  return alerts;
}

async function insertRunSummary(runId, runContext, summary) {
  const sql = database.sql;
  await database.query(
    `INSERT INTO dbo.GHIN_ReconciliationRuns
      (runId, runContext, mode, batchSize, startedAt, finishedAt, completed, resumeOffset,
       requested, updated, nochange, failed, notFound)
     VALUES
      (@runId, @runContext, @mode, @batchSize, @startedAt, @finishedAt, @completed, @resumeOffset,
       @requested, @updated, @nochange, @failed, @notFound)`,
    {
      runId: { type: sql.UniqueIdentifier, value: runId },
      runContext: { type: sql.NVarChar(40), value: runContext },
      mode: { type: sql.NVarChar(40), value: summary.mode },
      batchSize: { type: sql.Int, value: summary.batchSize },
      startedAt: { type: sql.DateTime2, value: new Date(summary.startedAt) },
      finishedAt: { type: sql.DateTime2, value: new Date(summary.finishedAt) },
      completed: { type: sql.Bit, value: summary.completed ? 1 : 0 },
      resumeOffset: { type: sql.Int, value: summary.resumeOffset },
      requested: { type: sql.Int, value: summary.requested },
      updated: { type: sql.Int, value: summary.updated },
      nochange: { type: sql.Int, value: summary.nochange },
      failed: { type: sql.Int, value: summary.failed },
      notFound: { type: sql.Int, value: summary.notFound }
    }
  );
}

async function insertRunResults(runId, results) {
  if (!Array.isArray(results) || !results.length) {
    return;
  }

  const sql = database.sql;
  for (const result of results) {
    await database.query(
      `INSERT INTO dbo.GHIN_ReconciliationRunResults
        (runId, courseId, status, skipped, payloadHash, errorMessage)
       VALUES
        (@runId, @courseId, @status, @skipped, @payloadHash, @errorMessage)`,
      {
        runId: { type: sql.UniqueIdentifier, value: runId },
        courseId: { type: sql.VarChar(50), value: String(result.courseId || '') },
        status: { type: sql.NVarChar(30), value: String(result.status || 'unknown') },
        skipped: { type: sql.Bit, value: result.skipped == null ? null : (result.skipped ? 1 : 0) },
        payloadHash: { type: sql.VarChar(64), value: result.hash ? String(result.hash) : null },
        errorMessage: { type: sql.NVarChar(2000), value: result.error ? String(result.error).slice(0, 2000) : null }
      }
    );
  }
}

async function insertAlerts(runId, alerts) {
  if (!alerts.length) {
    return;
  }

  const sql = database.sql;
  for (const alert of alerts) {
    await database.query(
      `INSERT INTO dbo.GHIN_ReconciliationAlerts
        (runId, alertType, severity, message, detailsJson)
       VALUES
        (@runId, @alertType, @severity, @message, @detailsJson)`,
      {
        runId: { type: sql.UniqueIdentifier, value: runId },
        alertType: { type: sql.NVarChar(50), value: alert.type },
        severity: { type: sql.NVarChar(20), value: alert.severity },
        message: { type: sql.NVarChar(500), value: alert.message },
        detailsJson: { type: sql.NVarChar(sql.MAX), value: JSON.stringify(alert.details || {}) }
      }
    );
  }
}

async function persistReconciliationRun(summary, options = {}) {
  await ensureSchema();

  const runId = crypto.randomUUID();
  const runContext = String(options.runContext || 'unknown').slice(0, 40);
  const normalized = buildSummaryShape(summary || {});
  const results = Array.isArray(summary?.results) ? summary.results : [];

  await insertRunSummary(runId, runContext, normalized);
  await insertRunResults(runId, results);

  const alerts = await evaluateAlerts({ runId, summary: normalized });
  await insertAlerts(runId, alerts);

  if (alerts.length) {
    logger.warn('Reconciliation alerts triggered', {
      runId,
      runContext,
      alertCount: alerts.length,
      alertTypes: alerts.map((a) => a.type)
    });
  }

  return {
    runId,
    alerts,
    persistedAt: new Date().toISOString()
  };
}

async function getDurableMetricsSnapshot(options = {}) {
  await ensureSchema();

  const sql = database.sql;
  const runLimit = Math.max(1, asNumber(options.runLimit, 5));
  const alertLimit = Math.max(1, asNumber(options.alertLimit, 10));

  const runs = await database.query(
    `SELECT TOP (@runLimit)
        runId, runContext, mode, batchSize, startedAt, finishedAt, completed, resumeOffset,
        requested, updated, nochange, failed, notFound, createdAt
      FROM dbo.GHIN_ReconciliationRuns
      ORDER BY createdAt DESC`,
    {
      runLimit: { type: sql.Int, value: runLimit }
    }
  );

  const alerts = await database.query(
    `SELECT TOP (@alertLimit)
        id, runId, alertType, severity, message, detailsJson, createdAt
      FROM dbo.GHIN_ReconciliationAlerts
      ORDER BY createdAt DESC`,
    {
      alertLimit: { type: sql.Int, value: alertLimit }
    }
  );

  const latestRun = runs[0] || null;

  return {
    latestRun,
    recentRuns: runs,
    recentAlerts: alerts.map((row) => {
      let parsedDetails = null;
      try {
        parsedDetails = row.detailsJson ? JSON.parse(row.detailsJson) : null;
      } catch (_) {
        parsedDetails = null;
      }

      return {
        id: row.id,
        runId: row.runId,
        type: row.alertType,
        severity: row.severity,
        message: row.message,
        details: parsedDetails,
        createdAt: row.createdAt
      };
    })
  };
}

module.exports = {
  persistReconciliationRun,
  getDurableMetricsSnapshot
};
