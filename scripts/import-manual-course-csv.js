const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const Papa = require('papaparse');
const { loadSecrets } = require('../src/config/secrets');
const {
  bulkUpsertCoursesToCache,
  syncMirrorForCourse,
  validateCourseForSync
} = require('../src/services/courseSyncService');

const MANUAL_PREFIX = 'MANUAL';
function parseArgs(argv) {
  const options = {
    apply: false,
    file: null,
    course: null,
    slug: null,
    city: null,
    county: null,
    state: null,
    country: null,
    facility: null,
    defaultTee: null
  };

  for (const raw of argv) {
    if (raw === '--apply') {
      options.apply = true;
      continue;
    }

    const [flag, ...valueParts] = raw.split('=');
    const value = valueParts.join('=').trim();
    if (!value) continue;

    switch (flag) {
      case '--file': options.file = value; break;
      case '--course': options.course = value; break;
      case '--slug': options.slug = value; break;
      case '--city': options.city = value; break;
      case '--county': options.county = value; break;
      case '--state': options.state = value.toUpperCase(); break;
      case '--country': options.country = value; break;
      case '--facility': options.facility = value; break;
      case '--default-tee': options.defaultTee = value; break;
      default: throw new Error(`Unknown argument: ${flag}`);
    }
  }

  if (!options.file) throw new Error('--file is required');
  return options;
}

