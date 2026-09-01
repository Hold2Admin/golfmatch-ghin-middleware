jest.mock('../src/services/database', () => ({
  query: jest.fn(),
  sql: {
    Int: 'Int'
  }
}));

const database = require('../src/services/database');
const { getReconciliationCandidateCourseIds } = require('../src/services/courseSyncService');

test('scheduled reconciliation excludes manually sourced cache courses', async () => {
  database.query.mockResolvedValue([{ courseId: '14914' }]);

  const result = await getReconciliationCandidateCourseIds({ offset: 0, batchSize: 100 });
  const [query] = database.query.mock.calls[0];

  expect(query).toContain("UPPER(LTRIM(RTRIM(CacheSource))) <> 'MANUAL'");
  expect(result.courseIds).toEqual(['14914']);
});