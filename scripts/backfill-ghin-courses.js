/**
 * Discover and backfill GHIN courses into CacheDB + runtime mirror.
 *
 * Strategy:
 * - Discover course IDs by crawling GHIN /courses/search partitioned by state
 * - Diff discovered IDs against GHIN_Courses in CacheDB in batched queries
 * - Fetch and sync only missing course IDs through the existing course sync pipeline
 * - Persist lightweight checkpoint state so long runs can resume
 *
 * Usage examples:
 *   node scripts/backfill-ghin-courses.js
 *   node scripts/backfill-ghin-courses.js --states=US-WA,US-OR --sync-concurrency=12
 *   node scripts/backfill-ghin-courses.js --states=US-CT --sync-concurrency=8 --mirror-concurrency=2
 *   node scripts/backfill-ghin-courses.js --states=US-NY --projection-mode=none --cache-batch-size=100
 *   node scripts/backfill-ghin-courses.js --states=US-GA --projection-mode=none --validation-chunk-size=25 --cache-batch-size=100
 *   node scripts/backfill-ghin-courses.js --states=US-VT --sync-concurrency=16 --cache-write-concurrency=4 --projection-mode=none
 *   node scripts/backfill-ghin-courses.js --states=US-NY --projection-mode=none
 *   node scripts/backfill-ghin-courses.js --states=US-CT --validate-only
 *   node scripts/backfill-ghin-courses.js --dry-run --search-concurrency=8
 *   node scripts/backfill-ghin-courses.js --reset-checkpoint
 *   node scripts/backfill-ghin-courses.js --states=US-NY --projection-mode=none --exclude-course-ids=3857
 */

const fs = require('fs');
const path = require('path');
const database = require('../src/services/database');
const { loadSecrets } = require('../src/config/secrets');
const specialImportOverrides = require('./config/special-course-import-overrides');

const CHECKPOINT_PATH = path.join(__dirname, 'logs', 'ghin-course-backfill-checkpoint.json');
const STATE_AUDIT_DIR = path.join(__dirname, 'logs', 'state-audits');
const US_JURISDICTION_CODES = [
  'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'DC', 'FL',
  'GA', 'GU', 'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA',
  'ME', 'MD', 'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV',
  'NH', 'NJ', 'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA',
  'PR', 'RI', 'SC', 'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'VI',
  'WA', 'WV', 'WI', 'WY', 'AS', 'MP'
];

function cloneHole(hole) {
  return {
    ...hole
  };
}

function cloneTee(tee) {
  return {
    ...tee,
    holes: Array.isArray(tee?.holes) ? tee.holes.map(cloneHole) : []
  };
}

function cloneCourse(course, teesOverride = null) {
  return {
    ...course,
    tees: Array.isArray(teesOverride)
      ? teesOverride.map(cloneTee)
      : Array.isArray(course?.tees)
        ? course.tees.map(cloneTee)
        : []
  };
}

function cloneAndNormalizeHole(hole, nextHoleNumber = null) {
  return {
    ...hole,
    holeNumber: nextHoleNumber == null ? hole?.holeNumber : nextHoleNumber
  };
}

function summarizeTeeForAudit(tee, extra = {}) {
  return {
    teeId: String(tee?.teeId || ''),
    teeName: tee?.teeName || null,
    gender: tee?.gender || null,
    teeSetSide: tee?.teeSetSide || 'All18',
    ...extra
  };
}

function inspectCourseComponentValidity(course, validateCourseForSync) {
  const validTees = [];
  const validTeeAudit = [];
  const invalidTees = [];

  for (const tee of course?.tees || []) {
    const teeClone = cloneTee(tee);
    try {
      validateCourseForSync(cloneCourse(course, [teeClone]));
      validTees.push(teeClone);
      validTeeAudit.push(summarizeTeeForAudit(teeClone, {
        holeCount: Array.isArray(teeClone.holes) ? teeClone.holes.length : 0
      }));
    } catch (error) {
      invalidTees.push(summarizeTeeForAudit(teeClone, {
        holeCount: Array.isArray(teeClone.holes) ? teeClone.holes.length : 0,
        reason: error.message
      }));
    }
  }

  return {
    validTees,
    audit: {
      totalTeeCount: validTees.length + invalidTees.length,
      validTeeCount: validTees.length,
      invalidTeeCount: invalidTees.length,
      pruneCandidate: validTees.length > 0 && invalidTees.length > 0,
      validTees: validTeeAudit,
      invalidTees
    }
  };
}

function extractSampleHoleNumbers(reason) {
  const message = String(reason || '');
  const sampleMatch = message.match(/Sample:\s+(.+)$/i);
  if (!sampleMatch) {
    return [];
  }

  return sampleMatch[1]
    .split(',')
    .map((entry) => String(entry || '').trim())
    .map((entry) => Number(entry.split(':')[1]))
    .filter((holeNumber) => Number.isFinite(holeNumber));
}

function analyzeInvalidTeeFailure(teeAudit) {
  const reason = String(teeAudit?.reason || '');
  const holeCount = Number(teeAudit?.holeCount || 0);
  const missingRowCountMatch = reason.match(/for\s+(\d+)\s+hole rows/i);
  const missingRowCount = missingRowCountMatch ? Number(missingRowCountMatch[1]) : null;
  const sampleHoleNumbers = extractSampleHoleNumbers(reason);
  const sampleMinHole = sampleHoleNumbers.length > 0 ? Math.min(...sampleHoleNumbers) : null;
  const sampleMaxHole = sampleHoleNumbers.length > 0 ? Math.max(...sampleHoleNumbers) : null;

  if (reason.includes('missing holes[]')) {
    return {
      shape: 'missing_holes_payload',
      holeCount,
      reason
    };
  }

  if (reason.includes('invalid par') || reason.includes('CK_GHIN_Holes_Par')) {
    return {
      shape: 'invalid_par',
      holeCount,
      reason
    };
  }

  if (reason.includes('invalid holeNumber') || reason.includes('could not be normalized to 9 holes')) {
    return {
      shape: 'malformed_tee_structure',
      holeCount,
      reason
    };
  }

  if (reason.includes('missing hole handicap/allocation data')) {
    if (missingRowCount != null && holeCount > 0 && missingRowCount === holeCount) {
      return {
        shape: holeCount === 9 ? 'all_published_holes_missing_handicap_9h' : 'all_published_holes_missing_handicap',
        holeCount,
        reason
      };
    }

    if (missingRowCount === 9 && holeCount === 18 && sampleMinHole != null && sampleMaxHole != null) {
      if (sampleMinHole >= 10 && sampleMaxHole <= 18) {
        return {
          shape: 'back_nine_missing_handicap_only',
          holeCount,
          reason
        };
      }

      if (sampleMinHole >= 1 && sampleMaxHole <= 9) {
        return {
          shape: 'front_nine_missing_handicap_only',
          holeCount,
          reason
        };
      }
    }

    return {
      shape: 'mixed_missing_handicap_pattern',
      holeCount,
      reason
    };
  }

  return {
    shape: 'other',
    holeCount,
    reason
  };
}

