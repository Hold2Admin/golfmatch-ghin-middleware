// ============================================================
// Player Data Transformer
// Converts GHIN player format to Fore Play normalized format
// ============================================================

/**
 * Parse GHIN handicap index and convert plus handicaps
 * @param {string|number} raw - Raw handicap index (e.g., "+1.0", "9.4")
 * @returns {number} - Numeric index (plus handicaps as negative)
 */
function parseHandicapIndex(raw) {
  const str = String(raw).trim();
  
  // Handle plus handicap ("+1.0" → -1.0)
  if (str.startsWith('+')) {
    const num = parseFloat(str.substring(1));
    return isNaN(num) ? 0 : -num;
  }
  
  // Handle regular handicap
  const num = parseFloat(str);
  return isNaN(num) ? 0 : num;
}

/**
 * Transform GHIN player to normalized format
 * @param {Object} ghinPlayer - Raw player data from GHIN API
 * @returns {Object} - Normalized player object
 */
function transformGhinPlayer(ghinPlayer) {
  const handicapIndex = parseHandicapIndex(ghinPlayer.handicapIndex);
  const handicapIndexDisplay = String(ghinPlayer.handicapIndex).trim();
  
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
    lowHandicapIndex: ghinPlayer.lowHandicapIndex || null,
    trendIndicator: ghinPlayer.trendIndicator || null,
    lastRevisionDate: ghinPlayer.lastRevisionDate,
    
    // Metadata
    status: ghinPlayer.status || 'active',
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
