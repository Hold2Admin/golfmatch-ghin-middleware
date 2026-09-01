const { buildCourse, buildCourses, buildManualId } = require('../scripts/import-manual-course-csv');

function buildRows() {
  return Array.from({ length: 18 }, (_, index) => ({
    _row: index + 2,
    COURSE: 'Example Links',
    TEE: 'Gold',
    GENDER: 'M',
    SLOPE: '139',
    CR: '71.0',
    PAR: '72',
    HOLE: String(index + 1),
    HOLEPAR: '4',
    HOLEINDEX: String(index + 1)
  }));
}

test('builds a validated manual course without inventing yardage or a default tee', () => {
  const course = buildCourse(buildRows(), {
    course: null,
    slug: 'EXAMPLE',
    city: 'Example City',
    county: 'Example County',
    state: 'IR',
    country: 'Ireland',
    facility: null,
    defaultTee: null
  });

  expect(course.courseId).toBe('MANUAL-IR-EXAMPLE');
  expect(course.city).toBe('Example City, Example County');
  expect(course.tees).toHaveLength(1);
  expect(course.tees[0]).toMatchObject({
    teeId: 'MANUAL-IR-EXAMPLE-GOLD-M',
    gender: 'M',
    isDefault: false,
    courseRating: 71,
    slope: 139,
    par: 72,
    yardage: null
  });
  expect(course.tees[0].holes.every((hole) => hole.yardage === 0)).toBe(true);
});

test('keeps generated manual identities within database limits', () => {
  const id = buildManualId(['MANUAL', 'IR', 'A very long course name that exceeds the database identity limit by a lot']);
  expect(id).toHaveLength(50);
  expect(id.startsWith('MANUAL-IR-')).toBe(true);
});

test('normalizes W tee rows to the runtime F gender', () => {
  const rows = buildRows().map((row) => ({ ...row, GENDER: 'W' }));
  const course = buildCourse(rows, {
    course: null,
    slug: 'EXAMPLE',
    city: 'Example City',
    county: null,
    state: 'IR',
    country: 'Ireland',
    facility: null,
    defaultTee: null
  });

  expect(course.tees[0].gender).toBe('F');
  expect(course.tees[0].teeId).toBe('MANUAL-IR-EXAMPLE-GOLD-F');
});

test('builds every course and location dynamically from one file', () => {
  const firstCourse = buildRows().map((row) => ({
    ...row,
    CITY: 'First Town, First County',
    STATE: 'AA',
    COUNTRY: 'Country A'
  }));
  const secondCourse = buildRows().map((row) => ({
    ...row,
    COURSE: 'Second Links',
    CITY: 'Second Town, Second County',
    STATE: 'BB',
    COUNTRY: 'Country B'
  }));

  const courses = buildCourses([...firstCourse, ...secondCourse], {
    course: null,
    slug: null,
    city: null,
    county: null,
    state: null,
    country: null,
    facility: null,
    defaultTee: null
  });

  expect(courses).toHaveLength(2);
  expect(courses[0]).toMatchObject({
    courseId: 'MANUAL-AA-EXAMPLE-LINKS',
    city: 'First Town, First County',
    state: 'AA',
    country: 'Country A'
  });
  expect(courses[1]).toMatchObject({
    courseId: 'MANUAL-BB-SECOND-LINKS',
    city: 'Second Town, Second County',
    state: 'BB',
    country: 'Country B'
  });
});