function classifyZeroValidTeeFailureBucket(componentAudit) {
  const invalidTees = Array.isArray(componentAudit?.invalidTees) ? componentAudit.invalidTees : [];
  if (!invalidTees.length) {
    return 'irreconcilable_no_valid_tees';
  }

  const teeAnalyses = invalidTees.map(analyzeInvalidTeeFailure);
  const shapes = new Set(teeAnalyses.map((tee) => tee.shape));

  if (shapes.has('missing_holes_payload')) {
    return 'irreconcilable_missing_holes_payload';
  }

  if (shapes.has('invalid_par')) {
    return 'irreconcilable_invalid_par';
  }

  if (shapes.has('malformed_tee_structure')) {
    return 'irreconcilable_malformed_tee_structure';
  }

  if (shapes.size === 1) {
    const [shape] = Array.from(shapes);

    if (shape === 'back_nine_missing_handicap_only') {
      return 'review_front_nine_only_normalization_candidate';
    }

    if (shape === 'front_nine_missing_handicap_only') {
      return 'review_back_nine_only_normalization_candidate';
    }

    if (shape === 'all_published_holes_missing_handicap_9h') {
      return 'irreconcilable_all_nine_hole_handicaps_missing';
    }

    if (shape === 'all_published_holes_missing_handicap') {
      return 'irreconcilable_all_published_hole_handicaps_missing';
    }

    if (shape === 'mixed_missing_handicap_pattern') {
      return 'irreconcilable_mixed_missing_handicap_patterns';
    }
  }

  if (Array.from(shapes).every((shape) => shape.startsWith('all_published_holes_missing_handicap'))) {
    return 'irreconcilable_mixed_all_published_hole_handicaps_missing';
  }

  if (Array.from(shapes).every((shape) => shape.includes('missing_handicap'))) {
    return 'irreconcilable_mixed_missing_handicap_patterns';
  }

  return 'irreconcilable_mixed_zero_valid_tee_shapes';
}

function classifyFailureBucket(errorMessage, componentAudit = null) {
  if (componentAudit?.pruneCandidate) {
    return 'repairable_partial_component_prune_candidate';
  }

  if (componentAudit && componentAudit.validTeeCount === 0 && componentAudit.invalidTeeCount > 0) {
    return classifyZeroValidTeeFailureBucket(componentAudit);
  }

  const message = String(errorMessage || '');

  if (message.includes('missing hole handicap/allocation data')) {
    return 'irreconcilable_missing_handicap';
  }

  if (message.includes('missing holes[]')) {
    return 'irreconcilable_missing_holes';
  }

  if (message.includes('invalid par') || message.includes('CK_GHIN_Holes_Par')) {
    return 'irreconcilable_invalid_par';
  }

  if (message.includes('invalid holeNumber')) {
    return 'irreconcilable_invalid_hole_number';
  }

  if (
    message.includes('deadlocked on lock resources')
    || message.includes('Mirror callback failed (500)')
    || message.includes('timeout')
    || message.includes('ECONNRESET')
    || message.includes('ETIMEDOUT')
  ) {
    return 'retryable_operational';
  }

  return 'other';
}

function normalizeFrontNineOnlyCourse(course) {
  const transformedTees = [];

  for (const tee of course?.tees || []) {
    const holes = Array.isArray(tee?.holes) ? tee.holes.map(cloneHole) : [];
    let selectedHoles = [];

    if (holes.length === 9) {
      selectedHoles = holes
        .filter((hole) => Number(hole?.holeNumber) >= 1 && Number(hole?.holeNumber) <= 9)
        .sort((left, right) => Number(left.holeNumber) - Number(right.holeNumber))
        .map((hole, index) => cloneAndNormalizeHole(hole, index + 1));
    } else if (holes.length === 18) {
      const frontNine = holes
        .filter((hole) => Number(hole?.holeNumber) >= 1 && Number(hole?.holeNumber) <= 9)
        .sort((left, right) => Number(left.holeNumber) - Number(right.holeNumber));
      selectedHoles = frontNine.map((hole, index) => cloneAndNormalizeHole(hole, index + 1));
    } else {
      throw new Error(`Course ${course?.courseId || ''} tee ${tee?.teeId || ''} could not be normalized to 9 holes.`);
    }

    const parF9 = tee?.parF9 ?? selectedHoles.reduce((total, hole) => total + Number(hole?.par || 0), 0);
    const yardageF9 = tee?.yardageF9 ?? selectedHoles.reduce((total, hole) => total + Number(hole?.yardage || 0), 0);

    transformedTees.push({
      ...tee,
      teeSetSide: 'F9',
      courseRating: tee?.courseRatingF9 ?? tee?.courseRating ?? null,
      slope: tee?.slopeRatingF9 ?? tee?.slope ?? null,
      par: parF9,
      yardage: yardageF9,
      courseRatingF9: tee?.courseRatingF9 ?? tee?.courseRating ?? null,
      slopeRatingF9: tee?.slopeRatingF9 ?? tee?.slope ?? null,
      parF9,
      yardageF9,
      courseRatingB9: null,
      slopeRatingB9: null,
      parB9: null,
      yardageB9: null,
      holes: selectedHoles
    });
  }

  return cloneCourse(course, transformedTees);
}

function normalizeRawGender(rawGender) {
  const normalized = String(rawGender || '').trim().toUpperCase();
  return normalized === 'W' || normalized === 'F' ? 'F' : 'M';
}

function createTeeMatchKey(tee) {
  return `${normalizeRawGender(tee?.gender)}::${String(tee?.teeName || '').trim().toLowerCase()}`;
}

function transformBackNineHoles(holes, handicapOffset = 1) {
  return (holes || []).map((hole, index) => ({
    ...cloneHole(hole),
    holeNumber: index + 10,
    handicap: hole?.handicap == null ? null : Number(hole.handicap) + handicapOffset
  }));
}

function composeNineHoleComboCourse(comboCourse, frontCourse, backCourse, override) {
  const normalizedFront = normalizeFrontNineOnlyCourse(frontCourse);
  const normalizedBack = normalizeFrontNineOnlyCourse(backCourse);
  const frontByKey = new Map((normalizedFront.tees || []).map((tee) => [createTeeMatchKey(tee), tee]));
  const backByKey = new Map((normalizedBack.tees || []).map((tee) => [createTeeMatchKey(tee), tee]));
  const handicapOffset = Number.isFinite(override?.backNineHandicapOffset)
    ? Number(override.backNineHandicapOffset)
    : 1;

  const combinedTees = (comboCourse?.tees || []).map((comboTee) => {
    const key = createTeeMatchKey(comboTee);
    const frontTee = frontByKey.get(key);
    const backTee = backByKey.get(key);

    if (!frontTee || !backTee) {
      throw new Error(
        `Course ${comboCourse?.courseId || ''} could not match combo tee ${comboTee?.teeName || ''}/${comboTee?.gender || ''} to component nines.`
      );
    }

    const frontHoles = (frontTee.holes || []).map((hole, index) => cloneAndNormalizeHole(hole, index + 1));
    const backHoles = transformBackNineHoles(backTee.holes || [], handicapOffset);

    return {
      ...comboTee,
      teeSetSide: comboTee?.teeSetSide || 'All18',
      holes: [...frontHoles, ...backHoles]
    };
  });

  return cloneCourse(comboCourse, combinedTees);
}

function getSpecialImportOverride(courseId) {
  return specialImportOverrides[String(courseId)] || null;
}

