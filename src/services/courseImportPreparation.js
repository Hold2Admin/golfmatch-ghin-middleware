'use strict';

/**
 * Tee-level course import preparation shared by the backfill script and the
 * live sync pipeline (re-check, webhooks, on-demand fetch).
 * Moved verbatim from scripts/backfill-ghin-courses.js.
 */

const specialImportOverrides = require('../config/specialCourseImportOverrides');

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

  if (reason.includes('invalid holeNumber') || reason.includes('duplicate holeNumber') || reason.includes('could not be normalized to 9 holes')) {
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

  if (message.includes('missing required field: tees[]')) {
    return 'irreconcilable_missing_tees_payload';
  }

  if (message.includes('missing hole handicap/allocation data')) {
    return 'irreconcilable_missing_handicap';
  }

  if (message.includes('missing holes[]')) {
    return 'irreconcilable_missing_holes';
  }

  if (message.includes('invalid par') || message.includes('CK_GHIN_Holes_Par')) {
    return 'irreconcilable_invalid_par';
  }

  if (message.includes('invalid holeNumber') || message.includes('duplicate holeNumber')) {
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

function holesMatchForDeterministicDedup(left, right) {
  return Number(left?.holeNumber) === Number(right?.holeNumber)
    && Number(left?.par) === Number(right?.par)
    && Number(left?.yardage ?? -1) === Number(right?.yardage ?? -1)
    && Number(left?.handicap ?? -1) === Number(right?.handicap ?? -1);
}

function tryNormalizeDuplicateHoleRowsCourse(course) {
  let normalizedAnyTee = false;
  const transformedTees = [];
  const normalizedTees = [];

  for (const tee of course?.tees || []) {
    const teeClone = cloneTee(tee);
    const holes = Array.isArray(teeClone?.holes) ? teeClone.holes.map(cloneHole) : [];
    const holesByNumber = new Map();

    for (const hole of holes) {
      const holeNumber = Number(hole?.holeNumber);
      if (!holesByNumber.has(holeNumber)) {
        holesByNumber.set(holeNumber, []);
      }
      holesByNumber.get(holeNumber).push(hole);
    }

    const duplicateEntries = Array.from(holesByNumber.entries()).filter(([, grouped]) => grouped.length > 1);
    if (!duplicateEntries.length) {
      transformedTees.push(teeClone);
      continue;
    }

    const allHoleNumbersPresentTwice = holes.length === 36
      && holesByNumber.size === 18
      && Array.from({ length: 18 }, (_, index) => index + 1).every((holeNumber) => (holesByNumber.get(holeNumber) || []).length === 2);

    const duplicatesAreIdentical = allHoleNumbersPresentTwice
      && duplicateEntries.every(([, grouped]) => holesMatchForDeterministicDedup(grouped[0], grouped[1]));

    if (!duplicatesAreIdentical) {
      return null;
    }

    normalizedAnyTee = true;
    const normalizedHoles = Array.from({ length: 18 }, (_, index) => cloneHole(holesByNumber.get(index + 1)[0]));
    transformedTees.push({
      ...teeClone,
      holes: normalizedHoles
    });
    normalizedTees.push(summarizeTeeForAudit(teeClone, {
      holeCount: holes.length,
      normalizedHoleCount: normalizedHoles.length
    }));
  }

  if (!normalizedAnyTee) {
    return null;
  }

  return {
    course: cloneCourse(course, transformedTees),
    specialImport: {
      courseId: String(course?.courseId || ''),
      courseName: course?.courseName || null,
      strategy: 'auto-dedupe-duplicate-hole-rows',
      note: 'Collapsed deterministic duplicate hole rows for tees where GHIN published each hole twice with identical values.',
      manualValidationRequired: true,
      validationStatus: 'pending-manual-validation',
      normalizedTees
    }
  };
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

function normalizePruneSegmentKey(tee) {
  return [
    normalizeRawGender(tee?.gender),
    String(tee?.teeSetSide || 'All18').trim().toUpperCase(),
    String(Number(tee?.holeCount || 0))
  ].join('::');
}

function evaluateAutomaticPruneReview(audit) {
  if (!audit?.pruneCandidate) {
    return {
      secondPassEligible: false,
      secondPassAttempted: false,
      notAutoPrunedReason: 'not-prune-candidate'
    };
  }

  if (audit.validTeeCount < 1) {
    return {
      secondPassEligible: false,
      secondPassAttempted: false,
      notAutoPrunedReason: 'no-valid-tees'
    };
  }

  // Policy (Hold2, 2026-10-13): keep every complete tee and drop only the broken
  // ones, as long as at least one complete tee remains. The course is still
  // reported as a partial import, listing each dropped tee and the reason, so
  // nothing is hidden. Segments (gender/side/hole count) left with no complete
  // tee are surfaced as lostSegments rather than blocking the import.
  const validSegmentKeys = new Set((audit.validTees || []).map((tee) => normalizePruneSegmentKey(tee)));
  const lostSegments = Array.from(new Set((audit.invalidTees || [])
    .map((tee) => normalizePruneSegmentKey(tee))
    .filter((key) => !validSegmentKeys.has(key))));

  return {
    secondPassEligible: true,
    secondPassAttempted: true,
    notAutoPrunedReason: null,
    lostSegments
  };
}

function tryPrepareAutomaticPruneImport(course, validateCourseForSync, triggerErrorMessage, inspection = null) {
  const resolvedInspection = inspection || inspectCourseComponentValidity(course, validateCourseForSync);
  const audit = resolvedInspection.audit;
  const pruneReview = evaluateAutomaticPruneReview(audit);

  if (!pruneReview.secondPassEligible) {
    return {
      applied: false,
      componentAudit: audit,
      pruneReview
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
      strategy: 'auto-drop-invalid-tees',
      note: 'Partial import: kept every complete tee and dropped only the invalid tees listed in prunedTees.',
      triggerError: triggerErrorMessage,
      manualValidationRequired: true,
      validationStatus: 'pending-manual-validation',
      originalTeeCount: audit.totalTeeCount,
      keptTeeCount: audit.validTeeCount,
      prunedTeeCount: audit.invalidTeeCount,
      keptTees: audit.validTees,
      prunedTees: audit.invalidTees,
      pruneReview
    }
  };
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
        manualValidationRequired: false,
        validationStatus: null,
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
      manualValidationRequired: true,
      validationStatus: 'pending-manual-validation',
      originalTeeCount: resolvedInspection.audit.totalTeeCount,
      keptTeeCount: resolvedInspection.audit.validTeeCount,
      prunedTeeCount: resolvedInspection.audit.invalidTeeCount,
      keptTees: resolvedInspection.audit.validTees,
      prunedTees: resolvedInspection.audit.invalidTees
    }
  };
}

async function prepareCourseForBackfill(course, validateCourseForSync, context = {}) {
  const duplicateHoleNormalization = tryNormalizeDuplicateHoleRowsCourse(course);
  if (duplicateHoleNormalization) {
    validateCourseForSync(duplicateHoleNormalization.course);
    return {
      course: duplicateHoleNormalization.course,
      specialImport: duplicateHoleNormalization.specialImport
    };
  }

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

    if (!specialImportResult?.applied && !override) {
      specialImportResult = tryPrepareAutomaticPruneImport(course, validateCourseForSync, error.message, inspection);
    }

    if (specialImportResult?.applied) {
      return {
        course: specialImportResult.course,
        specialImport: specialImportResult.specialImport
      };
    }

    error.componentAudit = specialImportResult?.componentAudit || inspection.audit;
    error.pruneReview = specialImportResult?.pruneReview || evaluateAutomaticPruneReview(error.componentAudit);
    error.failureBucket = classifyFailureBucket(error.message, error.componentAudit);
    throw error;
  }
}

module.exports = {
  prepareCourseForImport: prepareCourseForBackfill,
  cloneHole,
  cloneTee,
  cloneCourse,
  cloneAndNormalizeHole,
  summarizeTeeForAudit,
  inspectCourseComponentValidity,
  extractSampleHoleNumbers,
  analyzeInvalidTeeFailure,
  classifyZeroValidTeeFailureBucket,
  classifyFailureBucket,
  normalizeFrontNineOnlyCourse,
  holesMatchForDeterministicDedup,
  tryNormalizeDuplicateHoleRowsCourse,
  normalizeRawGender,
  createTeeMatchKey,
  transformBackNineHoles,
  composeNineHoleComboCourse,
  getSpecialImportOverride,
  normalizePruneSegmentKey,
  evaluateAutomaticPruneReview,
  tryPrepareAutomaticPruneImport,
  tryPrepareSpecialImport,
  prepareCourseForBackfill
};
