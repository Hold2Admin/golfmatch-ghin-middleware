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
      `SELECT courseId, courseName, city, state, country, facilityId, updatedAt 
       FROM GHIN_Courses 
       WHERE courseId = @courseId`,
      { courseId: { type: db.sql.VarChar, value: ghinCourseId } }
    );
    
    if (courses.length === 0) {
      return null;
    }
    
    const course = courses[0];
    
    // Get tees for this course
    const tees = await db.query(
      `SELECT teeId, teeName, gender, isDefault,
              courseRating18 AS courseRating,
              slopeRating18 AS slope,
              par18 AS par,
              yardage18 AS yardage,
              teeSetSide,
              courseRatingF9, slopeRatingF9, parF9, yardageF9,
              courseRatingB9, slopeRatingB9, parB9, yardageB9,
              updatedAt
       FROM GHIN_Tees
       WHERE courseId = @courseId
       ORDER BY gender, teeName`,
      { courseId: { type: db.sql.VarChar, value: ghinCourseId } }
    );
    
    // Get holes for each tee
    for (let tee of tees) {
      const holes = await db.query(
        `SELECT holeNumber, par, handicap, yardage
         FROM GHIN_Holes
         WHERE teeId = @teeId
         ORDER BY holeNumber`,
        { teeId: { type: db.sql.VarChar, value: tee.teeId } }
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
      SELECT courseId, courseName, city, state, country, facilityId, facilityName, updatedAt
      FROM GHIN_Courses
      WHERE (@courseName IS NULL OR courseName LIKE '%' + @courseName + '%')
        AND (@city IS NULL OR city LIKE '%' + @city + '%')
        AND (@state IS NULL OR state = @state)
        AND (@country IS NULL OR country = @country)
      ORDER BY courseName`;

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