function tryPrepareSpecialImport(course, override, validateCourseForSync, triggerErrorMessage, inspection = null) {
  if (!override) {
    return null;
  }

  if (override.strategy === 'front-nine-nine-hole') {
    const transformedCourse = normalizeFrontNineOnlyCourse(course);
    validateCourseForSync(transformedCourse);

    return {
      applied: true,
      course: transformedCourse,
      specialImport: {
        courseId: String(course.courseId || ''),
        courseName: course.courseName || null,
        strategy: override.strategy,
        note: override.note || null,
        triggerError: triggerErrorMessage,
        originalTeeCount: Array.isArray(course?.tees) ? course.tees.length : 0,
        keptTeeCount: Array.isArray(transformedCourse?.tees) ? transformedCourse.tees.length : 0,
        prunedTeeCount: 0,
        keptTees: (transformedCourse?.tees || []).map((tee) => summarizeTeeForAudit(tee, {
          holeCount: Array.isArray(tee?.holes) ? tee.holes.length : 0,
          teeSetSide: tee?.teeSetSide || 'F9'
        })),
        prunedTees: []
      }
    };
  }

  if (override.strategy !== 'drop-invalid-tees') {
    return null;
  }

  const resolvedInspection = inspection || inspectCourseComponentValidity(course, validateCourseForSync);
  const minimumValidTees = Number.isFinite(override.minimumValidTees)
    ? Math.max(1, Math.floor(override.minimumValidTees))
    : 1;

  if (!resolvedInspection.audit.pruneCandidate || resolvedInspection.audit.validTeeCount < minimumValidTees) {
    return {
      applied: false,
      componentAudit: resolvedInspection.audit
    };
  }

  const prunedCourse = cloneCourse(course, resolvedInspection.validTees);
  validateCourseForSync(prunedCourse);

  return {
    applied: true,
    course: prunedCourse,
    specialImport: {
      courseId: String(course.courseId || ''),
      courseName: course.courseName || null,
      strategy: override.strategy,
      note: override.note || null,
      triggerError: triggerErrorMessage,
      originalTeeCount: resolvedInspection.audit.totalTeeCount,
      keptTeeCount: resolvedInspection.audit.validTeeCount,
      prunedTeeCount: resolvedInspection.audit.invalidTeeCount,
      keptTees: resolvedInspection.audit.validTees,
      prunedTees: resolvedInspection.audit.invalidTees
    }
  };
}

async function prepareCourseForBackfill(course, validateCourseForSync, context = {}) {
  try {
    validateCourseForSync(course);
    return {
      course,
      specialImport: null
    };
  } catch (error) {
    const inspection = inspectCourseComponentValidity(course, validateCourseForSync);
    const override = getSpecialImportOverride(course?.courseId);
    let specialImportResult = null;

    if (override?.strategy === 'compose-nine-hole-combo') {
      const client = context.client;
      if (!client) {
        throw error;
      }

      const frontCourse = await client.getCourse(String(override.frontCourseId));
      const backCourse = await client.getCourse(String(override.backCourseId));
      const composedCourse = composeNineHoleComboCourse(course, frontCourse, backCourse, override);
      validateCourseForSync(composedCourse);

      specialImportResult = {
        applied: true,
        course: composedCourse,
        specialImport: {
          courseId: String(course.courseId || ''),
          courseName: course.courseName || null,
          strategy: override.strategy,
          note: override.note || null,
          triggerError: error.message,
          sourceComponentCourses: [String(override.frontCourseId), String(override.backCourseId)],
          originalTeeCount: Array.isArray(course?.tees) ? course.tees.length : 0,
          keptTeeCount: Array.isArray(composedCourse?.tees) ? composedCourse.tees.length : 0,
          prunedTeeCount: 0,
          keptTees: (composedCourse?.tees || []).map((tee) => summarizeTeeForAudit(tee, {
            holeCount: Array.isArray(tee?.holes) ? tee.holes.length : 0,
            teeSetSide: tee?.teeSetSide || 'All18'
          })),
          prunedTees: []
        }
      };
    } else {
      specialImportResult = tryPrepareSpecialImport(course, override, validateCourseForSync, error.message, inspection);
    }

    if (specialImportResult?.applied) {
      return {
        course: specialImportResult.course,
        specialImport: specialImportResult.specialImport
      };
    }

    error.componentAudit = specialImportResult?.componentAudit || inspection.audit;
    error.failureBucket = classifyFailureBucket(error.message, error.componentAudit);
    throw error;
  }
}

function buildFailureBucketSummary(failures) {
  const grouped = {};

  for (const failure of failures || []) {
    const bucket = failure.failureBucket || classifyFailureBucket(failure.error, failure.componentAudit);
    if (!grouped[bucket]) {
      grouped[bucket] = {
        count: 0,
        courses: []
      };
    }

    grouped[bucket].count += 1;
    grouped[bucket].courses.push({
      courseId: failure.courseId,
      courseName: failure.courseName || null,
      failureClass: failure.failureClass || null,
      error: failure.error,
      componentAudit: failure.componentAudit || null
    });
  }

  return grouped;
}

function writeStateAudit(state, summary, args) {
  const auditPath = path.join(STATE_AUDIT_DIR, `ghin-course-backfill-audit-${state}.json`);
  const audit = {
    generatedAt: new Date().toISOString(),
    state,
    mode: args.validateOnly ? 'validate-only' : args.dryRun ? 'dry-run' : 'backfill',
    projectionMode: args.projectionMode,
    totals: {
      discovered: summary.discovered,
      excluded: summary.excluded,
      existing: summary.existing,
      missing: summary.missing,
      validated: summary.validated,
      synced: summary.synced,
      failed: summary.failed
    },
    failureBreakdown: summary.failureBreakdown,
    failureBuckets: buildFailureBucketSummary(summary.failures),
    specialImportsApplied: summary.specialImports
  };

  ensureParentDir(auditPath);
  fs.writeFileSync(auditPath, JSON.stringify(audit, null, 2));
  return auditPath;
}

function createFailureBreakdown() {
  return {
    retryableOperational: 0,
    sourceData: 0,
    other: 0
  };
}

function createTimingMetric() {
  return {
    count: 0,
    totalMs: 0,
    avgMs: 0,
    minMs: null,
    maxMs: 0
  };
}

function createPerformanceSummary() {
  return {
    fetchDurationMs: createTimingMetric(),
    validationDurationMs: createTimingMetric(),
    noopDetectionDurationMs: createTimingMetric(),
    upsertDurationMs: createTimingMetric(),
    mirrorDurationMs: createTimingMetric(),
    syncDurationMs: createTimingMetric(),
    totalDurationMs: createTimingMetric()
  };
}

function createOrchestrationSummary() {
  return {
    discoveryDurationMs: createTimingMetric(),
    existingIdsDurationMs: createTimingMetric(),
    validationToFlushWaitDurationMs: createTimingMetric(),
    checkpointSaveDurationMs: createTimingMetric(),
    stateTotalDurationMs: createTimingMetric()
  };
}

function recordTimingMetric(metric, durationMs) {
  if (!metric || !Number.isFinite(durationMs) || durationMs < 0) {
    return;
  }

  metric.count += 1;
  metric.totalMs += durationMs;
  metric.avgMs = Number((metric.totalMs / metric.count).toFixed(1));
  metric.minMs = metric.minMs == null ? durationMs : Math.min(metric.minMs, durationMs);
  metric.maxMs = Math.max(metric.maxMs, durationMs);
}

