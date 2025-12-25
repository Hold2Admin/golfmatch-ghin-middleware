// ============================================================
// Mock GHIN API Data
// Realistic fixtures for development and testing
// ============================================================

const MOCK_PLAYERS = {
  '1234567': {
    ghinNumber: '1234567',
    firstName: 'Clayton',
    lastName: 'Cobb',
    email: 'clayton@example.com',
    clubName: 'Cedar Ridge Golf Club',
    clubId: '12345',
    associationId: 'MGA',
    handicapIndex: '9.4',
    lowHandicapIndex: 8.2,
    trendIndicator: '+',
    lastRevisionDate: '2025-12-20T08:00:00Z',
    gender: 'M',
    status: 'active'
  },
  '2345678': {
    ghinNumber: '2345678',
    firstName: 'Michael',
    lastName: 'Draskin',
    clubName: 'Swan Lake Golf Course',
    clubId: '12346',
    associationId: 'MGA',
    handicapIndex: '+1.0',
    lowHandicapIndex: -0.5,
    trendIndicator: '=',
    lastRevisionDate: '2025-12-20T08:00:00Z',
    gender: 'M',
    status: 'active'
  },
  '3456789': {
    ghinNumber: '3456789',
    firstName: 'Ryan',
    lastName: 'Kayton',
    clubName: 'Forty Niners Golf Club',
    clubId: '12347',
    associationId: 'MGA',
    handicapIndex: '2.3',
    lowHandicapIndex: 1.8,
    trendIndicator: '-',
    lastRevisionDate: '2025-12-20T08:00:00Z',
    gender: 'M',
    status: 'active'
  }
};

const MOCK_COURSES = {
  'GHIN-54321': {
    courseId: 'GHIN-54321',
    courseName: 'Cedar Ridge Golf Club',
    city: 'Boulder',
    state: 'CO',
    country: 'USA',
    facilityId: 'GHIN-FAC-9876',
    tees: [
      {
        teeId: 'GHIN-TEE-1001',
        teeName: 'Blue',
        gender: 'M',
        isDefault: true,
        courseRating: 71.4,
        slope: 136,
        par: 72,
        yardage: 6542,
        holes: [
          { holeNumber: 1, par: 4, handicap: 7, yardage: 398 },
          { holeNumber: 2, par: 4, handicap: 5, yardage: 425 },
          { holeNumber: 3, par: 4, handicap: 13, yardage: 356 },
          { holeNumber: 4, par: 3, handicap: 9, yardage: 189 },
          { holeNumber: 5, par: 5, handicap: 1, yardage: 523 },
          { holeNumber: 6, par: 4, handicap: 17, yardage: 312 },
          { holeNumber: 7, par: 3, handicap: 11, yardage: 167 },
          { holeNumber: 8, par: 4, handicap: 15, yardage: 334 },
          { holeNumber: 9, par: 5, handicap: 3, yardage: 489 },
          { holeNumber: 10, par: 4, handicap: 6, yardage: 401 },
          { holeNumber: 11, par: 4, handicap: 10, yardage: 378 },
          { holeNumber: 12, par: 3, handicap: 12, yardage: 156 },
          { holeNumber: 13, par: 4, handicap: 8, yardage: 387 },
          { holeNumber: 14, par: 5, handicap: 14, yardage: 498 },
          { holeNumber: 15, par: 3, handicap: 18, yardage: 145 },
          { holeNumber: 16, par: 4, handicap: 16, yardage: 301 },
          { holeNumber: 17, par: 4, handicap: 2, yardage: 412 },
          { holeNumber: 18, par: 5, handicap: 4, yardage: 512 }
        ]
      },
      {
        teeId: 'GHIN-TEE-1002',
        teeName: 'Blue',
        gender: 'W',
        isDefault: true,
        courseRating: 70.1,
        slope: 125,
        par: 72,
        yardage: 5823,
        holes: [
          { holeNumber: 1, par: 4, handicap: 9, yardage: 351 },
          { holeNumber: 2, par: 4, handicap: 3, yardage: 378 },
          { holeNumber: 3, par: 4, handicap: 15, yardage: 298 },
          { holeNumber: 4, par: 3, handicap: 11, yardage: 145 },
          { holeNumber: 5, par: 5, handicap: 1, yardage: 456 },
          { holeNumber: 6, par: 4, handicap: 17, yardage: 267 },
          { holeNumber: 7, par: 3, handicap: 13, yardage: 134 },
          { holeNumber: 8, par: 4, handicap: 7, yardage: 289 },
          { holeNumber: 9, par: 5, handicap: 5, yardage: 423 },
          { holeNumber: 10, par: 4, handicap: 8, yardage: 345 },
          { holeNumber: 11, par: 4, handicap: 12, yardage: 312 },
          { holeNumber: 12, par: 3, handicap: 14, yardage: 123 },
          { holeNumber: 13, par: 4, handicap: 10, yardage: 334 },
          { holeNumber: 14, par: 5, handicap: 6, yardage: 445 },
          { holeNumber: 15, par: 3, handicap: 18, yardage: 112 },
          { holeNumber: 16, par: 4, handicap: 16, yardage: 256 },
          { holeNumber: 17, par: 4, handicap: 2, yardage: 367 },
          { holeNumber: 18, par: 5, handicap: 4, yardage: 478 }
        ]
      },
      {
        teeId: 'GHIN-TEE-1003',
        teeName: 'White',
        gender: 'M',
        courseRating: 69.0,
        slope: 130,
        par: 72,
        yardage: 6123,
        holes: [
          { holeNumber: 1, par: 4, handicap: 7, yardage: 378 },
          { holeNumber: 2, par: 4, handicap: 5, yardage: 398 },
          { holeNumber: 3, par: 4, handicap: 13, yardage: 334 },
          { holeNumber: 4, par: 3, handicap: 9, yardage: 167 },
          { holeNumber: 5, par: 5, handicap: 1, yardage: 489 },
          { holeNumber: 6, par: 4, handicap: 17, yardage: 289 },
          { holeNumber: 7, par: 3, handicap: 11, yardage: 145 },
          { holeNumber: 8, par: 4, handicap: 15, yardage: 312 },
          { holeNumber: 9, par: 5, handicap: 3, yardage: 456 },
          { holeNumber: 10, par: 4, handicap: 6, yardage: 378 },
          { holeNumber: 11, par: 4, handicap: 10, yardage: 345 },
          { holeNumber: 12, par: 3, handicap: 12, yardage: 134 },
          { holeNumber: 13, par: 4, handicap: 8, yardage: 356 },
          { holeNumber: 14, par: 5, handicap: 14, yardage: 467 },
          { holeNumber: 15, par: 3, handicap: 18, yardage: 123 },
          { holeNumber: 16, par: 4, handicap: 16, yardage: 278 },
          { holeNumber: 17, par: 4, handicap: 2, yardage: 389 },
          { holeNumber: 18, par: 5, handicap: 4, yardage: 487 }
        ]
      },
      {
        teeId: 'GHIN-TEE-1004',
        teeName: 'White',
        gender: 'W',
        courseRating: 68.3,
        slope: 120,
        par: 72,
        yardage: 5450,
        holes: [
          { holeNumber: 1, par: 4, handicap: 9, yardage: 330 },
          { holeNumber: 2, par: 4, handicap: 3, yardage: 360 },
          { holeNumber: 3, par: 4, handicap: 15, yardage: 280 },
          { holeNumber: 4, par: 3, handicap: 11, yardage: 130 },
          { holeNumber: 5, par: 5, handicap: 1, yardage: 430 },
          { holeNumber: 6, par: 4, handicap: 17, yardage: 240 },
          { holeNumber: 7, par: 3, handicap: 13, yardage: 120 },
          { holeNumber: 8, par: 4, handicap: 7, yardage: 270 },
          { holeNumber: 9, par: 5, handicap: 5, yardage: 410 },
          { holeNumber: 10, par: 4, handicap: 8, yardage: 330 },
          { holeNumber: 11, par: 4, handicap: 12, yardage: 300 },
          { holeNumber: 12, par: 3, handicap: 14, yardage: 110 },
          { holeNumber: 13, par: 4, handicap: 10, yardage: 310 },
          { holeNumber: 14, par: 5, handicap: 6, yardage: 420 },
          { holeNumber: 15, par: 3, handicap: 18, yardage: 105 },
          { holeNumber: 16, par: 4, handicap: 16, yardage: 235 },
          { holeNumber: 17, par: 4, handicap: 2, yardage: 350 },
          { holeNumber: 18, par: 5, handicap: 4, yardage: 445 }
        ]
      }
    ]
  }
};

