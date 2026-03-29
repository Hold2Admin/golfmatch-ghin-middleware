jest.mock('../src/services/ghinClient', () => ({
  getCoursePostingSeason: jest.fn(),
  postScore: jest.fn(),
  searchScores: jest.fn(),
  getScore: jest.fn(),
}));

const ghinClient = require('../src/services/ghinClient');
const scorePostingService = require('../src/services/scorePostingService');

describe('scorePostingService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    ghinClient.getCoursePostingSeason.mockResolvedValue(null);
  });

  test('postScore normalizes the provider response', async () => {
    ghinClient.postScore.mockResolvedValue({
      score_id: 9988,
      confirmation_required: true,
    });

    const result = await scorePostingService.postScore('hbh', {
      course_id: '22',
      played_at: '2026-03-29',
    }, 'corr-1');

    expect(result).toEqual({
      success: true,
      mode: 'hbh',
      ghinScoreId: '9988',
      confirmationRequired: true,
      correlationId: 'corr-1',
      providerResponse: {
        score_id: 9988,
        confirmation_required: true,
      },
    });
  });

  test('postScore preserves unknown confirmation state when the provider omits the field', async () => {
    ghinClient.postScore.mockResolvedValue({
      score_id: 7788,
    });

    const result = await scorePostingService.postScore('hbh', {
      course_id: '22',
      played_at: '2026-03-29',
    }, 'corr-unknown');

    expect(result.confirmationRequired).toBeNull();
  });

  test('searchScores returns the canonical scores array', async () => {
    ghinClient.searchScores.mockResolvedValue({
      Scores: [{ id: 1 }, { id: 2 }],
      TotalResults: 42,
    });

    const result = await scorePostingService.searchScores({ golfer_id: '123' }, 'corr-2');

    expect(result).toEqual({
      success: true,
      correlationId: 'corr-2',
      scores: [{ id: 1 }, { id: 2 }],
      totalResults: 42,
    });
  });

  test('getScore returns the canonical score object', async () => {
    ghinClient.getScore.mockResolvedValue({
      scores: { id: 99, status: 'accepted' },
    });

    const result = await scorePostingService.getScore('99', 'corr-3');

    expect(result).toEqual({
      success: true,
      correlationId: 'corr-3',
      score: { id: 99, status: 'accepted' },
    });
  });

  test('searchScores rejects unexpected payload shapes', async () => {
    ghinClient.searchScores.mockResolvedValue({ results: [] });

    await expect(scorePostingService.searchScores({}, 'corr-4')).rejects.toMatchObject({
      code: 'INVALID_SCORE_SEARCH_PAYLOAD',
      status: 502,
    });
  });
});