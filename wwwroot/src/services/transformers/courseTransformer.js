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
    
    // Ratings
    courseRating: ghinTee.courseRating,
    slope: ghinTee.slope,
    par: ghinTee.par,
    yardage: ghinTee.yardage || null,
    
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
