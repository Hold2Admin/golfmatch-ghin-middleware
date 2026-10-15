// ============================================================
// Handicap Index as of a date
// Under WHS an index only revises when a score posts, so the index at play on the golfer's
// latest posted round on or before the date is the index in effect on that date.
// ============================================================

// scorePostingService.searchScores unwraps USGA's raw payload into a flat scores array;
// the raw client response does not carry scores at the top level.
const scorePostingService = require('./scorePostingService');

const SCORE_PAGE_SIZE = 100;
const SCORE_PAGE_LIMIT = 50;
const HISTORY_START_DATE = '2000-01-01';

function hasIndex(score) {
  return score?.handicap_index != null && String(score.handicap_index).trim() !== '';
}

function toHandicapIndex(score) {
  const display = String(score.handicap_index_display ?? '').trim();
  return display.startsWith('+') ? display : score.handicap_index;
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

/**
 * Resolve one golfer's Handicap Index in effect on asOfDate (YYYY-MM-DD).
 * USGA reports played_at to the month, so find the latest month, then narrow to the exact
 * latest play day inside it with day-exact date filters (binary search, about 5 lookups).
 * @returns {Promise<{ghinNumber, handicapIndex} | {ghinNumber, error}>}
 */
async function resolveHandicapIndexAsOf(ghinNumber, asOfDate) {
  const rounds = await searchRoundsInWindow(ghinNumber, HISTORY_START_DATE, asOfDate);
  if (!rounds.length) return { ghinNumber, error: 'No posted round on or before that date' };

  const latestMonth = rounds
    .map((round) => String(round.played_at ?? '').slice(0, 7))
    .filter((month) => /^\d{4}-\d{2}$/.test(month))
    .sort()
    .pop();
  if (!latestMonth) return { ghinNumber, error: 'USGA returned rounds without a played date' };

  const [year, month] = latestMonth.split('-').map(Number);
  const monthEndDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const dayString = (day) => `${latestMonth}-${String(day).padStart(2, '0')}`;
  let lo = 1;
  let hi = asOfDate.slice(0, 7) === latestMonth ? Number(asOfDate.slice(8, 10)) : monthEndDay;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if ((await searchRoundsInWindow(ghinNumber, dayString(mid), dayString(hi))).length) lo = mid;
    else hi = mid - 1;
  }

  const dayRounds = await searchRoundsInWindow(ghinNumber, dayString(lo), dayString(lo));
  if (!dayRounds.length) return { ghinNumber, error: 'Could not resolve the exact play date from USGA' };
  return { ghinNumber, handicapIndex: toHandicapIndex(dayRounds[0]) };
}

module.exports = {
  resolveHandicapIndexAsOf
};
