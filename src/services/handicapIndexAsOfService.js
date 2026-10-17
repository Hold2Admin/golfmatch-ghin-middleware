// ============================================================
// Handicap Index as of a date
// Under WHS an index only revises after a score posts, and each round records the index the
// golfer played it at (the index in effect that day). So the index in effect on a date is:
//   - the index at play on the golfer's first round played on or after that date, or
//   - the golfer's current index when no round has been played since that date.
// The index at play on the last round BEFORE the date is wrong: that round's own revision
// had not been applied yet when it was played.
// ============================================================

// scorePostingService.searchScores unwraps USGA's raw payload into a flat scores array;
// the raw client response does not carry scores at the top level.
const scorePostingService = require('./scorePostingService');
const usaGhinApiClient = require('./usaGhinApiClient');

const SCORE_PAGE_SIZE = 100;
const SCORE_PAGE_LIMIT = 50;

function hasIndex(score) {
  return score?.handicap_index != null && String(score.handicap_index).trim() !== '';
}

function toHandicapIndex(score) {
  const display = String(score.handicap_index_display ?? '').trim();
  return display.startsWith('+') ? display : score.handicap_index;
}

function todayEtDateString() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());
}

// All rounds with an index played in [from, to]; USGA filters by play date, day-exact.
async function searchRoundsInWindow(ghinNumber, from, to) {
  const rows = [];
  for (let page = 1; page <= SCORE_PAGE_LIMIT; page += 1) {
    const payload = await scorePostingService.searchScores({
      golfer_id: ghinNumber,
      played_at_from: from,
      played_at_to: to,
      page,
      per_page: SCORE_PAGE_SIZE
    });
    const scores = Array.isArray(payload?.scores) ? payload.scores : [];
    rows.push(...scores.filter(hasIndex));
    if (scores.length < SCORE_PAGE_SIZE) break;
  }
  return rows;
}

function scoreOrder(score) {
  const order = Number(score?.order_number);
  return Number.isFinite(order) ? order : Number.POSITIVE_INFINITY;
}

/**
 * Resolve one golfer's Handicap Index in effect on asOfDate (YYYY-MM-DD).
 * @returns {Promise<{ghinNumber, handicapIndex} | {ghinNumber, error}>}
 */
async function resolveHandicapIndexAsOf(ghinNumber, asOfDate) {
  const today = todayEtDateString();
  const [laterRounds, golfer] = await Promise.all([
    asOfDate <= today ? searchRoundsInWindow(ghinNumber, asOfDate, today) : Promise.resolve([]),
    usaGhinApiClient.getGolfer(ghinNumber)
  ]);

  if (laterRounds.length) {
    const firstRound = laterRounds.slice().sort((a, b) => scoreOrder(a) - scoreOrder(b))[0];
    return { ghinNumber, handicapIndex: toHandicapIndex(firstRound) };
  }

  // No round played since the date, so no revision since: the current index is the one in effect.
  const current = golfer?.handicapIndexDisplay ?? golfer?.handicapIndex ?? null;
  if (current == null || String(current).trim() === '') {
    return { ghinNumber, error: 'USGA returned no Handicap Index' };
  }
  return { ghinNumber, handicapIndex: String(current).trim() };
}

module.exports = {
  resolveHandicapIndexAsOf
};
