// ============================================================
// GHIN client boundary
// Uses live USGA calls when configured, with mock fallback retained for local testing.
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

async function requestGolferProductAccess(ghinNumber, email) {
  if (config.ghin.useMock) {
    logger.info(`[MOCK] Requesting golfer product access for ${ghinNumber}`);
    return {
      message: 'Mock golfer product access requested',
      ghinNumber: String(ghinNumber),
      status: 'pending'
    };
  }

  logger.info(`[LIVE] Requesting golfer product access for ${ghinNumber}`);
  return usaGhinApiClient.requestGolferProductAccess(ghinNumber, email);
}

async function getGolferProductAccessStatus(ghinNumber) {
  if (config.ghin.useMock) {
    logger.info(`[MOCK] Fetching golfer product access status for ${ghinNumber}`);
    return {
      ghinNumber: String(ghinNumber),
      status: 'inactive',
      userAccessId: null,
      golferName: null,
      hasAccess: false
    };
  }

  logger.info(`[LIVE] Fetching golfer product access status for ${ghinNumber}`);
  return usaGhinApiClient.getGolferProductAccessStatus(ghinNumber);
}

async function updateGolferProductAccessStatus(ghinNumber, status) {
  if (config.ghin.useMock) {
    logger.info(`[MOCK] Updating golfer product access for ${ghinNumber} -> ${status}`);
    return {
      message: 'Mock golfer product access status updated',
      ghinNumber: String(ghinNumber),
      status: String(status)
    };
  }

  logger.info(`[LIVE] Updating golfer product access for ${ghinNumber} -> ${status}`);
  return usaGhinApiClient.updateGolferProductAccessStatus(ghinNumber, status);
}

async function revokeGolferProductAccess(ghinNumber) {
  if (config.ghin.useMock) {
    logger.info(`[MOCK] Revoking golfer product access for ${ghinNumber}`);
    return {
      message: 'Mock golfer product access revoked',
      ghinNumber: String(ghinNumber),
      status: 'inactive'
    };
  }

  logger.info(`[LIVE] Revoking golfer product access for ${ghinNumber}`);
  return usaGhinApiClient.revokeGolferProductAccess(ghinNumber);
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

async function getCoursePostingSeason(ghinCourseId) {
  if (config.ghin.useMock) {
    logger.info(`[MOCK] Fetching posting season for course ${ghinCourseId}`);
    return {
      courseId: String(ghinCourseId),
      courseName: null,
      facilityName: null,
      state: null,
      seasonName: 'All Year',
      seasonStartDate: null,
      seasonEndDate: null,
      isAllYear: true
    };
  }

  logger.info(`[LIVE] Fetching posting season for course ${ghinCourseId} from USGA API source`);
  return usaGhinApiClient.getCoursePostingSeason(ghinCourseId);
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

async function postScore(mode, payload) {
  if (config.ghin.useMock) {
    logger.info(`[MOCK] Posting ${mode} score to GHIN`, {
      golferId: payload?.golfer_id,
      courseId: payload?.course_id,
      teeSetId: payload?.tee_set_id
    });
    return {
      success: true,
      score_id: `mock-score-${Date.now()}`,
      confirmation_required: false,
      mode,
      posted_at: new Date().toISOString()
    };
  }

  logger.info(`[LIVE] Posting ${mode} score to USGA API`, {
    golferId: payload?.golfer_id,
    courseId: payload?.course_id,
    teeSetId: payload?.tee_set_id
  });
  return usaGhinApiClient.postScore(mode, payload);
}

async function searchScores(filters = {}) {
  if (config.ghin.useMock) {
    logger.info('[MOCK] Searching posted scores', filters);
    return [];
  }

  logger.info('[LIVE] Searching posted scores via USGA API', filters);
  return usaGhinApiClient.searchScores(filters);
}

async function getScore(scoreId) {
  if (config.ghin.useMock) {
    logger.info(`[MOCK] Fetching posted score ${scoreId}`);
    return {
      score_id: String(scoreId),
      status: 'mock',
      fetched_at: new Date().toISOString()
    };
  }

  logger.info(`[LIVE] Fetching posted score ${scoreId} via USGA API`);
  return usaGhinApiClient.getScore(scoreId);
}

module.exports = {
  getPlayer,
  searchPlayers,
  requestGolferProductAccess,
  getGolferProductAccessStatus,
  updateGolferProductAccessStatus,
  revokeGolferProductAccess,
  getCourse,
  getCoursePostingSeason,
  searchCourses,
  postScore,
  searchScores,
  getScore
};