/**
 * Get player by GHIN number
 */
function getPlayer(ghinNumber) {
  return MOCK_PLAYERS[ghinNumber] || null;
}

/**
 * Search for players
 */
function searchPlayers({ firstName, lastName, clubName, associationId }) {
  const results = Object.values(MOCK_PLAYERS).filter(player => {
    if (firstName && !player.firstName.toLowerCase().includes(firstName.toLowerCase())) {
      return false;
    }
    if (lastName && !player.lastName.toLowerCase().includes(lastName.toLowerCase())) {
      return false;
    }
    if (clubName && !player.clubName.toLowerCase().includes(clubName.toLowerCase())) {
      return false;
    }
    if (associationId && player.associationId !== associationId) {
      return false;
    }
    return true;
  });
  
  return results;
}

/**
 * Get course by GHIN course ID
 */
function getCourse(ghinCourseId) {
  return MOCK_COURSES[ghinCourseId] || null;
}

/**
 * Search for courses
 */
function searchCourses({ courseName, city, state, country }) {
  const results = Object.values(MOCK_COURSES).filter(course => {
    if (courseName && !course.courseName.toLowerCase().includes(courseName.toLowerCase())) {
      return false;
    }
    if (city && course.city && !course.city.toLowerCase().includes(city.toLowerCase())) {
      return false;
    }
    if (state && course.state !== state) {
      return false;
    }
    if (country && course.country !== country) {
      return false;
    }
    return true;
  });
  
  // Return preview format
  return results.map(course => ({
    ghinCourseId: course.courseId,
    courseName: course.courseName,
    city: course.city,
    state: course.state,
    teeCount: course.tees.length,
    preview: {
      hasBlue: course.tees.some(t => t.teeName === 'Blue'),
      hasWhite: course.tees.some(t => t.teeName === 'White'),
      hasRed: course.tees.some(t => t.teeName === 'Red')
    }
  }));
}

module.exports = {
  getPlayer,
  searchPlayers,
  getCourse,
  searchCourses
};