function recordPerformanceSummary(summary, timings) {
  if (!summary || !timings) {
    return;
  }

  Object.keys(summary).forEach((key) => {
    recordTimingMetric(summary[key], timings[key]);
  });
}

function createRunTotals() {
  return {
    discovered: 0,
    missing: 0,
    validated: 0,
    synced: 0,
    skippedExisting: 0,
    failed: 0,
    incompleteDiscoveryStates: [],
    failureBreakdown: createFailureBreakdown(),
    performance: createPerformanceSummary(),
    orchestration: createOrchestrationSummary(),
    writeBreakdown: createWriteBreakdownSummary()
  };
}

function createWriteBreakdownSummary() {
  return {
    flushCount: 0,
    courseCount: 0,
    teeCount: 0,
    holeCount: 0,
    buildPayloadDurationMs: createTimingMetric(),
    coursesMergeDurationMs: createTimingMetric(),
    teesMergeDurationMs: createTimingMetric(),
    holesMergeDurationMs: createTimingMetric(),
    commitDurationMs: createTimingMetric(),
    totalDurationMs: createTimingMetric()
  };
}

function recordWriteBreakdownSummary(summary, batchTiming) {
  if (!summary || !batchTiming) {
    return;
  }

  summary.flushCount += 1;
  summary.courseCount += Number(batchTiming.courseCount || 0);
  summary.teeCount += Number(batchTiming.teeCount || 0);
  summary.holeCount += Number(batchTiming.holeCount || 0);

  recordTimingMetric(summary.buildPayloadDurationMs, batchTiming.timings?.buildPayloadDurationMs);
  recordTimingMetric(summary.coursesMergeDurationMs, batchTiming.timings?.coursesMergeDurationMs);
  recordTimingMetric(summary.teesMergeDurationMs, batchTiming.timings?.teesMergeDurationMs);
  recordTimingMetric(summary.holesMergeDurationMs, batchTiming.timings?.holesMergeDurationMs);
  recordTimingMetric(summary.commitDurationMs, batchTiming.timings?.commitDurationMs);
  recordTimingMetric(summary.totalDurationMs, batchTiming.timings?.totalDurationMs);
}

function summarizeWriteBreakdown(summary) {
  return {
    flushCount: summary.flushCount,
    courseCount: summary.courseCount,
    teeCount: summary.teeCount,
    holeCount: summary.holeCount,
    buildPayloadAvgMs: summary.buildPayloadDurationMs.avgMs,
    coursesMergeAvgMs: summary.coursesMergeDurationMs.avgMs,
    teesMergeAvgMs: summary.teesMergeDurationMs.avgMs,
    holesMergeAvgMs: summary.holesMergeDurationMs.avgMs,
    commitAvgMs: summary.commitDurationMs.avgMs,
    totalFlushAvgMs: summary.totalDurationMs.avgMs
  };
}

function summarizeOrchestrationSummary(summary) {
  return {
    discoveryTotalMs: summary.discoveryDurationMs.totalMs,
    existingIdsTotalMs: summary.existingIdsDurationMs.totalMs,
    validationToFlushWaitTotalMs: summary.validationToFlushWaitDurationMs.totalMs,
    checkpointSaveTotalMs: summary.checkpointSaveDurationMs.totalMs,
    stateTotalMs: summary.stateTotalDurationMs.totalMs
  };
}

function summarizePerformanceSummary(summary) {
  return {
    fetchAvgMs: summary.fetchDurationMs.avgMs,
    fetchTotalMs: summary.fetchDurationMs.totalMs,
    validationAvgMs: summary.validationDurationMs.avgMs,
    validationTotalMs: summary.validationDurationMs.totalMs,
    noopDetectionAvgMs: summary.noopDetectionDurationMs.avgMs,
    noopDetectionTotalMs: summary.noopDetectionDurationMs.totalMs,
    upsertAvgMs: summary.upsertDurationMs.avgMs,
    upsertTotalMs: summary.upsertDurationMs.totalMs,
    mirrorAvgMs: summary.mirrorDurationMs.avgMs,
    mirrorTotalMs: summary.mirrorDurationMs.totalMs,
    syncAvgMs: summary.syncDurationMs.avgMs,
    syncTotalMs: summary.syncDurationMs.totalMs,
    totalCourseAvgMs: summary.totalDurationMs.avgMs,
    totalCourseMs: summary.totalDurationMs.totalMs
  };
}

function createEmptyCheckpoint() {
  return {
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    completedStates: [],
    failedStates: {},
    totals: {
      discovered: 0,
      missing: 0,
      synced: 0,
      skippedExisting: 0,
      failed: 0,
      failureBreakdown: createFailureBreakdown()
    },
    stateSummaries: {}
  };
}

function hydrateCheckpoint(checkpoint) {
  const next = checkpoint && typeof checkpoint === 'object' ? checkpoint : createEmptyCheckpoint();
  next.completedStates = Array.isArray(next.completedStates) ? next.completedStates : [];
  next.failedStates = next.failedStates && typeof next.failedStates === 'object' ? next.failedStates : {};
  next.stateSummaries = next.stateSummaries && typeof next.stateSummaries === 'object' ? next.stateSummaries : {};
  next.totals = next.totals && typeof next.totals === 'object' ? next.totals : {};
  next.totals.discovered = Number(next.totals.discovered || 0);
  next.totals.missing = Number(next.totals.missing || 0);
  next.totals.synced = Number(next.totals.synced || 0);
  next.totals.skippedExisting = Number(next.totals.skippedExisting || 0);
  next.totals.failed = Number(next.totals.failed || 0);
  next.totals.failureBreakdown = {
    ...createFailureBreakdown(),
    ...(next.totals.failureBreakdown || {})
  };
  return next;
}

function classifyFailure(errorMessage) {
  const message = String(errorMessage || '');
  if (
    message.includes('missing hole handicap/allocation data')
    || message.includes('missing holes[]')
    || message.includes('invalid par')
    || message.includes('invalid holeNumber')
    || message.includes('CK_GHIN_Holes_Par')
  ) {
    return 'sourceData';
  }

  if (
    message.includes('deadlocked on lock resources')
    || message.includes('Mirror callback failed (500)')
    || message.includes('timeout')
    || message.includes('ECONNRESET')
    || message.includes('ETIMEDOUT')
  ) {
    return 'retryableOperational';
  }

  return 'other';
}

