const express = require('express');
const { body, query, validationResult } = require('express-validator');
const { createLogger } = require('../utils/logger');
const usaGhinApiClient = require('../services/usaGhinApiClient');
const { processCourseSync, reconcileCourses, reconcileAllCandidates } = require('../services/courseSyncService');
const { ensureCourseWebhook, getCourseWebhookStatus } = require('../services/ghinWebhookService');
const { loadSecrets } = require('../config/secrets');
const { getMetricsSnapshot } = require('../services/syncMetricsService');
const { getDurableMetricsSnapshot } = require('../services/reconciliationHistoryService');

const router = express.Router();
const logger = createLogger('webhooks');

async function ensureRuntimeSecretsLoaded() {
  const secrets = await loadSecrets();
  Object.assign(process.env, secrets);
}

function getCourseIdFromPayload(payload) {
  if (!payload || typeof payload !== 'object') {
    return null;
  }

  const direct = payload.courseId || payload.course_id || payload.CourseID;
  if (direct) {
    return String(direct);
  }

  const nested = payload.course?.courseId
    || payload.course?.course_id
    || payload.course?.CourseID
    || payload.data?.courseId
    || payload.data?.course_id
    || payload.data?.CourseID;

  if (nested) {
    return String(nested);
  }

  return null;
}

function assertWebhookToken(req) {
  const expected = process.env.GHIN_COURSE_WEBHOOK_TOKEN;
  if (!expected) {
    throw Object.assign(new Error('GHIN_COURSE_WEBHOOK_TOKEN is not configured.'), {
      status: 500,
      code: 'WEBHOOK_AUTH_NOT_CONFIGURED'
    });
  }

  const token = req.query.token;
  if (!token || token !== expected) {
    throw Object.assign(new Error('Invalid webhook token.'), {
      status: 401,
      code: 'INVALID_WEBHOOK_TOKEN'
    });
  }
}

router.post(
  '/ghin/course',
  [query('token').isString().trim().notEmpty()],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        error: {
          code: 'INVALID_REQUEST',
          message: 'Missing or invalid webhook token parameter.',
          details: errors.array()
        }
      });
    }

    try {
      await ensureRuntimeSecretsLoaded();
      assertWebhookToken(req);

      const courseId = getCourseIdFromPayload(req.body);
      if (!courseId) {
        logger.warn('Ignored GHIN course webhook without course id', {
          payloadKeys: Object.keys(req.body || {})
        });
        return res.status(202).json({ status: 'ignored', reason: 'missing_course_id' });
      }

      const course = await usaGhinApiClient.getCourse(courseId);
      if (!course) {
        logger.warn('GHIN webhook referenced unknown course id', { courseId });
        return res.status(202).json({ status: 'ignored', reason: 'course_not_found', courseId });
      }

      const mirrorResult = await processCourseSync(course);

      return res.status(202).json({
        status: 'accepted',
        courseId,
        mirrorStatus: mirrorResult?.status || 'ok'
      });
    } catch (error) {
      const status = error.status || 500;
      logger.error('Course webhook processing failed', {
        status,
        code: error.code || 'WEBHOOK_PROCESSING_ERROR',
        error: error.message
      });

      return res.status(status).json({
        error: {
          code: error.code || 'WEBHOOK_PROCESSING_ERROR',
          message: error.message
        }
      });
    }
  }
);

router.get('/ghin/course/status', async (_req, res) => {
  try {
    await ensureRuntimeSecretsLoaded();
    const status = await getCourseWebhookStatus();
    res.json(status);
  } catch (error) {
    logger.error('Failed to fetch course webhook status', { error: error.message });
    res.status(502).json({
      error: {
        code: 'WEBHOOK_STATUS_FAILED',
        message: error.message
      }
    });
  }
});

router.get('/ghin/course/metrics', async (_req, res) => {
  const inMemory = getMetricsSnapshot();

  try {
    const durable = await getDurableMetricsSnapshot();
    res.json({
      inMemory,
      durable
    });
  } catch (error) {
    logger.error('Failed to load durable course metrics', { error: error.message });
    res.json({
      inMemory,
      durable: {
        error: error.message
      }
    });
  }
});

router.get(
  '/ghin/course/list',
  [query('page').optional().isInt({ min: 1 }), query('perPage').optional().isInt({ min: 1, max: 100 })],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        error: {
          code: 'INVALID_REQUEST',
          message: 'Invalid list query parameters.',
          details: errors.array()
        }
      });
    }

    try {
      await ensureRuntimeSecretsLoaded();
      const page = req.query.page ? Number(req.query.page) : 1;
      const perPage = req.query.perPage ? Number(req.query.perPage) : 25;
      const list = await usaGhinApiClient.listWebhooks({ page, perPage });
      res.json({ page, perPage, list });
    } catch (error) {
      logger.error('Failed to list course webhooks', { error: error.message });
      res.status(502).json({
        error: {
          code: 'WEBHOOK_LIST_FAILED',
          message: error.message
        }
      });
    }
  }
);

