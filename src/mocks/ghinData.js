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
    lastUpdatedUtc: '2025-12-25T10:00:00Z',
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
        teeName: 'Red',
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
        teeName: 'Red',
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
  },
  'GHIN-65432': {
    courseId: 'GHIN-65432',
    courseName: 'Arrowhead Golf Club',
    city: 'Littleton',
    state: 'CO',
    country: 'USA',
    facilityId: 'GHIN-FAC-8765',
    tees: [
      {
        teeId: 'GHIN-TEE-2001',
        teeName: 'Championship',
        gender: 'M',
        isDefault: true,
        courseRating: 74.5,
        slope: 145,
        par: 72,
        yardage: 6828,
        holes: [
          { holeNumber: 1, par: 4, handicap: 11, yardage: 380 },
          { holeNumber: 2, par: 5, handicap: 9, yardage: 505 },
          { holeNumber: 3, par: 4, handicap: 15, yardage: 390 },
          { holeNumber: 4, par: 4, handicap: 7, yardage: 327 },
          { holeNumber: 5, par: 3, handicap: 17, yardage: 188 },
          { holeNumber: 6, par: 5, handicap: 3, yardage: 523 },
          { holeNumber: 7, par: 3, handicap: 13, yardage: 106 },
          { holeNumber: 8, par: 4, handicap: 1, yardage: 431 },
          { holeNumber: 9, par: 4, handicap: 5, yardage: 466 },
          { holeNumber: 10, par: 4, handicap: 6, yardage: 446 },
          { holeNumber: 11, par: 4, handicap: 14, yardage: 390 },
          { holeNumber: 12, par: 3, handicap: 16, yardage: 202 },
          { holeNumber: 13, par: 4, handicap: 10, yardage: 445 },
          { holeNumber: 14, par: 5, handicap: 2, yardage: 580 },
          { holeNumber: 15, par: 4, handicap: 12, yardage: 397 },
          { holeNumber: 16, par: 4, handicap: 8, yardage: 403 },
          { holeNumber: 17, par: 3, handicap: 18, yardage: 178 },
          { holeNumber: 18, par: 5, handicap: 4, yardage: 543 }
        ]
      },
      {
        teeId: 'GHIN-TEE-2002',
        teeName: 'Championship',
        gender: 'W',
        isDefault: true,
        courseRating: 72.8,
        slope: 135,
        par: 72,
        yardage: 6234,
        holes: [
          { holeNumber: 1, par: 4, handicap: 11, yardage: 345 },
          { holeNumber: 2, par: 5, handicap: 5, yardage: 465 },
          { holeNumber: 3, par: 4, handicap: 15, yardage: 350 },
          { holeNumber: 4, par: 4, handicap: 9, yardage: 295 },
          { holeNumber: 5, par: 3, handicap: 17, yardage: 155 },
          { holeNumber: 6, par: 5, handicap: 1, yardage: 485 },
          { holeNumber: 7, par: 3, handicap: 13, yardage: 95 },
          { holeNumber: 8, par: 4, handicap: 3, yardage: 390 },
          { holeNumber: 9, par: 4, handicap: 7, yardage: 420 },
          { holeNumber: 10, par: 4, handicap: 8, yardage: 405 },
          { holeNumber: 11, par: 4, handicap: 14, yardage: 345 },
          { holeNumber: 12, par: 3, handicap: 16, yardage: 165 },
          { holeNumber: 13, par: 4, handicap: 10, yardage: 395 },
          { holeNumber: 14, par: 5, handicap: 2, yardage: 535 },
          { holeNumber: 15, par: 4, handicap: 12, yardage: 350 },
          { holeNumber: 16, par: 4, handicap: 6, yardage: 360 },
          { holeNumber: 17, par: 3, handicap: 18, yardage: 150 },
          { holeNumber: 18, par: 5, handicap: 4, yardage: 495 }
        ]
      },
      {
        teeId: 'GHIN-TEE-2003',
        teeName: 'Resort',
        gender: 'M',
        courseRating: 71.2,
        slope: 138,
        par: 72,
        yardage: 6345,
        holes: [
          { holeNumber: 1, par: 4, handicap: 11, yardage: 360 },
          { holeNumber: 2, par: 5, handicap: 9, yardage: 480 },
          { holeNumber: 3, par: 4, handicap: 15, yardage: 365 },
          { holeNumber: 4, par: 4, handicap: 7, yardage: 310 },
          { holeNumber: 5, par: 3, handicap: 17, yardage: 170 },
          { holeNumber: 6, par: 5, handicap: 3, yardage: 495 },
          { holeNumber: 7, par: 3, handicap: 13, yardage: 98 },
          { holeNumber: 8, par: 4, handicap: 1, yardage: 405 },
          { holeNumber: 9, par: 4, handicap: 5, yardage: 440 },
          { holeNumber: 10, par: 4, handicap: 6, yardage: 420 },
          { holeNumber: 11, par: 4, handicap: 14, yardage: 365 },
          { holeNumber: 12, par: 3, handicap: 16, yardage: 185 },
          { holeNumber: 13, par: 4, handicap: 10, yardage: 420 },
          { holeNumber: 14, par: 5, handicap: 2, yardage: 550 },
          { holeNumber: 15, par: 4, handicap: 12, yardage: 375 },
          { holeNumber: 16, par: 4, handicap: 8, yardage: 380 },
          { holeNumber: 17, par: 3, handicap: 18, yardage: 165 },
          { holeNumber: 18, par: 5, handicap: 4, yardage: 515 }
        ]
      }
    ]
  },
  'GHIN-76543': {
    courseId: 'GHIN-76543',
    courseName: 'The Broadmoor East Course',
    city: 'Colorado Springs',
    state: 'CO',
    country: 'USA',
    facilityId: 'GHIN-FAC-7654',
    tees: [
      {
        teeId: 'GHIN-TEE-3001',
        teeName: 'Tournament',
        gender: 'M',
        isDefault: true,
        courseRating: 76.2,
        slope: 148,
        par: 72,
        yardage: 7475,
        holes: [
          { holeNumber: 1, par: 4, handicap: 9, yardage: 445 },
          { holeNumber: 2, par: 5, handicap: 3, yardage: 575 },
          { holeNumber: 3, par: 4, handicap: 13, yardage: 350 },
          { holeNumber: 4, par: 3, handicap: 17, yardage: 240 },
          { holeNumber: 5, par: 4, handicap: 1, yardage: 495 },
          { holeNumber: 6, par: 3, handicap: 15, yardage: 180 },
          { holeNumber: 7, par: 4, handicap: 7, yardage: 450 },
          { holeNumber: 8, par: 5, handicap: 5, yardage: 570 },
          { holeNumber: 9, par: 4, handicap: 11, yardage: 460 },
          { holeNumber: 10, par: 4, handicap: 2, yardage: 495 },
          { holeNumber: 11, par: 4, handicap: 6, yardage: 520 },
          { holeNumber: 12, par: 3, handicap: 18, yardage: 155 },
          { holeNumber: 13, par: 5, handicap: 4, yardage: 510 },
          { holeNumber: 14, par: 4, handicap: 14, yardage: 440 },
          { holeNumber: 15, par: 5, handicap: 8, yardage: 550 },
          { holeNumber: 16, par: 3, handicap: 16, yardage: 170 },
          { holeNumber: 17, par: 4, handicap: 12, yardage: 440 },
          { holeNumber: 18, par: 4, handicap: 10, yardage: 465 }
        ]
      },
      {
        teeId: 'GHIN-TEE-3002',
        teeName: 'Tournament',
        gender: 'W',
        isDefault: true,
        courseRating: 73.5,
        slope: 140,
        par: 72,
        yardage: 6365,
        holes: [
          { holeNumber: 1, par: 4, handicap: 9, yardage: 380 },
          { holeNumber: 2, par: 5, handicap: 3, yardage: 490 },
          { holeNumber: 3, par: 4, handicap: 13, yardage: 305 },
          { holeNumber: 4, par: 3, handicap: 17, yardage: 185 },
          { holeNumber: 5, par: 4, handicap: 1, yardage: 420 },
          { holeNumber: 6, par: 3, handicap: 15, yardage: 145 },
          { holeNumber: 7, par: 4, handicap: 7, yardage: 385 },
          { holeNumber: 8, par: 5, handicap: 5, yardage: 480 },
          { holeNumber: 9, par: 4, handicap: 11, yardage: 395 },
          { holeNumber: 10, par: 4, handicap: 2, yardage: 425 },
          { holeNumber: 11, par: 4, handicap: 6, yardage: 445 },
          { holeNumber: 12, par: 3, handicap: 18, yardage: 125 },
          { holeNumber: 13, par: 5, handicap: 4, yardage: 440 },
          { holeNumber: 14, par: 4, handicap: 14, yardage: 375 },
          { holeNumber: 15, par: 5, handicap: 8, yardage: 470 },
          { holeNumber: 16, par: 3, handicap: 16, yardage: 140 },
          { holeNumber: 17, par: 4, handicap: 12, yardage: 380 },
          { holeNumber: 18, par: 4, handicap: 10, yardage: 400 }
        ]
      },
      {
        teeId: 'GHIN-TEE-3003',
        teeName: 'Members',
        gender: 'M',
        courseRating: 73.8,
        slope: 142,
        par: 72,
        yardage: 6890,
        holes: [
          { holeNumber: 1, par: 4, handicap: 9, yardage: 420 },
          { holeNumber: 2, par: 5, handicap: 3, yardage: 540 },
          { holeNumber: 3, par: 4, handicap: 13, yardage: 330 },
          { holeNumber: 4, par: 3, handicap: 17, yardage: 220 },
          { holeNumber: 5, par: 4, handicap: 1, yardage: 465 },
          { holeNumber: 6, par: 3, handicap: 15, yardage: 165 },
          { holeNumber: 7, par: 4, handicap: 7, yardage: 425 },
          { holeNumber: 8, par: 5, handicap: 5, yardage: 535 },
          { holeNumber: 9, par: 4, handicap: 11, yardage: 435 },
          { holeNumber: 10, par: 4, handicap: 2, yardage: 470 },
          { holeNumber: 11, par: 4, handicap: 6, yardage: 490 },
          { holeNumber: 12, par: 3, handicap: 18, yardage: 140 },
          { holeNumber: 13, par: 5, handicap: 4, yardage: 480 },
          { holeNumber: 14, par: 4, handicap: 14, yardage: 410 },
          { holeNumber: 15, par: 5, handicap: 8, yardage: 520 },
          { holeNumber: 16, par: 3, handicap: 16, yardage: 155 },
          { holeNumber: 17, par: 4, handicap: 12, yardage: 415 },
          { holeNumber: 18, par: 4, handicap: 10, yardage: 440 }
        ]
      },
      {
        teeId: 'GHIN-TEE-3004',
        teeName: 'Ladies',
        gender: 'W',
        courseRating: 71.2,
        slope: 135,
        par: 72,
        yardage: 5890,
        holes: [
          { holeNumber: 1, par: 4, handicap: 9, yardage: 355 },
          { holeNumber: 2, par: 5, handicap: 3, yardage: 455 },
          { holeNumber: 3, par: 4, handicap: 13, yardage: 285 },
          { holeNumber: 4, par: 3, handicap: 17, yardage: 165 },
          { holeNumber: 5, par: 4, handicap: 1, yardage: 390 },
          { holeNumber: 6, par: 3, handicap: 15, yardage: 130 },
          { holeNumber: 7, par: 4, handicap: 7, yardage: 360 },
          { holeNumber: 8, par: 5, handicap: 5, yardage: 445 },
          { holeNumber: 9, par: 4, handicap: 11, yardage: 370 },
          { holeNumber: 10, par: 4, handicap: 2, yardage: 395 },
          { holeNumber: 11, par: 4, handicap: 6, yardage: 415 },
          { holeNumber: 12, par: 3, handicap: 18, yardage: 110 },
          { holeNumber: 13, par: 5, handicap: 4, yardage: 410 },
          { holeNumber: 14, par: 4, handicap: 14, yardage: 345 },
          { holeNumber: 15, par: 5, handicap: 8, yardage: 440 },
          { holeNumber: 16, par: 3, handicap: 16, yardage: 125 },
          { holeNumber: 17, par: 4, handicap: 12, yardage: 355 },
          { holeNumber: 18, par: 4, handicap: 10, yardage: 370 }
        ]
      }
    ]
  },
  'GHIN-87654': {
    courseId: 'GHIN-87654',
    courseName: 'Torrey Pines South Course',
    city: 'San Diego',
    state: 'CA',
    country: 'USA',
    facilityId: 'GHIN-FAC-6543',
    tees: [
      {
        teeId: 'GHIN-TEE-4001',
        teeName: 'Black',
        gender: 'M',
        isDefault: true,
        courseRating: 75.3,
        slope: 144,
        par: 71,
        yardage: 7588,
        holes: [
          { holeNumber: 1, par: 4, handicap: 13, yardage: 420 },
          { holeNumber: 2, par: 4, handicap: 5, yardage: 495 },
          { holeNumber: 3, par: 4, handicap: 11, yardage: 385 },
          { holeNumber: 4, par: 5, handicap: 7, yardage: 595 },
          { holeNumber: 5, par: 3, handicap: 17, yardage: 215 },
          { holeNumber: 6, par: 4, handicap: 3, yardage: 425 },
          { holeNumber: 7, par: 4, handicap: 9, yardage: 415 },
          { holeNumber: 8, par: 4, handicap: 1, yardage: 505 },
          { holeNumber: 9, par: 3, handicap: 15, yardage: 195 },
          { holeNumber: 10, par: 5, handicap: 6, yardage: 620 },
          { holeNumber: 11, par: 4, handicap: 12, yardage: 445 },
          { holeNumber: 12, par: 4, handicap: 14, yardage: 460 },
          { holeNumber: 13, par: 4, handicap: 2, yardage: 445 },
          { holeNumber: 14, par: 4, handicap: 10, yardage: 445 },
          { holeNumber: 15, par: 3, handicap: 16, yardage: 210 },
          { holeNumber: 16, par: 4, handicap: 4, yardage: 535 },
          { holeNumber: 17, par: 3, handicap: 18, yardage: 205 },
          { holeNumber: 18, par: 4, handicap: 8, yardage: 450 }
        ]
      },
      {
        teeId: 'GHIN-TEE-4002',
        teeName: 'Black',
        gender: 'W',
        isDefault: true,
        courseRating: 74.1,
        slope: 138,
        par: 71,
        yardage: 6555,
        holes: [
          { holeNumber: 1, par: 4, handicap: 13, yardage: 365 },
          { holeNumber: 2, par: 4, handicap: 5, yardage: 430 },
          { holeNumber: 3, par: 4, handicap: 11, yardage: 335 },
          { holeNumber: 4, par: 5, handicap: 3, yardage: 510 },
          { holeNumber: 5, par: 3, handicap: 17, yardage: 175 },
          { holeNumber: 6, par: 4, handicap: 7, yardage: 370 },
          { holeNumber: 7, par: 4, handicap: 9, yardage: 360 },
          { holeNumber: 8, par: 4, handicap: 1, yardage: 440 },
          { holeNumber: 9, par: 3, handicap: 15, yardage: 160 },
          { holeNumber: 10, par: 5, handicap: 2, yardage: 535 },
          { holeNumber: 11, par: 4, handicap: 12, yardage: 385 },
          { holeNumber: 12, par: 4, handicap: 14, yardage: 395 },
          { holeNumber: 13, par: 4, handicap: 6, yardage: 390 },
          { holeNumber: 14, par: 4, handicap: 10, yardage: 385 },
          { holeNumber: 15, par: 3, handicap: 16, yardage: 170 },
          { holeNumber: 16, par: 4, handicap: 4, yardage: 465 },
          { holeNumber: 17, par: 3, handicap: 18, yardage: 165 },
          { holeNumber: 18, par: 4, handicap: 8, yardage: 390 }
        ]
      },
      {
        teeId: 'GHIN-TEE-4003',
        teeName: 'Gold',
        gender: 'M',
        courseRating: 72.5,
        slope: 139,
        par: 71,
        yardage: 7025,
        holes: [
          { holeNumber: 1, par: 4, handicap: 13, yardage: 390 },
          { holeNumber: 2, par: 4, handicap: 5, yardage: 460 },
          { holeNumber: 3, par: 4, handicap: 11, yardage: 355 },
          { holeNumber: 4, par: 5, handicap: 7, yardage: 555 },
          { holeNumber: 5, par: 3, handicap: 17, yardage: 195 },
          { holeNumber: 6, par: 4, handicap: 3, yardage: 395 },
          { holeNumber: 7, par: 4, handicap: 9, yardage: 385 },
          { holeNumber: 8, par: 4, handicap: 1, yardage: 470 },
          { holeNumber: 9, par: 3, handicap: 15, yardage: 175 },
          { holeNumber: 10, par: 5, handicap: 6, yardage: 580 },
          { holeNumber: 11, par: 4, handicap: 12, yardage: 415 },
          { holeNumber: 12, par: 4, handicap: 14, yardage: 425 },
          { holeNumber: 13, par: 4, handicap: 2, yardage: 415 },
          { holeNumber: 14, par: 4, handicap: 10, yardage: 415 },
          { holeNumber: 15, par: 3, handicap: 16, yardage: 190 },
          { holeNumber: 16, par: 4, handicap: 4, yardage: 500 },
          { holeNumber: 17, par: 3, handicap: 18, yardage: 185 },
          { holeNumber: 18, par: 4, handicap: 8, yardage: 420 }
        ]
      }
    ]
  },
  'GHIN-98765': {
    courseId: 'GHIN-98765',
    courseName: 'Olympic Club Lake Course',
    city: 'San Francisco',
    state: 'CA',
    country: 'USA',
    facilityId: 'GHIN-FAC-5432',
    tees: [
      {
        teeId: 'GHIN-TEE-5001',
        teeName: 'Tournament',
        gender: 'M',
        isDefault: true,
        courseRating: 76.0,
        slope: 155,
        par: 72,
        yardage: 7256,
        holes: [
          { holeNumber: 1, par: 4, handicap: 11, yardage: 423 },
          { holeNumber: 2, par: 5, handicap: 7, yardage: 532 },
          { holeNumber: 3, par: 3, handicap: 15, yardage: 177 },
          { holeNumber: 4, par: 4, handicap: 3, yardage: 384 },
          { holeNumber: 5, par: 4, handicap: 9, yardage: 471 },
          { holeNumber: 6, par: 4, handicap: 13, yardage: 393 },
          { holeNumber: 7, par: 4, handicap: 5, yardage: 442 },
          { holeNumber: 8, par: 3, handicap: 17, yardage: 237 },
          { holeNumber: 9, par: 5, handicap: 1, yardage: 583 },
          { holeNumber: 10, par: 4, handicap: 6, yardage: 424 },
          { holeNumber: 11, par: 5, handicap: 2, yardage: 558 },
          { holeNumber: 12, par: 4, handicap: 14, yardage: 358 },
          { holeNumber: 13, par: 3, handicap: 18, yardage: 181 },
          { holeNumber: 14, par: 4, handicap: 10, yardage: 467 },
          { holeNumber: 15, par: 4, handicap: 12, yardage: 449 },
          { holeNumber: 16, par: 5, handicap: 4, yardage: 507 },
          { holeNumber: 17, par: 3, handicap: 16, yardage: 137 },
          { holeNumber: 18, par: 4, handicap: 8, yardage: 462 }
        ]
      },
      {
        teeId: 'GHIN-TEE-5002',
        teeName: 'Tournament',
        gender: 'W',
        isDefault: true,
        courseRating: 73.2,
        slope: 145,
        par: 72,
        yardage: 6365,
        holes: [
          { holeNumber: 1, par: 4, handicap: 11, yardage: 370 },
          { holeNumber: 2, par: 5, handicap: 3, yardage: 465 },
          { holeNumber: 3, par: 3, handicap: 15, yardage: 145 },
          { holeNumber: 4, par: 4, handicap: 7, yardage: 335 },
          { holeNumber: 5, par: 4, handicap: 1, yardage: 410 },
          { holeNumber: 6, par: 4, handicap: 13, yardage: 340 },
          { holeNumber: 7, par: 4, handicap: 5, yardage: 385 },
          { holeNumber: 8, par: 3, handicap: 17, yardage: 190 },
          { holeNumber: 9, par: 5, handicap: 9, yardage: 505 },
          { holeNumber: 10, par: 4, handicap: 6, yardage: 370 },
          { holeNumber: 11, par: 5, handicap: 2, yardage: 485 },
          { holeNumber: 12, par: 4, handicap: 14, yardage: 310 },
          { holeNumber: 13, par: 3, handicap: 18, yardage: 150 },
          { holeNumber: 14, par: 4, handicap: 10, yardage: 405 },
          { holeNumber: 15, par: 4, handicap: 12, yardage: 390 },
          { holeNumber: 16, par: 5, handicap: 4, yardage: 440 },
          { holeNumber: 17, par: 3, handicap: 16, yardage: 115 },
          { holeNumber: 18, par: 4, handicap: 8, yardage: 400 }
        ]
      },
      {
        teeId: 'GHIN-TEE-5003',
        teeName: 'Players',
        gender: 'M',
        courseRating: 73.8,
        slope: 150,
        par: 72,
        yardage: 6778,
        holes: [
          { holeNumber: 1, par: 4, handicap: 11, yardage: 395 },
          { holeNumber: 2, par: 5, handicap: 7, yardage: 495 },
          { holeNumber: 3, par: 3, handicap: 15, yardage: 160 },
          { holeNumber: 4, par: 4, handicap: 3, yardage: 360 },
          { holeNumber: 5, par: 4, handicap: 9, yardage: 440 },
          { holeNumber: 6, par: 4, handicap: 13, yardage: 365 },
          { holeNumber: 7, par: 4, handicap: 5, yardage: 415 },
          { holeNumber: 8, par: 3, handicap: 17, yardage: 215 },
          { holeNumber: 9, par: 5, handicap: 1, yardage: 545 },
          { holeNumber: 10, par: 4, handicap: 6, yardage: 395 },
          { holeNumber: 11, par: 5, handicap: 2, yardage: 520 },
          { holeNumber: 12, par: 4, handicap: 14, yardage: 335 },
          { holeNumber: 13, par: 3, handicap: 18, yardage: 165 },
          { holeNumber: 14, par: 4, handicap: 10, yardage: 435 },
          { holeNumber: 15, par: 4, handicap: 12, yardage: 420 },
          { holeNumber: 16, par: 5, handicap: 4, yardage: 475 },
          { holeNumber: 17, par: 3, handicap: 16, yardage: 125 },
          { holeNumber: 18, par: 4, handicap: 8, yardage: 430 }
        ]
      },
      {
        teeId: 'GHIN-TEE-5004',
        teeName: 'Member',
        gender: 'W',
        courseRating: 70.5,
        slope: 140,
        par: 72,
        yardage: 5845,
        holes: [
          { holeNumber: 1, par: 4, handicap: 11, yardage: 340 },
          { holeNumber: 2, par: 5, handicap: 3, yardage: 430 },
          { holeNumber: 3, par: 3, handicap: 15, yardage: 130 },
          { holeNumber: 4, par: 4, handicap: 7, yardage: 310 },
          { holeNumber: 5, par: 4, handicap: 1, yardage: 380 },
          { holeNumber: 6, par: 4, handicap: 13, yardage: 315 },
          { holeNumber: 7, par: 4, handicap: 5, yardage: 355 },
          { holeNumber: 8, par: 3, handicap: 17, yardage: 170 },
          { holeNumber: 9, par: 5, handicap: 9, yardage: 470 },
          { holeNumber: 10, par: 4, handicap: 6, yardage: 345 },
          { holeNumber: 11, par: 5, handicap: 2, yardage: 450 },
          { holeNumber: 12, par: 4, handicap: 14, yardage: 285 },
          { holeNumber: 13, par: 3, handicap: 18, yardage: 135 },
          { holeNumber: 14, par: 4, handicap: 10, yardage: 375 },
          { holeNumber: 15, par: 4, handicap: 12, yardage: 360 },
          { holeNumber: 16, par: 5, handicap: 4, yardage: 410 },
          { holeNumber: 17, par: 3, handicap: 16, yardage: 105 },
          { holeNumber: 18, par: 4, handicap: 8, yardage: 370 }
        ]
      }
    ]
  },
  'GHIN-13579': {
    courseId: 'GHIN-13579',
    courseName: 'Riviera Country Club',
    city: 'Pacific Palisades',
    state: 'CA',
    country: 'USA',
    facilityId: 'GHIN-FAC-4321',
    tees: [
      {
        teeId: 'GHIN-TEE-6001',
        teeName: 'Championship',
        gender: 'M',
        isDefault: true,
        courseRating: 77.5,
        slope: 155,
        par: 71,
        yardage: 7468,
        holes: [
          { holeNumber: 1, par: 4, handicap: 7, yardage: 430 },
          { holeNumber: 2, par: 4, handicap: 15, yardage: 389 },
          { holeNumber: 3, par: 3, handicap: 17, yardage: 210 },
          { holeNumber: 4, par: 5, handicap: 1, yardage: 517 },
          { holeNumber: 5, par: 4, handicap: 5, yardage: 478 },
          { holeNumber: 6, par: 4, handicap: 11, yardage: 408 },
          { holeNumber: 7, par: 5, handicap: 3, yardage: 525 },
          { holeNumber: 8, par: 3, handicap: 13, yardage: 203 },
          { holeNumber: 9, par: 4, handicap: 9, yardage: 431 },
          { holeNumber: 10, par: 4, handicap: 2, yardage: 502 },
          { holeNumber: 11, par: 4, handicap: 12, yardage: 435 },
          { holeNumber: 12, par: 5, handicap: 4, yardage: 499 },
          { holeNumber: 13, par: 3, handicap: 16, yardage: 160 },
          { holeNumber: 14, par: 4, handicap: 10, yardage: 517 },
          { holeNumber: 15, par: 4, handicap: 6, yardage: 459 },
          { holeNumber: 16, par: 4, handicap: 8, yardage: 490 },
          { holeNumber: 17, par: 3, handicap: 18, yardage: 207 },
          { holeNumber: 18, par: 4, handicap: 14, yardage: 411 }
        ]
      },
      {
        teeId: 'GHIN-TEE-6002',
        teeName: 'Championship',
        gender: 'W',
        isDefault: true,
        courseRating: 75.8,
        slope: 148,
        par: 71,
        yardage: 6684,
        holes: [
          { holeNumber: 1, par: 4, handicap: 7, yardage: 385 },
          { holeNumber: 2, par: 4, handicap: 15, yardage: 345 },
          { holeNumber: 3, par: 3, handicap: 17, yardage: 175 },
          { holeNumber: 4, par: 5, handicap: 1, yardage: 460 },
          { holeNumber: 5, par: 4, handicap: 3, yardage: 425 },
          { holeNumber: 6, par: 4, handicap: 11, yardage: 365 },
          { holeNumber: 7, par: 5, handicap: 5, yardage: 470 },
          { holeNumber: 8, par: 3, handicap: 13, yardage: 170 },
          { holeNumber: 9, par: 4, handicap: 9, yardage: 385 },
          { holeNumber: 10, par: 4, handicap: 2, yardage: 445 },
          { holeNumber: 11, par: 4, handicap: 12, yardage: 390 },
          { holeNumber: 12, par: 5, handicap: 4, yardage: 445 },
          { holeNumber: 13, par: 3, handicap: 16, yardage: 135 },
          { holeNumber: 14, par: 4, handicap: 10, yardage: 460 },
          { holeNumber: 15, par: 4, handicap: 6, yardage: 410 },
          { holeNumber: 16, par: 4, handicap: 8, yardage: 435 },
          { holeNumber: 17, par: 3, handicap: 18, yardage: 175 },
          { holeNumber: 18, par: 4, handicap: 14, yardage: 365 }
        ]
      },
      {
        teeId: 'GHIN-TEE-6003',
        teeName: 'Blue',
        gender: 'M',
        courseRating: 74.2,
        slope: 148,
        par: 71,
        yardage: 6889,
        holes: [
          { holeNumber: 1, par: 4, handicap: 7, yardage: 400 },
          { holeNumber: 2, par: 4, handicap: 15, yardage: 360 },
          { holeNumber: 3, par: 3, handicap: 17, yardage: 190 },
          { holeNumber: 4, par: 5, handicap: 1, yardage: 485 },
          { holeNumber: 5, par: 4, handicap: 5, yardage: 445 },
          { holeNumber: 6, par: 4, handicap: 11, yardage: 380 },
          { holeNumber: 7, par: 5, handicap: 3, yardage: 495 },
          { holeNumber: 8, par: 3, handicap: 13, yardage: 185 },
          { holeNumber: 9, par: 4, handicap: 9, yardage: 405 },
          { holeNumber: 10, par: 4, handicap: 2, yardage: 470 },
          { holeNumber: 11, par: 4, handicap: 12, yardage: 405 },
          { holeNumber: 12, par: 5, handicap: 4, yardage: 470 },
          { holeNumber: 13, par: 3, handicap: 16, yardage: 145 },
          { holeNumber: 14, par: 4, handicap: 10, yardage: 485 },
          { holeNumber: 15, par: 4, handicap: 6, yardage: 430 },
          { holeNumber: 16, par: 4, handicap: 8, yardage: 460 },
          { holeNumber: 17, par: 3, handicap: 18, yardage: 190 },
          { holeNumber: 18, par: 4, handicap: 14, yardage: 385 }
        ]
      },
      {
        teeId: 'GHIN-TEE-6004',
        teeName: 'White',
        gender: 'M',
        courseRating: 71.5,
        slope: 143,
        par: 71,
        yardage: 6345,
        holes: [
          { holeNumber: 1, par: 4, handicap: 7, yardage: 370 },
          { holeNumber: 2, par: 4, handicap: 15, yardage: 335 },
          { holeNumber: 3, par: 3, handicap: 17, yardage: 170 },
          { holeNumber: 4, par: 5, handicap: 1, yardage: 455 },
          { holeNumber: 5, par: 4, handicap: 5, yardage: 415 },
          { holeNumber: 6, par: 4, handicap: 11, yardage: 350 },
          { holeNumber: 7, par: 5, handicap: 3, yardage: 465 },
          { holeNumber: 8, par: 3, handicap: 13, yardage: 165 },
          { holeNumber: 9, par: 4, handicap: 9, yardage: 375 },
          { holeNumber: 10, par: 4, handicap: 2, yardage: 440 },
          { holeNumber: 11, par: 4, handicap: 12, yardage: 375 },
          { holeNumber: 12, par: 5, handicap: 4, yardage: 440 },
          { holeNumber: 13, par: 3, handicap: 16, yardage: 130 },
          { holeNumber: 14, par: 4, handicap: 10, yardage: 455 },
          { holeNumber: 15, par: 4, handicap: 6, yardage: 400 },
          { holeNumber: 16, par: 4, handicap: 8, yardage: 430 },
          { holeNumber: 17, par: 3, handicap: 18, yardage: 170 },
          { holeNumber: 18, par: 4, handicap: 14, yardage: 360 }
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