function normalizeHeader(value) {
  return String(value || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function parseCsv(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '');
  const parsed = Papa.parse(raw, { skipEmptyLines: 'greedy' });

  if (parsed.errors.length) {
    const first = parsed.errors[0];
    throw new Error(`CSV parse error on row ${Number(first.row || 0) + 1}: ${first.message}`);
  }
  if (parsed.data.length < 2) throw new Error('CSV must contain a header and at least one data row');

  const rawHeaders = parsed.data[0];
  const headers = rawHeaders.map(normalizeHeader);
  const required = ['COURSE', 'CITY', 'STATE', 'COUNTRY', 'TEE', 'GENDER', 'SLOPE', 'CR', 'PAR', 'HOLE', 'HOLEPAR', 'HOLEINDEX'];

  for (const header of required) {
    if (!headers.includes(header)) throw new Error(`CSV is missing required column: ${header}`);
  }

  return parsed.data.slice(1).map((values, rowIndex) => {
    const row = { _row: rowIndex + 2 };
    headers.forEach((header, columnIndex) => {
      if (header) row[header] = String(values[columnIndex] ?? '').trim();
    });
    return row;
  });
}

function parseNumber(row, field, { integer = false } = {}) {
  const raw = row[field];
  if (raw === '') throw new Error(`Row ${row._row}: ${field} is required`);
  const value = Number(raw);
  if (!Number.isFinite(value) || (integer && !Number.isInteger(value))) {
    throw new Error(`Row ${row._row}: ${field} must be ${integer ? 'an integer' : 'numeric'}`);
  }
  return value;
}

function uniqueValue(rows, field, label) {
  const values = Array.from(new Set(rows.map((row) => row[field])));
  if (values.length !== 1) throw new Error(`${label} must be consistent; found: ${values.join(', ')}`);
  return values[0];
}

function validateTextLength(value, maximum, label) {
  if (String(value || '').length > maximum) {
    throw new Error(`${label} exceeds the ${maximum}-character database limit`);
  }
}

function slugify(value) {
  return String(value || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function normalizeGender(value, rowNumber) {
  const gender = String(value || '').trim().toUpperCase();
  if (gender === 'M') return 'M';
  if (gender === 'F' || gender === 'W') return 'F';
  throw new Error(`Row ${rowNumber}: GENDER must be M, F, or W`);
}

function buildManualId(parts) {
  const full = parts.map(slugify).filter(Boolean).join('-');
  if (full.length <= 50) return full;
  const hash = crypto.createHash('sha256').update(full).digest('hex').slice(0, 8).toUpperCase();
  return `${full.slice(0, 41).replace(/-+$/g, '')}-${hash}`;
}

function validateCompleteSequence(values, minimum, maximum, label) {
  const sorted = Array.from(new Set(values)).sort((left, right) => left - right);
  const expected = Array.from({ length: maximum - minimum + 1 }, (_, index) => minimum + index);
  if (sorted.length !== expected.length || sorted.some((value, index) => value !== expected[index])) {
    throw new Error(`${label} must contain ${minimum}-${maximum} exactly once`);
  }
}

function buildCourse(rows, options) {
  const availableCourses = Array.from(new Set(rows.map((row) => row.COURSE).filter(Boolean)));
  if (!availableCourses.length) throw new Error('CSV contains no course names');

  const selectedCourse = options.course || (availableCourses.length === 1 ? availableCourses[0] : null);
  if (!selectedCourse) throw new Error(`CSV contains multiple courses; specify --course. Found: ${availableCourses.join(', ')}`);

  const selectedRows = rows.filter((row) => row.COURSE === selectedCourse);
  if (!selectedRows.length) throw new Error(`Course not found in CSV: ${selectedCourse}`);

  const csvCity = uniqueValue(selectedRows, 'CITY', `${selectedCourse} city`);
  const csvState = uniqueValue(selectedRows, 'STATE', `${selectedCourse} state`);
  const csvCountry = uniqueValue(selectedRows, 'COUNTRY', `${selectedCourse} country`);
  const state = String(options.state || csvState).trim().toUpperCase();
  const country = String(options.country || csvCountry).trim();
  const baseCity = String(options.city || csvCity).trim();
  if (!baseCity) throw new Error(`${selectedCourse} city is required`);
  if (!state) throw new Error(`${selectedCourse} state is required`);
  if (!country) throw new Error(`${selectedCourse} country is required`);

  const courseSlug = options.slug || selectedCourse;
  const courseId = buildManualId([MANUAL_PREFIX, state, courseSlug]);
  const facilityId = buildManualId([courseId, 'FACILITY']);
  const facilityName = options.facility || selectedCourse;
  const city = [baseCity, options.county].filter(Boolean).join(', ');
  validateTextLength(selectedCourse, 150, `${selectedCourse} course name`);
  validateTextLength(facilityName, 200, `${selectedCourse} facility name`);
  validateTextLength(city, 100, `${selectedCourse} city`);
  validateTextLength(state, 10, `${selectedCourse} state`);
  validateTextLength(country, 10, `${selectedCourse} country`);
  const teeGroups = new Map();
  for (const row of selectedRows) {
    if (!row.TEE) throw new Error(`Row ${row._row}: TEE is required`);
    validateTextLength(row.TEE, 100, `Row ${row._row} tee name`);
    const gender = normalizeGender(row.GENDER, row._row);
    const key = `${row.TEE}\u0000${gender}`;
    if (!teeGroups.has(key)) teeGroups.set(key, { teeName: row.TEE, gender, rows: [] });
    teeGroups.get(key).rows.push(row);
  }
  if (!teeGroups.size) throw new Error(`Course ${selectedCourse} contains no tees`);

  const defaultTee = options.defaultTee || null;
  if (defaultTee && !Array.from(teeGroups.values()).some((group) => group.teeName === defaultTee)) {
    throw new Error(`Default tee not found: ${defaultTee}`);
  }

  const tees = Array.from(teeGroups.values()).map(({ teeName, gender, rows: teeRows }) => {
    const slope = Number(uniqueValue(teeRows, 'SLOPE', `${teeName} slope`));
    const courseRating = Number(uniqueValue(teeRows, 'CR', `${teeName} course rating`));
    const declaredPar = Number(uniqueValue(teeRows, 'PAR', `${teeName} declared par`));

    if (!Number.isInteger(slope) || slope < 55 || slope > 155) {
      throw new Error(`${teeName} slope must be an integer from 55 to 155`);
    }
    if (!Number.isFinite(courseRating) || courseRating <= 0) {
      throw new Error(`${teeName} course rating must be positive`);
    }
    if (!Number.isInteger(declaredPar) || declaredPar <= 0) {
      throw new Error(`${teeName} declared par must be a positive integer`);
    }

    const holes = teeRows.map((row) => ({
      holeNumber: parseNumber(row, 'HOLE', { integer: true }),
      par: parseNumber(row, 'HOLEPAR', { integer: true }),
      handicap: parseNumber(row, 'HOLEINDEX', { integer: true }),
      yardage: 0
    })).sort((left, right) => left.holeNumber - right.holeNumber);

    validateCompleteSequence(holes.map((hole) => hole.holeNumber), 1, 18, `${teeName} holes`);
    validateCompleteSequence(holes.map((hole) => hole.handicap), 1, 18, `${teeName} hole indexes`);

    const computedPar = holes.reduce((sum, hole) => sum + hole.par, 0);
    if (computedPar !== declaredPar) {
      throw new Error(`${teeName} hole pars total ${computedPar}, but declared par is ${declaredPar}`);
    }

    return {
      teeId: buildManualId([courseId, teeName, gender]),
      teeName,
      teeSetSide: 'All18',
      gender,
      isDefault: teeName === defaultTee,
      courseRating,
      slope,
      par: declaredPar,
      yardage: null,
      courseRatingF9: null,
      slopeRatingF9: null,
      parF9: null,
      yardageF9: null,
      courseRatingB9: null,
      slopeRatingB9: null,
      parB9: null,
      yardageB9: null,
      holes
    };
  });

  const course = {
    courseId,
    facilityId,
    facilityName,
    courseName: selectedCourse,
    shortCourseName: selectedCourse,
    city,
    state,
    country,
    lastUpdatedUtc: null,
    tees
  };

  validateCourseForSync(course);
  return course;
}

function buildCourses(rows, options) {
  const courseNames = Array.from(new Set(rows.map((row) => row.COURSE).filter(Boolean)));
  if (!courseNames.length) throw new Error('CSV contains no course names');

  if (options.course) return [buildCourse(rows, options)];
  if (options.slug && courseNames.length > 1) {
    throw new Error('--slug can only be used with --course when the CSV contains multiple courses');
  }

  return courseNames.map((courseName) => buildCourse(rows, {
    ...options,
    course: courseName,
    slug: courseNames.length === 1 ? options.slug : null,
    city: null,
    county: null,
    state: null,
    country: null,
    facility: null,
    defaultTee: null
  }));
}

function summarize(course, filePath, apply) {
  return {
    mode: apply ? 'apply' : 'dry-run',
    file: path.resolve(filePath),
    cacheSource: 'MANUAL',
    courseId: course.courseId,
    courseName: course.courseName,
    facilityId: course.facilityId,
    facilityName: course.facilityName,
    city: course.city,
    state: course.state,
    country: course.country,
    teeCount: course.tees.length,
    holeCount: course.tees.reduce((sum, tee) => sum + tee.holes.length, 0),
    tees: course.tees.map((tee) => ({
      teeId: tee.teeId,
      teeName: tee.teeName,
      gender: tee.gender,
      isDefault: tee.isDefault,
      courseRating18: tee.courseRating,
      slopeRating18: tee.slope,
      par18: tee.par,
      holeCount: tee.holes.length
    }))
  };
}

async function run() {
  const options = parseArgs(process.argv.slice(2));
  const rows = parseCsv(path.resolve(options.file));
  const courses = buildCourses(rows, options);
  const courseSummaries = courses.map((course) => summarize(course, options.file, options.apply));
  const summary = {
    mode: options.apply ? 'apply' : 'dry-run',
    file: path.resolve(options.file),
    cacheSource: 'MANUAL',
    courseCount: courses.length,
    teeCount: courses.reduce((sum, course) => sum + course.tees.length, 0),
    holeCount: courses.reduce(
      (sum, course) => sum + course.tees.reduce((teeSum, tee) => teeSum + tee.holes.length, 0),
      0
    ),
    courses: courseSummaries
  };

  if (!options.apply) {
    console.log(JSON.stringify(summary, null, 2));
    console.log('Validation passed. No database writes were performed.');
    return;
  }

  const secrets = await loadSecrets();
  Object.assign(process.env, secrets);

  const cacheResult = await bulkUpsertCoursesToCache(courses, { cacheSource: 'MANUAL' });
  const mirrorResults = [];
  for (const course of courses) {
    mirrorResults.push({
      courseId: course.courseId,
      result: await syncMirrorForCourse(course)
    });
  }

  console.log(JSON.stringify({ ...summary, cacheResult, mirrorResults }, null, 2));
}

if (require.main === module) {
  run().catch((error) => {
    console.error(`Manual course import failed: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = {
  buildCourse,
  buildCourses,
  buildManualId,
  parseArgs,
  parseCsv,
  summarize
};