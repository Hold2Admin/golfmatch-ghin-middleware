// ============================================================
// GHIN API Client
// Phase 1-3: Returns mock data
// Phase 4+: Replace with real GHIN API calls
// ============================================================

const { createLogger } = require('../utils/logger');
const config = require('../config');
const mockData = require('../mocks/ghinData');
const db = require('../config/database');

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

  // TODO: Replace with real GHIN API call
  // const response = await fetch(`${config.ghin.baseUrl}/players/${ghinNumber}`, {
  //   headers: { 'Authorization': `Bearer ${config.ghin.apiKey}` }
  // });
  // return response.json();
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

  // TODO: Replace with real GHIN API call
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
      `SELECT teeId, teeName, gender, isDefault, courseRating, slope, par, yardage, updatedAt
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

  // TODO: Replace with real GHIN API call
}

/**
 * Search for courses
 * @param {Object} params - Search parameters
 * @returns {Promise<Array>}
 */
async function searchCourses(params) {
  if (USE_DATABASE) {
    logger.info('[DATABASE] Searching courses', params);
    
    const { state } = params;
    const courses = await db.query(
      `SELECT courseId, courseName, city, state, country, facilityId, updatedAt 
       FROM GHIN_Courses 
       WHERE state = @state 
       ORDER BY courseName`,
      { state: { type: db.sql.VarChar, value: state } }
    );
    
    return courses.map(c => ({
      courseId: c.courseId,
      courseName: c.courseName,
      city: c.city,
      state: c.state,
      country: c.country,
      facilityId: c.facilityId,
      lastUpdatedUtc: c.updatedAt || null
    }));
  }
  
  if (config.ghin.useMock) {
    logger.info('[MOCK] Searching courses', params);
    return mockData.searchCourses(params);
  }

  // TODO: Replace with real GHIN API call
}

module.exports = {
  getPlayer,
  searchPlayers,
  getCourse,
  searchCourses
};
