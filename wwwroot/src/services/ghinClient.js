// ============================================================
// GHIN API Client
// Phase 1-3: Returns mock data
// Phase 4+: Replace with real GHIN API calls
// ============================================================

const { createLogger } = require('../utils/logger');
const config = require('../config');
const mockData = require('../mocks/ghinData');

const logger = createLogger('ghinClient');

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
