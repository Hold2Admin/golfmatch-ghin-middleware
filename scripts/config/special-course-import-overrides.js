module.exports = {
  '14176': {
    strategy: 'drop-invalid-tees',
    minimumValidTees: 1,
    note: 'Import valid tees for Beekman Golf Course - Taconic while GHIN repairs the empty Junior tee and incomplete women tees.'
  },
  '6861': {
    strategy: 'drop-invalid-tees',
    minimumValidTees: 1,
    note: 'Import Mosholu using the six complete men tees while GHIN repairs the three women tees that have no handicap allocations.'
  },
  '24067': {
    strategy: 'drop-invalid-tees',
    minimumValidTees: 1,
    note: 'Import Bittercreek using the seven complete tees while GHIN repairs the malformed Red men tee record.'
  },
  '13723': {
    strategy: 'front-nine-nine-hole',
    note: 'Import Spring Lake Sandpiper as a 9-hole course and normalize the malformed 2025 tees to their valid front-nine data.'
  },
  '15005': {
    strategy: 'front-nine-nine-hole',
    note: 'Import Sunken Meadow Red as a 9-hole course using front-nine data only; rotating 18-hole combinations already exist as separate GHIN course IDs.'
  },
  '15006': {
    strategy: 'front-nine-nine-hole',
    note: 'Import Sunken Meadow Blue as a 9-hole course using front-nine data only; rotating 18-hole combinations already exist as separate GHIN course IDs.'
  },
  '15007': {
    strategy: 'front-nine-nine-hole',
    note: 'Import Sunken Meadow Green as a 9-hole course using front-nine data only; rotating 18-hole combinations already exist as separate GHIN course IDs.'
  },
  '6576': {
    strategy: 'compose-nine-hole-combo',
    frontCourseId: '15006',
    backCourseId: '15007',
    backNineHandicapOffset: 1,
    note: 'Compose Sunken Meadow Blue/Green from the healthy Blue and Green single-nine records while GHIN repairs the published Blue/Green hole handicaps.'
  }
};