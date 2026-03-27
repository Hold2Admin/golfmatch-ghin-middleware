// ============================================================
// GHIN API Client
// Phase 1-3: Returns mock data
// Phase 4+: Replace with real GHIN API calls
// ============================================================

const { createLogger } = require('../utils/logger');
const config = require('../config');
const mockData = require('../mocks/ghinData');
const db = require('./database');
const usaGhinApiClient = require('./usaGhinApiClient');

const logger = createLogger('ghinClient');
// Use database by default (production-like), unless explicitly disabled
const USE_DATABASE = process.env.GHIN_USE_DATABASE !== 'false';

/**
 * Get player by GHIN number
 * @param {string} ghinNumber 
 * @returns {Promise<Object|null>}
 */
async function getPlayer(ghinNumber) {
  if (config.ghin.useMock) {
    logger.info(`[MOCK] Fetching player ${ghinNumber}`);
    return mockData.getPlayer(ghinNumber);
  }

  logger.info(`[LIVE] Fetching player ${ghinNumber} from USGA API`);
  return usaGhinApiClient.getGolfer(ghinNumber);
}

/**
 * Search for players
 * @param {Object} params - Search parameters
 * @returns {Promise<Array>}
 */
async function searchPlayers(params) {
  if (config.ghin.useMock) {
    logger.info('[MOCK] Searching players', params);
    return mockData.searchPlayers(params);
  }

  logger.info('[LIVE] Searching players from USGA API', params);
  return usaGhinApiClient.searchGolfers(params);
}

/**
 * Get course by GHIN course ID
 * @param {string} ghinCourseId 
 * @returns {Promise<Object|null>}
 */
async function getCourse(ghinCourseId) {
  if (USE_DATABASE) {
    logger.info(`[DATABASE] Fetching course ${ghinCourseId}`);
    
    const courses = await db.query(
      `SELECT
          CourseId AS courseId,
          CourseName AS courseName,
          City AS city,
          State AS state,
          Country AS country,
          FacilityId AS facilityId,
          UpdatedAt AS updatedAt
       FROM dbo.GHIN_Courses
       WHERE CourseId = @courseId`,
      { courseId: { type: db.sql.VarChar, value: ghinCourseId } }
    );
    
    if (courses.length === 0) {
      return null;
    }
    
    const course = courses[0];
    
    // Get tees for this course
    const tees = await db.query(
      `SELECT
          TeeId AS teeId,
          TeeName AS teeName,
          Gender AS gender,
          IsDefault AS isDefault,
          CourseRating18 AS courseRating,
          SlopeRating18 AS slope,
          Par18 AS par,
          Yardage18 AS yardage,
          TeeSetSide AS teeSetSide,
          CourseRatingF9 AS courseRatingF9,
          SlopeRatingF9 AS slopeRatingF9,
          ParF9 AS parF9,
          YardageF9 AS yardageF9,
          CourseRatingB9 AS courseRatingB9,
          SlopeRatingB9 AS slopeRatingB9,
          ParB9 AS parB9,
          YardageB9 AS yardageB9,
          UpdatedAt AS updatedAt
       FROM dbo.GHIN_Tees
       WHERE CourseId = @courseId
       ORDER BY gender, teeName`,
      { courseId: { type: db.sql.VarChar, value: ghinCourseId } }
    );
    
    // Get holes for each tee
    for (let tee of tees) {
      const holes = await db.query(
        `SELECT
            HoleNumber AS holeNumber,
            Par AS par,
            Handicap AS handicap,
            Yardage AS yardage
         FROM dbo.GHIN_Holes
         WHERE TeeId = @teeId
         ORDER BY holeNumber`,
        { teeId: { type: db.sql.VarChar(50), value: tee.teeId } }
      );
      tee.holes = holes;
    }
    
    return {
      courseId: course.courseId,
      courseName: course.courseName,
      city: course.city,
      state: course.state,
      country: course.country,
      facilityId: course.facilityId,
      lastUpdatedUtc: course.updatedAt || null,
      tees
    };
  }
  
  if (config.ghin.useMock) {
    logger.info(`[MOCK] Fetching course ${ghinCourseId}`);
    return mockData.getCourse(ghinCourseId);
  }

  logger.info(`[LIVE] Fetching course ${ghinCourseId} from USGA API`);
  return usaGhinApiClient.getCourse(ghinCourseId);
}

/**
 * Search for courses
 * @param {Object} params - Search parameters
 * @returns {Promise<Array>}
 */
async function searchCourses(params) {
  if (USE_DATABASE) {
    logger.info('[DATABASE] Searching courses', params);

    const query = `
      SELECT
        CourseId AS courseId,
        CourseName AS courseName,
        City AS city,
        State AS state,
        Country AS country,
        FacilityId AS facilityId,
        FacilityName AS facilityName,
        UpdatedAt AS updatedAt
      FROM dbo.GHIN_Courses
      WHERE (@courseName IS NULL OR CourseName LIKE '%' + @courseName + '%')
        AND (@city IS NULL OR City LIKE '%' + @city + '%')
        AND (@state IS NULL OR State = @state)
        AND (@country IS NULL OR Country = @country)
      ORDER BY CourseName`;

    const courses = await db.query(query, {
      courseName: { type: db.sql.NVarChar, value: params.courseName || null },
      city: { type: db.sql.NVarChar, value: params.city || null },
      state: { type: db.sql.VarChar, value: params.state || null },
      country: { type: db.sql.VarChar, value: params.country || null }
    });
    
    return courses.map(c => ({
      courseId: c.courseId,
      courseName: c.courseName,
      city: c.city,
      state: c.state,
      country: c.country,
      facilityId: c.facilityId,
      facilityName: c.facilityName || null,
      lastUpdatedUtc: c.updatedAt || null
    }));
  }
  
  if (config.ghin.useMock) {
    logger.info('[MOCK] Searching courses', params);
    return mockData.searchCourses(params);
  }

  logger.info('[LIVE] Searching courses from USGA API', params);
  return usaGhinApiClient.searchCourses(params);
}

module.exports = {
  getPlayer,
  searchPlayers,
  getCourse,
  searchCourses
};
