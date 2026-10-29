jest.mock('../src/services/database', () => ({
  query: jest.fn(),
  queryRecordsets: jest.fn(),
  sql: {
    VarChar: () => 'VarChar',
    NVarChar: () => 'NVarChar',
    Decimal: () => 'Decimal',
    Int: 'Int',
    DateTime2: 'DateTime2'
  }
}));
jest.mock('../src/services/usaGhinApiClient', () => ({ getCourse: jest.fn() }));

const database = require('../src/services/database');
const usaGhinApiClient = require('../src/services/usaGhinApiClient');
const { getOrFetchCourse } = require('../src/services/courseSyncService');

const COURSE_ID = '36545';

function snapshotRecordsets({ expiresAt, rated }) {
  const rating = (value) => (rated ? value : null);
  return [
    [{
      courseId: COURSE_ID,
      courseName: 'Sandbox',
      shortCourseName: null,
      facilityName: 'Streamsong',
      city: 'Bowling Green',
      state: 'FL',
      country: 'USA',
      facilityId: '9',
      updatedAt: new Date('2026-10-28T12:00:00Z'),
      expiresAt,
      cachedAt: new Date('2026-10-28T12:00:00Z'),
      cacheSource: 'usga_fetch'
    }],
    [
      {
        teeId: '100', teeName: 'Black', gender: 'M', teeSetSide: 'All18', isDefault: true,
        courseRating18: rating(73.1), slopeRating18: rating(135), par18: 72, yardage18: 7000,
        courseRatingF9: rating(36.5), slopeRatingF9: rating(134), parF9: 36, yardageF9: 3500,
        courseRatingB9: rating(36.6), slopeRatingB9: rating(136), parB9: 36, yardageB9: 3500
      },
      {
        teeId: '200', teeName: 'Gold', gender: 'F', teeSetSide: 'All18', isDefault: false,
        courseRating18: null, slopeRating18: null, par18: 72, yardage18: 5200,
        courseRatingF9: null, slopeRatingF9: null, parF9: 36, yardageF9: 2600,
        courseRatingB9: null, slopeRatingB9: null, parB9: 36, yardageB9: 2600
      }
    ],
    [
      { teeId: '100', holeNumber: 1, par: 4, handicap: 7, yardage: 410 },
      { teeId: '100', holeNumber: 2, par: 5, handicap: 1, yardage: 560 },
      { teeId: '200', holeNumber: 1, par: 4, handicap: 7, yardage: 300 }
    ]
  ];
}

beforeEach(() => {
  jest.clearAllMocks();
  process.env.GHIN_IMPORT_CALLBACK_URL = 'https://api.example/callback';
  process.env.GHIN_MIDDLEWARE_API_KEY = 'test-key';
  global.fetch = jest.fn(async () => ({ ok: true, status: 200, text: async () => '{"success":true}' }));
  database.query.mockImplementation(async (sqlText) => (
    sqlText.includes('@updatedTees') ? [{ updatedCount: 1 }] : []
  ));
});

test('ratings-only load reads the cache once, writes and mirrors together, and returns the new ratings', async () => {
  database.queryRecordsets.mockResolvedValue(snapshotRecordsets({
    expiresAt: new Date('2026-10-29T04:00:00Z'),
    rated: false
  }));
  usaGhinApiClient.getCourse.mockResolvedValue({
    courseId: COURSE_ID,
    tees: [
      { teeId: 100, courseRating: 73.14, slope: 135.4, courseRatingF9: 36.5, slopeRatingF9: 134, courseRatingB9: 36.6, slopeRatingB9: 136 },
      { teeId: 999, courseRating: 70, slope: 120 }
    ]
  });

  const result = await getOrFetchCourse(COURSE_ID, { syncMirror: true, cacheSource: 'usga_fetch' });

  expect(database.queryRecordsets).toHaveBeenCalledTimes(1);
  const writes = database.query.mock.calls.filter(([sqlText]) => sqlText.includes('@updatedTees'));
  expect(writes).toHaveLength(1);
  expect(global.fetch).toHaveBeenCalledTimes(1);
  expect(result.ratingsOnly).toBe(true);
  expect(result.source).toBe('usga_ratings');

  const black = result.course.tees.find((tee) => tee.ghinTeeId === '100');
  expect(black).toMatchObject({
    courseRating18: 73.1, slopeRating18: 135,
    courseRatingF9: 36.5, slopeRatingF9: 134,
    courseRatingB9: 36.6, slopeRatingB9: 136,
    par18: 72, yardage18: 7000
  });
  expect(black.holes).toHaveLength(2);
  const gold = result.course.tees.find((tee) => tee.ghinTeeId === '200');
  expect(gold.courseRating18).toBeNull();
  expect(result.course.tees).toHaveLength(2);

  expect(result.cacheFreshness.fresh).toBe(true);
  expect(result.cacheFreshness.expiresAt).toBeInstanceOf(Date);
});

test('a fresh rated cache is served from the one snapshot read without calling USGA', async () => {
  const expiresAt = new Date(Date.now() + 3600 * 1000);
  database.queryRecordsets.mockResolvedValue(snapshotRecordsets({ expiresAt, rated: true }));

  const result = await getOrFetchCourse(COURSE_ID, { syncMirror: true });

  expect(database.queryRecordsets).toHaveBeenCalledTimes(1);
  expect(usaGhinApiClient.getCourse).not.toHaveBeenCalled();
  expect(global.fetch).not.toHaveBeenCalled();
  expect(result.source).toBe('cache');
  expect(result.cacheFreshness).toEqual({ fresh: true, expiresAt });
  expect(result.course.tees.find((tee) => tee.ghinTeeId === '100').courseRating18).toBe(73.1);
});

test('a mirror failure still fails the ratings-only load', async () => {
  database.queryRecordsets.mockResolvedValue(snapshotRecordsets({
    expiresAt: new Date('2026-10-29T04:00:00Z'),
    rated: false
  }));
  usaGhinApiClient.getCourse.mockResolvedValue({ courseId: COURSE_ID, tees: [{ teeId: 100, courseRating: 73.1, slope: 135 }] });
  global.fetch = jest.fn(async () => ({ ok: false, status: 500, text: async () => 'boom' }));

  await expect(getOrFetchCourse(COURSE_ID, { syncMirror: true })).rejects.toThrow('Ratings-only mirror callback failed (500)');
});
