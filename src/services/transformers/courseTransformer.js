// ============================================================
// Course Data Transformer
// Converts GHIN course format to Fore Play normalized format
// ============================================================

/**
 * Extract base tee name (strip gender suffix)
 * @param {string} teeName - e.g., "Blue (M)", "Blue", "Red (W)"
 * @returns {string} - e.g., "Blue", "Red"
 */
function getBaseTeeName(teeName) {
  return teeName.replace(/\s*\([MW]\)\s*$/, '').trim();
}

/**
 * Transform GHIN course to normalized format
 * @param {Object} ghinCourse - Raw course data from GHIN API
 * @returns {Object} - Normalized course object
 */
function transformGhinCourse(ghinCourse) {
  return {
    // Identity
    ghinCourseId: ghinCourse.courseId,
    courseName: ghinCourse.courseName,
    city: ghinCourse.city || null,
    state: ghinCourse.state || null,
    country: ghinCourse.country || null,
    facilityId: ghinCourse.facilityId || null,
    
    // Tees
    tees: ghinCourse.tees.map(transformGhinTee),
    
    // Audit & Sync
    lastSyncedUtc: new Date().toISOString(),
    sourceSystem: 'GHIN',
    version: 1
  };
}

/**
 * Transform GHIN tee to normalized format
 * @param {Object} ghinTee - Raw tee data from GHIN API
 * @returns {Object} - Normalized tee object
 */
function transformGhinTee(ghinTee) {
  return {
    // Identity
    ghinTeeId: ghinTee.teeId,
    teeName: ghinTee.teeName,
    baseTeeName: getBaseTeeName(ghinTee.teeName),
    gender: ghinTee.gender,
    
    // Ratings — 18H
    teeSetSide: ghinTee.teeSetSide ?? 'All18',
    courseRating: ghinTee.courseRating,
    slope: ghinTee.slope,
    par: ghinTee.par,
    yardage: ghinTee.yardage || null,
    // Ratings — F9
    courseRatingF9: ghinTee.courseRatingF9 ?? null,
    slopeRatingF9: ghinTee.slopeRatingF9 ?? null,
    parF9: ghinTee.parF9 ?? null,
    yardageF9: ghinTee.yardageF9 ?? null,
    // Ratings — B9
    courseRatingB9: ghinTee.courseRatingB9 ?? null,
    slopeRatingB9: ghinTee.slopeRatingB9 ?? null,
    parB9: ghinTee.parB9 ?? null,
    yardageB9: ghinTee.yardageB9 ?? null,
    
    // Hole Data
    holes: ghinTee.holes.map(transformGhinHole)
  };
}

/**
 * Transform GHIN hole to normalized format
 * @param {Object} ghinHole - Raw hole data from GHIN API
 * @returns {Object} - Normalized hole object
 */
function transformGhinHole(ghinHole) {
  return {
    holeNumber: ghinHole.holeNumber,
    par: ghinHole.par,
    handicap: ghinHole.handicap,
    yardage: ghinHole.yardage || null
  };
}

module.exports = {
  transformGhinCourse,
  transformGhinTee,
  transformGhinHole,
  getBaseTeeName
};