router.post('/ghin/course/test', async (_req, res) => {
  try {
    await ensureRuntimeSecretsLoaded();
    const result = await usaGhinApiClient.testWebhook('course');
    res.json({ type: 'course', result });
  } catch (error) {
    logger.error('Failed to trigger course webhook test', { error: error.message });
    res.status(502).json({
      error: {
        code: 'WEBHOOK_TEST_FAILED',
        message: error.message
      }
    });
  }
});

router.post(
  '/ghin/course/ensure',
  [body('callbackUrl').optional().isURL(), body('runTest').optional().isBoolean()],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        error: {
          code: 'INVALID_REQUEST',
          message: 'Invalid ensure webhook request body.',
          details: errors.array()
        }
      });
    }

    try {
      await ensureRuntimeSecretsLoaded();
      const result = await ensureCourseWebhook({
        callbackUrl: req.body.callbackUrl,
        runTest: Boolean(req.body.runTest)
      });
      res.json(result);
    } catch (error) {
      logger.error('Failed to ensure course webhook settings', { error: error.message });
      res.status(500).json({
        error: {
          code: 'WEBHOOK_ENSURE_FAILED',
          message: error.message
        }
      });
    }
  }
);

router.post(
  '/ghin/course/reconcile',
  [
    body('courseIds').optional().isArray(),
    body('courseIds.*').optional().isString().trim().notEmpty(),
    body('batchSize').optional().isInt({ min: 1, max: 5000 }),
    body('concurrency').optional().isInt({ min: 1, max: 20 }),
    body('maxWindowMinutes').optional().isInt({ min: 1, max: 1440 }),
    body('startOffset').optional().isInt({ min: 0 })
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        error: {
          code: 'INVALID_REQUEST',
          message: 'Invalid reconciliation request body.',
          details: errors.array()
        }
      });
    }

    try {
      const startedAtMs = Date.now();
      await ensureRuntimeSecretsLoaded();
      const requestedIds = Array.isArray(req.body.courseIds)
        ? req.body.courseIds.map((x) => String(x).trim()).filter(Boolean)
        : [];

      if (requestedIds.length > 0) {
        const concurrency = Number(req.body.concurrency || process.env.GHIN_RECONCILIATION_CONCURRENCY || 3);
        logger.info('Course reconciliation started', {
          mode: 'explicit',
          requestedCount: requestedIds.length,
          concurrency
        });

        const summary = await reconcileCourses(requestedIds, {
          runContext: 'api-explicit',
          concurrency
        });

        logger.info('Course reconciliation completed', {
          mode: 'explicit',
          requested: summary.requested,
          updated: summary.updated,
          nochange: summary.nochange,
          notFound: summary.notFound,
          failed: summary.failed,
          durationMs: Date.now() - startedAtMs
        });

        return res.json({ mode: 'explicit', summary });
      }

      const batchSize = Number(req.body.batchSize || process.env.GHIN_RECONCILIATION_BATCH_SIZE || 100);
      const concurrency = Number(req.body.concurrency || process.env.GHIN_RECONCILIATION_CONCURRENCY || 3);
      const maxWindowMinutes = Number(req.body.maxWindowMinutes || 0);
      const startOffset = Number(req.body.startOffset || 0);
      logger.info('Course reconciliation started', {
        mode: 'full-sweep',
        batchSize,
        concurrency,
        maxWindowMinutes,
        startOffset
      });

      const summary = await reconcileAllCandidates({
        batchSize,
        concurrency,
        startOffset,
        maxDurationMs: maxWindowMinutes > 0 ? maxWindowMinutes * 60 * 1000 : 0,
        runContext: 'api-full-sweep'
      });

      logger.info('Course reconciliation completed', {
        mode: 'full-sweep',
        requested: summary.requested,
        updated: summary.updated,
        nochange: summary.nochange,
        notFound: summary.notFound,
        failed: summary.failed,
        completed: summary.completed,
        resumeOffset: summary.resumeOffset,
        durationMs: Date.now() - startedAtMs
      });

      return res.json({
        mode: 'full-sweep',
        summary
      });
    } catch (error) {
      logger.error('Course reconciliation failed', { error: error.message });
      res.status(500).json({
        error: {
          code: 'RECONCILIATION_FAILED',
          message: error.message
        }
      });
    }
  }
);

module.exports = router;
