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
  },
  '1718': {
    strategy: 'drop-invalid-tees',
    minimumValidTees: 4,
    note: 'Import SAGE MEADOWS COUNTRY CLUB using the four complete tees while GHIN repairs the invalid tee sets that publish unusable handicap allocations or malformed hole structures.'
  },
  '1768': {
    strategy: 'drop-invalid-tees',
    minimumValidTees: 4,
    note: 'Import RIDGEPOINTE COUNTRY CLUB using the four complete tees while GHIN repairs the invalid tee sets that publish unusable handicap allocations or malformed hole structures.'
  },
  '1819': {
    strategy: 'drop-invalid-tees',
    minimumValidTees: 3,
    note: 'Import First Tee of Central Arkansas - Chairman\'s Course using the three complete tees while GHIN repairs the invalid tee sets that publish unusable handicap allocations or malformed hole structures.'
  },
  '2059': {
    strategy: 'drop-invalid-tees',
    minimumValidTees: 2,
    note: 'Import Elmwood Golf Course - 9 Hole Course using the two complete tees while GHIN repairs the invalid tee sets that publish unusable handicap allocations or malformed hole structures.'
  },
  '24290': {
    strategy: 'drop-invalid-tees',
    minimumValidTees: 4,
    note: 'Import Lake Estes Executive 9 Golf Course using the four complete tees while GHIN repairs the invalid tee sets that publish unusable handicap allocations or malformed hole structures.'
  },
  '7584': {
    strategy: 'drop-invalid-tees',
    minimumValidTees: 8,
    note: 'Import Turnberry Country Club using the eight complete tees while GHIN repairs the invalid tee sets that publish unusable handicap allocations or malformed hole structures.'
  },
  '9945': {
    strategy: 'drop-invalid-tees',
    minimumValidTees: 6,
    note: 'Import BAY MEADOWS FAMILY GC - BLUE COURSE using the six complete tees while GHIN repairs the invalid tee sets that publish unusable handicap allocations or malformed hole structures.'
  },
  '2243': {
    strategy: 'drop-invalid-tees',
    minimumValidTees: 3,
    note: 'Import Frank E. Peters Municipal Golf Course using the three complete tees while GHIN repairs the invalid tee sets that publish unusable handicap allocations or malformed hole structures.'
  },
  '20784': {
    strategy: 'drop-invalid-tees',
    minimumValidTees: 4,
    note: 'Import Railwood Golf Club using the four complete tees while GHIN repairs the invalid tee sets that publish unusable handicap allocations or malformed hole structures.'
  },
  '20750': {
    strategy: 'drop-invalid-tees',
    minimumValidTees: 3,
    note: 'Import Heritage Hills Golf Club using the three complete tees while GHIN repairs the invalid tee sets that publish unusable handicap allocations or malformed hole structures.'
  },
  '24073': {
    strategy: 'drop-invalid-tees',
    minimumValidTees: 6,
    note: 'Import Log Cabin Club using the six complete tees while GHIN repairs the invalid tee sets that publish unusable handicap allocations or malformed hole structures.'
  },
  '5257': {
    strategy: 'drop-invalid-tees',
    minimumValidTees: 2,
    note: 'Import Simpson County Country Club using the two complete tees while GHIN repairs the invalid tee sets that publish unusable handicap allocations or malformed hole structures.'
  },
  '5253': {
    strategy: 'drop-invalid-tees',
    minimumValidTees: 6,
    note: 'Import The Preserve Golf Club using the six complete tees while GHIN repairs the invalid tee sets that publish unusable handicap allocations or malformed hole structures.'
  },
  '5260': {
    strategy: 'drop-invalid-tees',
    minimumValidTees: 3,
    note: 'Import Philadelphia Country Club using the three complete tees while GHIN repairs the invalid tee sets that publish unusable handicap allocations or malformed hole structures.'
  },
  '5289': {
    strategy: 'drop-invalid-tees',
    minimumValidTees: 2,
    note: 'Import Hernando Golf & Racquet Club using the two complete tees while GHIN repairs the invalid tee sets that publish unusable handicap allocations or malformed hole structures.'
  },
  '5278': {
    strategy: 'drop-invalid-tees',
    minimumValidTees: 6,
    note: 'Import MSU Golf Club - MSU Golf Course using the six complete tees while GHIN repairs the invalid tee sets that publish unusable handicap allocations or malformed hole structures.'
  },
  '5208': {
    strategy: 'drop-invalid-tees',
    minimumValidTees: 6,
    note: 'Import Tupelo Country Club using the six complete tees while GHIN repairs the invalid tee sets that publish unusable handicap allocations or malformed hole structures.'
  },
  '5210': {
    strategy: 'drop-invalid-tees',
    minimumValidTees: 6,
    note: 'Import Kirkwood National Golf Club using the six complete tees while GHIN repairs the invalid tee sets that publish unusable handicap allocations or malformed hole structures.'
  },
  '5291': {
    strategy: 'drop-invalid-tees',
    minimumValidTees: 3,
    note: 'Import Country Club of Canton using the three complete tees while GHIN repairs the invalid tee sets that publish unusable handicap allocations or malformed hole structures.'
  },
  '5235': {
    strategy: 'drop-invalid-tees',
    minimumValidTees: 3,
    note: 'Import The Natchez Golf Club at Duncan Park using the three complete tees while GHIN repairs the invalid tee sets that publish unusable handicap allocations or malformed hole structures.'
  },
  '27044': {
    strategy: 'drop-invalid-tees',
    minimumValidTees: 9,
    note: 'Import Country Club of Jackson - Cypress Course using the nine complete tees while GHIN repairs the invalid tee sets that publish unusable handicap allocations or malformed hole structures.'
  },
  '5270': {
    strategy: 'drop-invalid-tees',
    minimumValidTees: 4,
    note: 'Import Clear Creek Golf Club using the four complete tees while GHIN repairs the invalid tee sets that publish unusable handicap allocations or malformed hole structures.'
  },
  '5328': {
    strategy: 'drop-invalid-tees',
    minimumValidTees: 2,
    note: 'Import Eagle Ridge Golf Course using the two complete tees while GHIN repairs the invalid tee sets that publish unusable handicap allocations or malformed hole structures.'
  },
  '360': {
    strategy: 'drop-invalid-tees',
    minimumValidTees: 9,
    note: 'Import Linville GC using the nine complete tees while GHIN repairs the invalid tee sets that publish unusable handicap allocations or malformed hole structures.'
  },
  '13847': {
    strategy: 'drop-invalid-tees',
    minimumValidTees: 1,
    note: 'Import Mound Golf Course using the one complete tee while GHIN repairs the invalid tee sets that publish unusable handicap allocations or malformed hole structures.'
  },
  '7956': {
    strategy: 'drop-invalid-tees',
    minimumValidTees: 4,
    note: 'Import Mohawk Park GC - WOODBINE COURSE using the four complete tees while GHIN repairs the invalid tee sets that publish unusable handicap allocations or malformed hole structures.'
  },
  '8022': {
    strategy: 'drop-invalid-tees',
    minimumValidTees: 3,
    note: 'Import WINDY TRAILS G. C. using the three complete tees while GHIN repairs the invalid tee sets that publish unusable handicap allocations or malformed hole structures.'
  },
  '8033': {
    strategy: 'drop-invalid-tees',
    minimumValidTees: 2,
    note: 'Import CIMARRON COUNTY G. C. using the two complete tees while GHIN repairs the invalid tee sets that publish unusable handicap allocations or malformed hole structures.'
  },
  '7979': {
    strategy: 'drop-invalid-tees',
    minimumValidTees: 2,
    note: 'Import Choctaw Country Club using the two complete tees while GHIN repairs the invalid tee sets that publish unusable handicap allocations or malformed hole structures.'
  },
  '7953': {
    strategy: 'drop-invalid-tees',
    minimumValidTees: 3,
    note: 'Import CIMARRON TRAILS GOLF COURSE using the three complete tees while GHIN repairs the invalid tee sets that publish unusable handicap allocations or malformed hole structures.'
  },
  '7990': {
    strategy: 'drop-invalid-tees',
    minimumValidTees: 4,
    note: 'Import LAKEVIEW GOLF CLUB using the four complete tees while GHIN repairs the invalid tee sets that publish unusable handicap allocations or malformed hole structures.'
  },
  '7882': {
    strategy: 'drop-invalid-tees',
    minimumValidTees: 3,
    note: 'Import Rock Creek On Historic Route 66 using the three complete tees while GHIN repairs the invalid tee sets that publish unusable handicap allocations or malformed hole structures.'
  },
  '8652': {
    strategy: 'drop-invalid-tees',
    minimumValidTees: 16,
    note: 'Import Farmington Country Club - Main Course using the sixteen complete tees while GHIN repairs the invalid tee sets that publish unusable handicap allocations or malformed hole structures.'
  },
  '24303': {
    strategy: 'drop-invalid-tees',
    minimumValidTees: 7,
    note: 'Import Meadows Farms Golf Course - Longest/Waterfall using the seven complete tees while GHIN repairs the invalid tee sets that publish unusable handicap allocations or malformed hole structures.'
  },
  '14637': {
    strategy: 'drop-invalid-tees',
    minimumValidTees: 12,
    note: 'Import Chenequa Country Club using the twelve complete tees while GHIN repairs the invalid tee sets that publish unusable handicap allocations or malformed hole structures.'
  },
  '14523': {
    strategy: 'drop-invalid-tees',
    minimumValidTees: 10,
    note: 'Import TriCity GC - Tri City using the ten complete tees while GHIN repairs the invalid tee sets that publish unusable handicap allocations or malformed hole structures.'
  },
  '1720': {
    strategy: 'front-nine-nine-hole',
    note: 'Import CARROLL COUNTY COUNTRY CLUB as a 9-hole course using front-nine data only while GHIN repairs the broken back-nine handicap allocations.'
  },
  '1730': {
    strategy: 'front-nine-nine-hole',
    note: 'Import Ridgecrest Country Club as a 9-hole course using front-nine data only while GHIN repairs the broken back-nine handicap allocations.'
  },
  '1802': {
    strategy: 'front-nine-nine-hole',
    note: 'Import CROWLEY RIDGE COUNTRY CLUB as a 9-hole course using front-nine data only while GHIN repairs the broken back-nine handicap allocations.'
  },
  '13174': {
    strategy: 'front-nine-nine-hole',
    note: 'Import Palo Verde GC as a 9-hole course using front-nine data only while GHIN repairs the broken back-nine handicap allocations.'
  },
  '1163': {
    strategy: 'front-nine-nine-hole',
    note: 'Import Falcon Valley Golf Course as a 9-hole course using front-nine data only while GHIN repairs the broken back-nine handicap allocations.'
  },
  '1103': {
    strategy: 'front-nine-nine-hole',
    note: 'Import Park Hills Country Club as a 9-hole course using front-nine data only while GHIN repairs the broken back-nine handicap allocations.'
  },
  '36020': {
    strategy: 'front-nine-nine-hole',
    note: 'Import Cheyenne Hills Golf Course as a 9-hole course using front-nine data only while GHIN repairs the broken back-nine handicap allocations.'
  },
  '11732': {
    strategy: 'front-nine-nine-hole',
    note: 'Import Hazard Country Club as a 9-hole course using front-nine data only while GHIN repairs the broken back-nine handicap allocations.'
  },
  '763': {
    strategy: 'front-nine-nine-hole',
    note: 'Import Moose Lake Golf Club as a 9-hole course using front-nine data only while GHIN repairs the broken back-nine handicap allocations.'
  },
  '659': {
    strategy: 'front-nine-nine-hole',
    note: 'Import Castlewood Golf "The Rock" as a 9-hole course using front-nine data only while GHIN repairs the broken back-nine handicap allocations.'
  },
  '20805': {
    strategy: 'front-nine-nine-hole',
    note: 'Import 9 Hole at Margaritaville Lake Resort as a 9-hole course using front-nine data only while GHIN repairs the broken back-nine handicap allocations.'
  },
  '178': {
    strategy: 'front-nine-nine-hole',
    note: 'Import Wakefield Plantation, CC at - Plantation Nine as a 9-hole course using front-nine data only while GHIN repairs the broken back-nine handicap allocations.'
  },
  '8405': {
    strategy: 'front-nine-nine-hole',
    note: 'Import Elkhorn Acres Golf Course as a 9-hole course using front-nine data only while GHIN repairs the broken back-nine handicap allocations.'
  },
  '14174': {
    strategy: 'front-nine-nine-hole',
    note: 'Import Beekman Golf Course - Valley as a 9-hole course using front-nine data only while GHIN repairs the broken back-nine handicap allocations.'
  },
  '14173': {
    strategy: 'front-nine-nine-hole',
    note: 'Import Beekman Golf Course - Highland as a 9-hole course using front-nine data only while GHIN repairs the broken back-nine handicap allocations.'
  },
  '13730': {
    strategy: 'front-nine-nine-hole',
    note: 'Import Spy Ring Golf Club as a 9-hole course using front-nine data only while GHIN repairs the broken back-nine handicap allocations.'
  },
  '23709': {
    strategy: 'front-nine-nine-hole',
    note: 'Import College Hill Golf Course as a 9-hole course using front-nine data only while GHIN repairs the broken back-nine handicap allocations.'
  },
  '30193': {
    strategy: 'front-nine-nine-hole',
    note: 'Import The Ritz-Carlton Golf Club as a 9-hole course using front-nine data only while GHIN repairs the broken back-nine handicap allocations.'
  },
  '3455': {
    strategy: 'front-nine-nine-hole',
    note: 'Import Creekside Plantation as a 9-hole course using front-nine data only while GHIN repairs the broken back-nine handicap allocations.'
  },
  '3417': {
    strategy: 'front-nine-nine-hole',
    note: 'Import McCabe GC - North as a 9-hole course using front-nine data only while GHIN repairs the broken back-nine handicap allocations.'
  },
  '3416': {
    strategy: 'front-nine-nine-hole',
    note: 'Import McCabe GC - South as a 9-hole course using front-nine data only while GHIN repairs the broken back-nine handicap allocations.'
  },
  '14625': {
    strategy: 'front-nine-nine-hole',
    note: 'Import Bay Ridge Golf Course as a 9-hole course using front-nine data only while GHIN repairs the broken back-nine handicap allocations.'
  }
};