function parseArgs(argv) {
  const args = {
    states: null,
    excludeCourseIds: [],
    dryRun: false,
    validateOnly: false,
    searchConcurrency: 6,
    syncConcurrency: 8,
    cacheWriteConcurrency: 4,
    validationChunkSize: 25,
    cacheBatchSize: 100,
    mirrorConcurrency: 2,
    projectionMode: 'callback',
    dbBatchSize: 500,
    pageSize: 500,
    checkpointPath: CHECKPOINT_PATH,
    resetCheckpoint: false
  };

  for (const raw of argv) {
    if (raw === '--dry-run') {
      args.dryRun = true;
      continue;
    }
    if (raw === '--validate-only' || raw === '--preflight-only') {
      args.validateOnly = true;
      continue;
    }
    if (raw === '--reset-checkpoint') {
      args.resetCheckpoint = true;
      continue;
    }

    const [flag, value] = raw.split('=');
    if (value == null) continue;

    switch (flag) {
      case '--states':
        args.states = value
          .split(',')
          .map((item) => normalizeStatePartition(item))
          .filter(Boolean);
        break;
      case '--exclude-course-ids':
      case '--exclude-ids':
        args.excludeCourseIds.push(...parseCourseIds(value));
        break;
      case '--search-concurrency':
        args.searchConcurrency = parsePositiveInt(value, args.searchConcurrency);
        break;
      case '--sync-concurrency':
        args.syncConcurrency = parsePositiveInt(value, args.syncConcurrency);
        break;
      case '--cache-write-concurrency':
        args.cacheWriteConcurrency = parsePositiveInt(value, args.cacheWriteConcurrency);
        break;
      case '--validation-chunk-size':
        args.validationChunkSize = parsePositiveInt(value, args.validationChunkSize);
        break;
      case '--cache-batch-size':
        args.cacheBatchSize = parsePositiveInt(value, args.cacheBatchSize);
        break;
      case '--mirror-concurrency':
        args.mirrorConcurrency = parsePositiveInt(value, args.mirrorConcurrency);
        break;
      case '--projection-mode': {
        const normalized = String(value).trim().toLowerCase();
        if (normalized === 'callback' || normalized === 'none') {
          args.projectionMode = normalized;
        }
        break;
      }
      case '--db-batch-size':
        args.dbBatchSize = parsePositiveInt(value, args.dbBatchSize);
        break;
      case '--page-size':
        args.pageSize = parsePositiveInt(value, args.pageSize);
        break;
      case '--checkpoint':
        args.checkpointPath = path.resolve(value);
        break;
      default:
        break;
    }
  }

  if (args.dryRun && args.validateOnly) {
    throw new Error('Choose either --dry-run or --validate-only, not both.');
  }

  if (!['callback', 'none'].includes(args.projectionMode)) {
    throw new Error('Invalid --projection-mode value. Expected callback or none.');
  }

  args.excludeCourseIds = Array.from(new Set(args.excludeCourseIds));

  return args;
}

