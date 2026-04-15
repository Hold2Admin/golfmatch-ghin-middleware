module.exports = {
  '2232': {
    strategy: 'drop-invalid-tees',
    minimumValidTees: 3,
    note: 'Import Maine Golf Center Freeport using the three complete men tees while GHIN repairs the two women tees missing back-nine handicap allocations.'
  },
  '2418': {
    strategy: 'drop-invalid-tees',
    minimumValidTees: 8,
    note: 'Import Virginia Country Club using the eight complete tees while GHIN repairs the malformed combo and mixed tees that publish duplicate hole rows.'
  },
  '23737': {
    strategy: 'drop-invalid-tees',
    minimumValidTees: 3,
    note: 'Import Suwannee Country Club using the three complete men tees while GHIN repairs the women Red/Gold tee that publishes no hole rows.'
  },
  '35651': {
    strategy: 'drop-invalid-tees',
    minimumValidTees: 8,
    note: 'Import Yoakum Municipal Golf Course using the eight complete 9-hole tees while GHIN repairs the broken 18-hole combination tees missing back-nine handicap allocations.'
  },
  '4119': {
    strategy: 'drop-invalid-tees',
    minimumValidTees: 11,
    note: 'Import Stonebridge Ranch Country Club - Hills - Course 2/Course 3 using the eleven complete tees while GHIN repairs the malformed women Blue tee that publishes duplicate hole rows.'
  },
  '4716': {
    strategy: 'drop-invalid-tees',
    minimumValidTees: 6,
    note: 'Import Painted Dunes GC - East/North using the six complete tees while GHIN repairs the empty Silver tees.'
  },
  '1350': {
    strategy: 'drop-invalid-tees',
    minimumValidTees: 10,
    note: 'Import Scotland Run Golf Club using the ten complete tees while GHIN repairs the malformed White/Green men tee that publishes duplicate hole rows.'
  },
  '1357': {
    strategy: 'drop-invalid-tees',
    minimumValidTees: 6,
    note: 'Import The Pines At Clermont using the six complete 9-hole tees while GHIN repairs the broken 18-hole companion tees missing back-nine handicap allocations.'
  },
  '3079': {
    strategy: 'drop-invalid-tees',
    minimumValidTees: 3,
    note: 'Import Pine Valley Golf Club using the three complete men tees while GHIN repairs the two women tees with no published hole handicap allocations.'
  },
  '4953': {
    strategy: 'drop-invalid-tees',
    minimumValidTees: 8,
    note: 'Import Concord Country Club using the eight complete tees while GHIN repairs the malformed Orange men tee that publishes conflicting duplicate hole rows.'
  },
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
  '6641': {
    strategy: 'front-nine-nine-hole',
    note: 'Import Rockleigh Golf Course Blue as a 9-hole course using front-nine data only while GHIN repairs the broken back-nine handicap allocations.'
  },
  '6742': {
    strategy: 'front-nine-nine-hole',
    note: 'Import Wallkill Golf Club - Walkill Golf Club as a 9-hole course using front-nine data only while GHIN repairs the broken back-nine handicap allocations.'
  },
  '13367': {
    strategy: 'front-nine-nine-hole',
    note: 'Import Cascades Golf Course as a 9-hole course using front-nine data only while GHIN repairs the broken back-nine handicap allocations.'
  },
  '24275': {
    strategy: 'front-nine-nine-hole',
    note: 'Import Heritage Links as a 9-hole course using front-nine data only while GHIN repairs the broken back-nine handicap allocations.'
  },
  '28274': {
    strategy: 'front-nine-nine-hole',
    note: 'Import Ridgewood Country Club - Cart Course as a 9-hole course using front-nine data only while GHIN repairs the broken back-nine handicap allocations.'
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