// ============================================================
// Player Data Transformer
// Converts GHIN player format to Fore Play normalized format
// ============================================================

/**
 * Parse GHIN handicap index and convert plus handicaps
 * @param {string|number} raw - Raw handicap index (e.g., "+1.0", "9.4")
 * @returns {number|null} - Numeric index (plus handicaps as negative)
 */
function parseHandicapIndex(raw) {
  if (raw === null || raw === undefined) return null;
  const str = String(raw).trim();
  if (!str) return null;
  const upper = str.toUpperCase();

  if (upper === 'NH' || upper === 'WD') {
    return null;
  }

  const normalized = upper.endsWith('M') ? str.slice(0, -1).trim() : str;
  
  // Handle plus handicap ("+1.0" → -1.0)
  if (normalized.startsWith('+')) {
    const num = parseFloat(normalized.substring(1));
    return Number.isFinite(num) ? -num : null;
  }
  
  // Handle regular handicap
  const num = parseFloat(normalized);
  return Number.isFinite(num) ? num : null;
}

function normalizeHandicapDisplay(rawDisplay, fallbackNumeric, status, flags = {}) {
  const explicit = String(rawDisplay ?? '').trim();
  const upperExplicit = explicit.toUpperCase();
  if (upperExplicit === 'NH' || upperExplicit === 'WD') {
    return upperExplicit;
  }

  if (explicit) {
    if (status === 'modified' && !upperExplicit.endsWith('M')) {
      return `${explicit}M`;
    }
    return explicit;
  }

  if (status === 'withdrawn' || flags.withdrawn) {
    return 'WD';
  }

  if (status === 'no-handicap' || flags.noHandicap) {
    return 'NH';
  }

  if (fallbackNumeric === null || fallbackNumeric === undefined) {
    return null;
  }

  const numericDisplay = fallbackNumeric < 0 ? `+${Math.abs(fallbackNumeric).toFixed(1)}` : fallbackNumeric.toFixed(1);
  return status === 'modified' || flags.modified ? `${numericDisplay}M` : numericDisplay;
}

/**
 * Transform GHIN player to normalized format
 * @param {Object} ghinPlayer - Raw player data from GHIN API
 * @returns {Object} - Normalized player object
 */
function transformGhinPlayer(ghinPlayer) {
  const handicapIndex = parseHandicapIndex(ghinPlayer.handicapIndex);
  const status = ghinPlayer.status || 'active';
  const handicapFlags = ghinPlayer.handicapFlags || {};
  const handicapIndexDisplay = normalizeHandicapDisplay(
    ghinPlayer.handicapIndexDisplay ?? ghinPlayer.hi_display ?? ghinPlayer.handicapIndex,
    handicapIndex,
    status,
    handicapFlags
  );
  
  return {
    // Identity
    ghinNumber: ghinPlayer.ghinNumber,
    firstName: ghinPlayer.firstName,
    lastName: ghinPlayer.lastName,
    email: ghinPlayer.email || null,
    
    // Club & Association
    clubName: ghinPlayer.clubName || null,
    clubId: ghinPlayer.clubId || null,
    associationId: ghinPlayer.associationId || null,
    
    // Handicap Data
    handicapIndex,
    handicapIndexDisplay,
    handicapFlags,
    lowHandicapIndex: ghinPlayer.lowHandicapIndex || null,
    trendIndicator: ghinPlayer.trendIndicator || null,
    lastRevisionDate: ghinPlayer.lastRevisionDate,
    
    // Metadata
    status,
    membershipStatus: ghinPlayer.membershipStatus || null,
    gender: ghinPlayer.gender || null,
    
    // Audit & Sync
    lastSyncedUtc: new Date().toISOString(),
    sourceSystem: 'GHIN',
    version: 1
  };
}

module.exports = {
  transformGhinPlayer,
  parseHandicapIndex
};