function parsePositiveInt(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function normalizeStatePartition(value) {
  const trimmed = String(value || '').trim().toUpperCase();
  if (!trimmed) return null;
  if (/^US-[A-Z]{2}$/.test(trimmed)) return trimmed;
  if (/^[A-Z]{2}$/.test(trimmed)) return `US-${trimmed}`;
  return null;
}

function parseCourseIds(value) {
  return Array.from(new Set(
    String(value || '')
      .split(',')
      .map((item) => String(item).trim())
      .filter(Boolean)
  ));
}

function ensureParentDir(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function loadCheckpoint(checkpointPath, reset) {
  if (reset || !fs.existsSync(checkpointPath)) {
    return createEmptyCheckpoint();
  }

  try {
    return hydrateCheckpoint(JSON.parse(fs.readFileSync(checkpointPath, 'utf8')));
  } catch (_) {
    return createEmptyCheckpoint();
  }
}

function saveCheckpoint(checkpointPath, checkpoint) {
  ensureParentDir(checkpointPath);
  checkpoint.updatedAt = new Date().toISOString();
  fs.writeFileSync(checkpointPath, JSON.stringify(checkpoint, null, 2));
}

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

function chunk(array, size) {
  const chunks = [];
  for (let index = 0; index < array.length; index += size) {
    chunks.push(array.slice(index, index + size));
  }
  return chunks;
}

function formatDuration(ms) {
  if (!Number.isFinite(ms) || ms < 1000) {
    return `${Math.max(0, Math.round(ms || 0))}ms`;
  }

  return `${(ms / 1000).toFixed(1)}s`;
}

function buildFailureSamples(failures, limitPerClass = 3) {
  const samples = {};

  for (const failure of failures || []) {
    const failureClass = failure.failureClass || 'other';
    if (!samples[failureClass]) {
      samples[failureClass] = [];
    }

    if (samples[failureClass].length < limitPerClass) {
      samples[failureClass].push(String(failure.courseId));
    }
  }

  return samples;
}

function summarizeStateForConsole(summary) {
  return {
    discovered: summary.discovered,
    existing: summary.existing,
    missing: summary.missing,
    validated: summary.validated,
    synced: summary.synced,
    failed: summary.failed,
    specialImportsApplied: summary.specialImports.length,
    failureBreakdown: summary.failureBreakdown,
    orchestration: summarizeOrchestrationSummary(summary.orchestration),
    writeBreakdown: summarizeWriteBreakdown(summary.writeBreakdown)
  };
}

function logStateProgress(state, label, summary, processedCount, totalCount, stateStartedAtMs, bufferedValidatedCount = 0, flushedCourseCount = 0) {
  const flushedSegment = flushedCourseCount > 0 ? ` flushed=${flushedCourseCount}` : '';
  console.log(
    `[progress] ${state} ${label}: processed=${processedCount}/${totalCount} ` +
    `validated=${summary.validated} buffered=${bufferedValidatedCount}${flushedSegment} synced=${summary.synced} failed=${summary.failed} ` +
    `elapsed=${formatDuration(Date.now() - stateStartedAtMs)} ` +
    `fetchAvg=${summary.performance.fetchDurationMs.avgMs}ms ` +
    `upsertAvg=${summary.performance.upsertDurationMs.avgMs}ms`
  );
}

function applyResultToSummary(result, summary, runTotals, checkpoint) {
  recordPerformanceSummary(summary.performance, result.timings);
  recordPerformanceSummary(runTotals.performance, result.timings);

  if (result.status === 'validated') {
    summary.validated += 1;
    runTotals.validated += 1;
    return;
  }

  if (result.status === 'synced' || result.status === 'cache-updated') {
    if (result.specialImport) {
      summary.specialImports.push(result.specialImport);
    }
    summary.synced += 1;
    checkpoint.totals.synced += 1;
    return;
  }

  const failureClass = classifyFailure(result.error);
  const failureBucket = result.failureBucket || classifyFailureBucket(result.error, result.componentAudit);
  summary.failed += 1;
  summary.failureBreakdown[failureClass] += 1;
  checkpoint.totals.failureBreakdown[failureClass] += 1;
  summary.failures.push({
    ...result,
    failureClass,
    failureBucket
  });
  checkpoint.totals.failed += 1;
}

async function fetchAndValidateCourse(client, courseId, validateCourseForSync) {
  const courseStartedAtMs = Date.now();
  let fetchDurationMs = 0;
  let validationDurationMs = 0;
  let course = null;

  try {
    const fetchStartedAtMs = Date.now();
    course = await client.getCourse(courseId);
    fetchDurationMs = Date.now() - fetchStartedAtMs;

    if (!course) {
      throw new Error('Course not found in GHIN detail endpoint');
    }

    const validationStartedAtMs = Date.now();
    const prepared = await prepareCourseForBackfill(course, validateCourseForSync, { client });
    validationDurationMs = Date.now() - validationStartedAtMs;

    return {
      courseId,
      courseName: prepared.course?.courseName || course.courseName || null,
      course: prepared.course,
      status: 'validated',
      specialImport: prepared.specialImport || null,
      timings: {
        fetchDurationMs,
        validationDurationMs,
        noopDetectionDurationMs: 0,
        upsertDurationMs: 0,
        mirrorDurationMs: 0,
        syncDurationMs: validationDurationMs,
        totalDurationMs: Date.now() - courseStartedAtMs
      }
    };
  } catch (error) {
    return {
      courseId,
      courseName: course?.courseName || null,
      status: 'failed',
      error: error.message,
      failureBucket: error.failureBucket || classifyFailureBucket(error.message, error.componentAudit),
      componentAudit: error.componentAudit || null,
      timings: {
        fetchDurationMs,
        validationDurationMs,
        noopDetectionDurationMs: 0,
        upsertDurationMs: 0,
        mirrorDurationMs: 0,
        syncDurationMs: 0,
        totalDurationMs: Date.now() - courseStartedAtMs
      }
    };
  }
}

async function persistValidatedBatch(batch, bulkUpsertCoursesToCache) {
  if (!batch.length) {
    return { results: [], batchTimings: [] };
  }

  try {
    const bulkResult = await bulkUpsertCoursesToCache(batch.map((item) => item.course), {
      cacheSource: 'USGA_WEBHOOK',
      assumeMissingCourses: true
    });

    const sharedUpsertDurationMs = Math.max(1, Math.round(Number(bulkResult.timings?.totalDurationMs || 0) / batch.length));

    return {
      results: batch.map((item) => ({
        courseId: item.courseId,
        courseName: item.course?.courseName || null,
        status: 'cache-updated',
        specialImport: item.specialImport || null,
        timings: {
          fetchDurationMs: item.timings.fetchDurationMs,
          validationDurationMs: item.timings.validationDurationMs,
          noopDetectionDurationMs: 0,
          upsertDurationMs: sharedUpsertDurationMs,
          mirrorDurationMs: 0,
          syncDurationMs: item.timings.validationDurationMs + sharedUpsertDurationMs,
          totalDurationMs: item.timings.fetchDurationMs + item.timings.validationDurationMs + sharedUpsertDurationMs
        }
      })),
      batchTimings: [bulkResult]
    };
  } catch (error) {
    if (batch.length === 1) {
      const item = batch[0];
      return {
        results: [{
          courseId: item.courseId,
          courseName: item.course?.courseName || null,
          status: 'failed',
          error: error.message,
          specialImport: item.specialImport || null,
          componentAudit: item.componentAudit || null,
          failureBucket: classifyFailureBucket(error.message, item.componentAudit),
          timings: {
            fetchDurationMs: item.timings.fetchDurationMs,
            validationDurationMs: item.timings.validationDurationMs,
            noopDetectionDurationMs: 0,
            upsertDurationMs: 0,
            mirrorDurationMs: 0,
            syncDurationMs: item.timings.validationDurationMs,
            totalDurationMs: item.timings.totalDurationMs
          }
        }],
        batchTimings: []
      };
    }

    const midpoint = Math.ceil(batch.length / 2);
    const left = await persistValidatedBatch(batch.slice(0, midpoint), bulkUpsertCoursesToCache);
    const right = await persistValidatedBatch(batch.slice(midpoint), bulkUpsertCoursesToCache);
    return {
      results: [...left.results, ...right.results],
      batchTimings: [...left.batchTimings, ...right.batchTimings]
    };
  }
}

async function persistValidatedCoursesInBatches(validatedCourses, cacheBatchSize, bulkUpsertCoursesToCache) {
  const results = [];
  const batchTimings = [];
  for (const batch of chunk(validatedCourses, cacheBatchSize)) {
    const batchResult = await persistValidatedBatch(batch, bulkUpsertCoursesToCache);
    results.push(...batchResult.results);
    batchTimings.push(...batchResult.batchTimings);
  }
  return { results, batchTimings };
}

async function getExistingCourseIds(courseIds, batchSize) {
  const sql = database.sql;
  const existing = new Set();

  for (const idsChunk of chunk(courseIds, batchSize)) {
    const rows = await database.query(
      `SELECT CourseId AS courseId
       FROM dbo.GHIN_Courses
       WHERE CourseId IN (SELECT [value] FROM OPENJSON(@idsJson))`,
      {
        idsJson: { type: sql.NVarChar(sql.MAX), value: JSON.stringify(idsChunk) }
      }
    );

    rows.forEach((row) => {
      if (row.courseId != null) {
        existing.add(String(row.courseId));
      }
    });
  }

  return existing;
}

async function discoverStateCourseIds(client, state, pageSize) {
  const discovered = new Map();
  const seenPageFingerprints = new Set();
  let page = 1;
  let stopReason = 'empty';
  let lastPageResultCount = 0;

  while (true) {
    const results = await client.searchCourses({ state, page, perPage: pageSize });
    if (!Array.isArray(results) || results.length === 0) {
      stopReason = 'empty';
      break;
    }

    lastPageResultCount = results.length;

    const pageIds = results
      .map((course) => String(course.courseId || '').trim())
      .filter(Boolean);

    const fingerprint = pageIds.join(',');
    if (seenPageFingerprints.has(fingerprint)) {
      stopReason = 'repeat-page';
      break;
    }
    seenPageFingerprints.add(fingerprint);

    let newIds = 0;
    for (const course of results) {
      const courseId = String(course.courseId || '').trim();
      if (!courseId || discovered.has(courseId)) continue;
      discovered.set(courseId, course);
      newIds += 1;
    }

    if (newIds === 0) {
      stopReason = 'no-new-ids';
      break;
    }

    if (results.length < pageSize) {
      stopReason = 'short-page';
      break;
    }

    page += 1;
  }

  return {
    courses: Array.from(discovered.values()),
    stopReason,
    pageCount: page,
    capped: stopReason === 'repeat-page' && lastPageResultCount > 0 && discovered.size >= lastPageResultCount
  };
}

async function run() {
  const runStartedAtMs = Date.now();
  const args = parseArgs(process.argv.slice(2));
  const checkpoint = args.validateOnly
    ? createEmptyCheckpoint()
    : loadCheckpoint(args.checkpointPath, args.resetCheckpoint);

  const secrets = await loadSecrets();
  Object.assign(process.env, secrets);

  process.env.GHIN_MIRROR_CALLBACK_CONCURRENCY = String(args.mirrorConcurrency);
  process.env.GHIN_CACHE_WRITE_CONCURRENCY = String(args.cacheWriteConcurrency);

  const client = require('../src/services/usaGhinApiClient');
  const {
    bulkUpsertCoursesToCache,
    processCourseSync,
    validateCourseForSync
  } = require('../src/services/courseSyncService');

  const allStates = (args.states && args.states.length)
    ? args.states
    : US_JURISDICTION_CODES.map((code) => `US-${code}`);

  const pendingStates = args.validateOnly
    ? allStates
    : allStates.filter((state) => !checkpoint.completedStates.includes(state));
  const runSummaries = {};
  const runTotals = createRunTotals();
  const excludedCourseIdSet = new Set(args.excludeCourseIds);

  console.log(`Starting GHIN course backfill for ${pendingStates.length} US jurisdiction partition(s).`);
  console.log(`Options: dryRun=${args.dryRun} validateOnly=${args.validateOnly} projectionMode=${args.projectionMode} searchConcurrency=${args.searchConcurrency} syncConcurrency=${args.syncConcurrency} cacheWriteConcurrency=${args.cacheWriteConcurrency} validationChunkSize=${args.validationChunkSize} cacheBatchSize=${args.cacheBatchSize} mirrorConcurrency=${args.mirrorConcurrency} dbBatchSize=${args.dbBatchSize} pageSize=${args.pageSize} excludeCourseIds=${args.excludeCourseIds.length} specialImportOverrides=${Object.keys(specialImportOverrides).length}`);

  await database.connect();

  const discoveryResults = await mapLimit(pendingStates, args.searchConcurrency, async (state) => {
    console.log(`[discover] ${state}...`);
    const discoveryStartedAtMs = Date.now();
    const discoveryResult = await discoverStateCourseIds(client, state, args.pageSize);
    const warnSuffix = discoveryResult.capped ? ` warning=incomplete stop=${discoveryResult.stopReason}` : '';
    console.log(`[discover] ${state}: ${discoveryResult.courses.length} course(s)${warnSuffix}`);
    return {
      state,
      ...discoveryResult,
      discoveryDurationMs: Date.now() - discoveryStartedAtMs
    };
  });

  for (const stateResult of discoveryResults) {
    const { state, courses, discoveryDurationMs, stopReason, capped } = stateResult;
    const stateStartedAtMs = Date.now();
    const rawCourseIds = courses.map((course) => String(course.courseId)).filter(Boolean);
    const courseIds = rawCourseIds.filter((courseId) => !excludedCourseIdSet.has(courseId));
    const excludedCount = rawCourseIds.length - courseIds.length;
    const existingIdsStartedAtMs = Date.now();
    const existingIds = await getExistingCourseIds(courseIds, args.dbBatchSize);
    const existingIdsDurationMs = Date.now() - existingIdsStartedAtMs;
    const missingIds = courseIds.filter((courseId) => !existingIds.has(courseId));

    const summary = {
      discovered: courseIds.length,
      excluded: excludedCount,
      existing: existingIds.size,
      missing: missingIds.length,
      validated: 0,
      synced: 0,
      failed: 0,
      discoveryStopReason: stopReason,
      discoveryIncomplete: capped,
      failureBreakdown: createFailureBreakdown(),
      performance: createPerformanceSummary(),
      orchestration: createOrchestrationSummary(),
      writeBreakdown: createWriteBreakdownSummary(),
      failures: []
      ,
      specialImports: [],
      auditPath: null
    };

    recordTimingMetric(summary.orchestration.discoveryDurationMs, discoveryDurationMs);
    recordTimingMetric(runTotals.orchestration.discoveryDurationMs, discoveryDurationMs);
    recordTimingMetric(summary.orchestration.existingIdsDurationMs, existingIdsDurationMs);
    recordTimingMetric(runTotals.orchestration.existingIdsDurationMs, existingIdsDurationMs);

    checkpoint.totals.discovered += summary.discovered;
    checkpoint.totals.skippedExisting += summary.existing;
    checkpoint.totals.missing += summary.missing;

    console.log(
      `[plan] ${state}: discovered=${summary.discovered} existing=${summary.existing} missing=${summary.missing} ` +
      (summary.excluded ? `excluded=${summary.excluded} ` : '') +
      `discover=${formatDuration(discoveryDurationMs)} existingDiff=${formatDuration(existingIdsDurationMs)}` +
      (summary.discoveryIncomplete ? ` warning=incomplete-discovery stop=${summary.discoveryStopReason}` : '')
    );

    if ((!args.dryRun || args.validateOnly) && missingIds.length > 0) {
      let processedCount = 0;
      let validatedBuffer = [];
      let validatedBufferStartedAtMs = null;

      for (const missingChunk of chunk(missingIds, args.validationChunkSize)) {
        let syncResults;
        let flushedCourseCount = 0;

        if (args.validateOnly || args.projectionMode === 'none') {
          const preparedResults = await mapLimit(missingChunk, args.syncConcurrency, async (courseId) => {
            return fetchAndValidateCourse(client, courseId, validateCourseForSync);
          });

          const validationFailures = preparedResults.filter((result) => result.status === 'failed');
          const validatedCourses = preparedResults.filter((result) => result.status === 'validated');
          summary.validated += validatedCourses.length;
          runTotals.validated += validatedCourses.length;

          console.log(
            `[progress] ${state} validation: chunk=${processedCount + 1}-${processedCount + missingChunk.length}/${missingIds.length} ` +
            `validated=${validatedCourses.length} failed=${validationFailures.length} ` +
            `elapsed=${formatDuration(Date.now() - stateStartedAtMs)}`
          );

          if (args.validateOnly) {
            syncResults = validationFailures;
          } else {
            if (validatedCourses.length > 0 && validatedBuffer.length === 0) {
              validatedBufferStartedAtMs = Date.now();
            }
            validatedBuffer.push(...validatedCourses);
            const flushCount = Math.floor(validatedBuffer.length / args.cacheBatchSize) * args.cacheBatchSize;
            let persistedResults = [];

            if (flushCount > 0) {
              if (validatedBufferStartedAtMs != null) {
                const waitDurationMs = Date.now() - validatedBufferStartedAtMs;
                recordTimingMetric(summary.orchestration.validationToFlushWaitDurationMs, waitDurationMs);
                recordTimingMetric(runTotals.orchestration.validationToFlushWaitDurationMs, waitDurationMs);
              }
              const coursesToFlush = validatedBuffer.splice(0, flushCount);
              flushedCourseCount = coursesToFlush.length;
              const flushResult = await persistValidatedCoursesInBatches(
                coursesToFlush,
                args.cacheBatchSize,
                bulkUpsertCoursesToCache
              );
              persistedResults = flushResult.results;
              for (const batchTiming of flushResult.batchTimings) {
                recordWriteBreakdownSummary(summary.writeBreakdown, batchTiming);
                recordWriteBreakdownSummary(runTotals.writeBreakdown, batchTiming);
              }

              validatedBufferStartedAtMs = validatedBuffer.length > 0 ? Date.now() : null;
            }

            syncResults = [...validationFailures, ...persistedResults];
          }
        } else {
          syncResults = await mapLimit(missingChunk, args.syncConcurrency, async (courseId) => {
          const courseStartedAtMs = Date.now();
          let fetchDurationMs = 0;
          let validationDurationMs = 0;
          let course = null;

          try {
            const fetchStartedAtMs = Date.now();
            course = await client.getCourse(courseId);
            fetchDurationMs = Date.now() - fetchStartedAtMs;

            if (!course) {
              throw new Error('Course not found in GHIN detail endpoint');
            }

            const validationStartedAtMs = Date.now();
            const prepared = await prepareCourseForBackfill(course, validateCourseForSync, { client });
            validationDurationMs = Date.now() - validationStartedAtMs;

            const syncResult = await processCourseSync(prepared.course, {
              detectNoop: false,
              syncMirror: true
            });

            return {
              courseId,
              courseName: prepared.course?.courseName || course.courseName || null,
              status: 'synced',
              specialImport: prepared.specialImport || null,
              timings: {
                fetchDurationMs,
                validationDurationMs: Math.max(validationDurationMs, Number(syncResult.timings?.validationDurationMs || 0)),
                noopDetectionDurationMs: Number(syncResult.timings?.noopDetectionDurationMs || 0),
                upsertDurationMs: Number(syncResult.timings?.upsertDurationMs || 0),
                mirrorDurationMs: Number(syncResult.timings?.mirrorDurationMs || 0),
                syncDurationMs: Number(syncResult.timings?.totalDurationMs || 0),
                totalDurationMs: Date.now() - courseStartedAtMs
              }
            };
          } catch (error) {
            return {
              courseId,
              courseName: course?.courseName || null,
              status: 'failed',
              error: error.message,
              componentAudit: error.componentAudit || null,
              failureBucket: error.failureBucket || classifyFailureBucket(error.message, error.componentAudit),
              timings: {
                fetchDurationMs,
                validationDurationMs: Math.max(validationDurationMs, Number(error.syncTimings?.validationDurationMs || 0)),
                noopDetectionDurationMs: Number(error.syncTimings?.noopDetectionDurationMs || 0),
                upsertDurationMs: Number(error.syncTimings?.upsertDurationMs || 0),
                mirrorDurationMs: Number(error.syncTimings?.mirrorDurationMs || 0),
                syncDurationMs: Number(error.syncTimings?.totalDurationMs || 0),
                totalDurationMs: Date.now() - courseStartedAtMs
              }
            };
          }
        });
        }

        for (const result of syncResults) {
          applyResultToSummary(result, summary, runTotals, checkpoint);
        }

        processedCount += missingChunk.length;
        logStateProgress(state, 'chunk', summary, processedCount, missingIds.length, stateStartedAtMs, validatedBuffer.length, flushedCourseCount);
      }

      if (!args.validateOnly && args.projectionMode === 'none' && validatedBuffer.length > 0) {
        const finalFlushCourseCount = validatedBuffer.length;
        if (validatedBufferStartedAtMs != null) {
          const waitDurationMs = Date.now() - validatedBufferStartedAtMs;
          recordTimingMetric(summary.orchestration.validationToFlushWaitDurationMs, waitDurationMs);
          recordTimingMetric(runTotals.orchestration.validationToFlushWaitDurationMs, waitDurationMs);
        }
        const flushResult = await persistValidatedCoursesInBatches(
          validatedBuffer,
          args.cacheBatchSize,
          bulkUpsertCoursesToCache
        );
        validatedBuffer = [];

        for (const batchTiming of flushResult.batchTimings) {
          recordWriteBreakdownSummary(summary.writeBreakdown, batchTiming);
          recordWriteBreakdownSummary(runTotals.writeBreakdown, batchTiming);
        }

        for (const result of flushResult.results) {
          applyResultToSummary(result, summary, runTotals, checkpoint);
        }

        logStateProgress(state, 'final-flush', summary, processedCount, missingIds.length, stateStartedAtMs, 0, finalFlushCourseCount);
      }
    }

    checkpoint.stateSummaries[state] = summary;
    runSummaries[state] = summary;
    runTotals.discovered += summary.discovered;
    runTotals.missing += summary.missing;
    runTotals.synced += summary.synced;
    runTotals.skippedExisting += summary.existing;
    runTotals.failed += summary.failed;
    if (summary.discoveryIncomplete) {
      runTotals.incompleteDiscoveryStates.push(state);
    }
    runTotals.failureBreakdown.retryableOperational += summary.failureBreakdown.retryableOperational;
    runTotals.failureBreakdown.sourceData += summary.failureBreakdown.sourceData;
    runTotals.failureBreakdown.other += summary.failureBreakdown.other;
    if (summary.failed > 0) {
      checkpoint.failedStates[state] = summary.failures;
    } else {
      delete checkpoint.failedStates[state];
    }

    summary.auditPath = writeStateAudit(state, summary, args);

    if (!args.validateOnly) {
      checkpoint.completedStates.push(state);
      const checkpointSaveStartedAtMs = Date.now();
      saveCheckpoint(args.checkpointPath, checkpoint);
      const checkpointSaveDurationMs = Date.now() - checkpointSaveStartedAtMs;
      recordTimingMetric(summary.orchestration.checkpointSaveDurationMs, checkpointSaveDurationMs);
      recordTimingMetric(runTotals.orchestration.checkpointSaveDurationMs, checkpointSaveDurationMs);
    }

    const stateTotalDurationMs = Date.now() - stateStartedAtMs;
    recordTimingMetric(summary.orchestration.stateTotalDurationMs, stateTotalDurationMs);
    recordTimingMetric(runTotals.orchestration.stateTotalDurationMs, stateTotalDurationMs);

    console.log(
      `[done] ${state}: validated=${summary.validated} synced=${summary.synced} failed=${summary.failed} ` +
      `specialImports=${summary.specialImports.length} ` +
      `(retryable=${summary.failureBreakdown.retryableOperational}, sourceData=${summary.failureBreakdown.sourceData}, other=${summary.failureBreakdown.other}) ` +
      `stateTotal=${formatDuration(stateTotalDurationMs)} flushWait=${formatDuration(summary.orchestration.validationToFlushWaitDurationMs.totalMs)} checkpointSave=${formatDuration(summary.orchestration.checkpointSaveDurationMs.totalMs)}` +
      (summary.discoveryIncomplete ? ` discovery=incomplete(${summary.discoveryStopReason})` : '') +
      ` audit=${summary.auditPath}`
    );
  }

  if (!args.validateOnly) {
    const checkpointSaveStartedAtMs = Date.now();
    saveCheckpoint(args.checkpointPath, checkpoint);
    const checkpointSaveDurationMs = Date.now() - checkpointSaveStartedAtMs;
    recordTimingMetric(runTotals.orchestration.checkpointSaveDurationMs, checkpointSaveDurationMs);
  }
  await database.close();

  console.log(`[elapsed] total=${formatDuration(Date.now() - runStartedAtMs)}`);
  console.log(args.validateOnly ? 'GHIN course preflight validation complete.' : 'GHIN course backfill complete.');
  console.log(JSON.stringify({
    mode: args.validateOnly ? 'validate-only' : args.dryRun ? 'dry-run' : 'backfill',
    projectionMode: args.projectionMode,
    totalElapsedMs: Date.now() - runStartedAtMs,
    totalElapsedSeconds: Number(((Date.now() - runStartedAtMs) / 1000).toFixed(1)),
    runStates: pendingStates,
    summary: {
      discovered: runTotals.discovered,
      missing: runTotals.missing,
      validated: runTotals.validated,
      synced: runTotals.synced,
      skippedExisting: runTotals.skippedExisting,
      failed: runTotals.failed,
      incompleteDiscoveryStates: runTotals.incompleteDiscoveryStates,
      failureBreakdown: runTotals.failureBreakdown,
      performance: summarizePerformanceSummary(runTotals.performance),
      orchestration: summarizeOrchestrationSummary(runTotals.orchestration),
      writeBreakdown: summarizeWriteBreakdown(runTotals.writeBreakdown)
    }
  }, null, 2));
}

run().catch(async (error) => {
  try {
    await database.close();
  } catch (_) {
    // Ignore shutdown errors.
  }
  console.error('GHIN course backfill failed:', error.message);
  process.exit(1);
});