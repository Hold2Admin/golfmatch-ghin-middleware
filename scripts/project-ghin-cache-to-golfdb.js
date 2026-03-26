/**
 * Bulk-project validated GHIN courses from CacheDB into GolfDB runtime tables.
 *
 * This avoids the per-course callback path by projecting batches of cache rows
 * directly into dbo.GhinRuntimeCourses / dbo.GhinRuntimeTees / dbo.GhinRuntimeHoles.
 *
 * Usage:
 *   node scripts/project-ghin-cache-to-golfdb.js --states=US-NY
 *   node scripts/project-ghin-cache-to-golfdb.js --states=US-NY --batch-size=100
 *   node scripts/project-ghin-cache-to-golfdb.js --states=US-NY --mode=missing --dry-run
 *   node scripts/project-ghin-cache-to-golfdb.js --ids=10210,10820
 */

const crypto = require('crypto');
const sql = require('mssql');
const database = require('../src/services/database');
const { loadSecrets } = require('../src/config/secrets');

function parseArgs(argv) {
  const args = {
    ids: [],
    states: [],
    mode: 'out-of-sync',
    batchSize: 100,
    limit: 0,
    dryRun: false
  };

  for (const raw of argv) {
    if (raw === '--dry-run') {
      args.dryRun = true;
      continue;
    }

    if (!raw.startsWith('--')) {
      args.ids.push(String(raw).trim());
      continue;
    }

    const [flag, value] = raw.split('=');
    if (value == null) continue;

    switch (flag) {
      case '--ids':
        args.ids.push(...value.split(',').map((item) => String(item).trim()).filter(Boolean));
        break;
      case '--states':
        args.states.push(...value.split(',').map(normalizeState).filter(Boolean));
        break;
      case '--mode':
        args.mode = String(value).trim().toLowerCase();
        break;
      case '--batch-size': {
        const parsed = Number(value);
        if (Number.isFinite(parsed) && parsed > 0) {
          args.batchSize = Math.floor(parsed);
        }
        break;
      }
      case '--limit': {
        const parsed = Number(value);
        if (Number.isFinite(parsed) && parsed > 0) {
          args.limit = Math.floor(parsed);
        }
        break;
      }
      default:
        break;
    }
  }

  args.ids = Array.from(new Set(args.ids.map((id) => String(id).trim()).filter(Boolean)));
  args.states = Array.from(new Set(args.states));

  if (!['out-of-sync', 'all', 'missing', 'stale'].includes(args.mode)) {
    throw new Error('Invalid --mode value. Expected one of: out-of-sync, all, missing, stale');
  }

  return args;
}

function normalizeState(rawState) {
  const normalized = String(rawState || '').trim().toUpperCase();
  if (!normalized) {
    return null;
  }

  return normalized.startsWith('US-') ? normalized.slice(3) : normalized;
}

function normalizeMirrorGender(rawGender) {
  const normalized = String(rawGender || '').trim().toUpperCase();
  if (normalized === 'W' || normalized === 'F') return 'F';
  return 'M';
}

function chunk(items, size) {
  const chunks = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

function normalizeText(value) {
  if (value === null || value === undefined) return null;
  const normalized = String(value).trim();
  return normalized.length ? normalized : null;
}

function normalizeNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const normalized = Number(value);
  return Number.isFinite(normalized) ? normalized : null;
}

function normalizeBit(value) {
  if (value === true || value === 1 || value === '1') return 1;
  return 0;
}

function buildGolfRuntimeCanonical(payload) {
  const source = payload || {};
  const teesRaw = Array.isArray(source.tees) ? source.tees : [];

  const ghinCourseId = normalizeText(source.ghinCourseId || source.courseId);
  const courseName = normalizeText(source.courseName || source.name);
  const shortCourseName = normalizeText(source.shortCourseName);
  const facilityId = normalizeText(source.facilityId);
  const facilityName = normalizeText(source.facilityName);
  const city = normalizeText(source.city);
  const state = normalizeText(source.state);
  const country = normalizeText(source.country) || 'USA';
  const sourceLastChangedAt = normalizeText(source.sourceLastChangedAt || source.lastUpdatedUtc);

  if (!ghinCourseId) {
    throw new Error('Missing required field: ghinCourseId');
  }
  if (!courseName) {
    throw new Error(`Course ${ghinCourseId} missing required field: courseName`);
  }
  if (!teesRaw.length) {
    throw new Error(`Course ${ghinCourseId} missing required field: tees[]`);
  }

  const tees = teesRaw.map((tee, teeIndex) => {
    const ghinTeeId = normalizeText(tee.ghinTeeId || tee.teeId);
    const teeName = normalizeText(tee.teeName || tee.name);
    const teeSetSide = normalizeText(tee.teeSetSide);
    const gender = normalizeText(tee.gender);
    const holesRaw = Array.isArray(tee.holes) ? tee.holes : [];

    if (!ghinTeeId) {
      throw new Error(`Course ${ghinCourseId} tees[${teeIndex}] missing ghinTeeId`);
    }
    if (!teeName) {
      throw new Error(`Course ${ghinCourseId} tees[${teeIndex}] missing teeName`);
    }
    if (!holesRaw.length) {
      throw new Error(`Course ${ghinCourseId} tees[${teeIndex}] missing holes[]`);
    }

    const holes = holesRaw.map((hole, holeIndex) => {
      const holeNumber = normalizeNumber(hole.holeNumber);
      const par = normalizeNumber(hole.par);

      if (!holeNumber || !par) {
        throw new Error(`Course ${ghinCourseId} tees[${teeIndex}].holes[${holeIndex}] missing holeNumber/par`);
      }

      return {
        holeNumber,
        par,
        handicap: normalizeNumber(hole.handicap),
        yardage: normalizeNumber(hole.yardage)
      };
    });

    holes.sort((a, b) => a.holeNumber - b.holeNumber);

    return {
      ghinTeeId,
      teeName,
      teeSetSide,
      gender,
      isDefault: normalizeBit(tee.isDefault),
      courseRating18: normalizeNumber(tee.courseRating18),
      slopeRating18: normalizeNumber(tee.slopeRating18),
      par18: normalizeNumber(tee.par18),
      yardage18: normalizeNumber(tee.yardage18),
      courseRatingF9: normalizeNumber(tee.courseRatingF9),
      slopeRatingF9: normalizeNumber(tee.slopeRatingF9),
      parF9: normalizeNumber(tee.parF9),
      yardageF9: normalizeNumber(tee.yardageF9),
      courseRatingB9: normalizeNumber(tee.courseRatingB9),
      slopeRatingB9: normalizeNumber(tee.slopeRatingB9),
      parB9: normalizeNumber(tee.parB9),
      yardageB9: normalizeNumber(tee.yardageB9),
      holes
    };
  });

  tees.sort((a, b) => a.ghinTeeId.localeCompare(b.ghinTeeId));

  return {
    ghinCourseId,
    facilityId,
    facilityName,
    courseName,
    shortCourseName,
    city,
    state,
    country,
    sourceLastChangedAt,
    tees
  };
}

function computeGolfRuntimeHash(payload) {
  const canonical = buildGolfRuntimeCanonical(payload);
  return crypto.createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}

async function getGolfDbPool(secrets) {
  const pool = new sql.ConnectionPool({
    server: secrets.AZURE_SQL_SERVER,
    database: secrets.AZURE_SQL_DATABASE,
    user: secrets.AZURE_SQL_USER,
    password: secrets.AZURE_SQL_PASSWORD,
    options: {
      encrypt: true,
      trustServerCertificate: false,
      enableArithAbort: true
    },
    pool: {
      max: 5,
      min: 0,
      idleTimeoutMillis: 30000
    }
  });

  return pool.connect();
}

async function getCandidateCourseIds(args) {
  const dbSql = database.sql;

  if (args.ids.length) {
    return args.ids;
  }

  const limitClause = args.limit > 0 ? 'TOP (@limit)' : '';
  if (args.states.length) {
    const rows = await database.query(
      `SELECT ${limitClause} courseId
       FROM dbo.GHIN_Courses
       WHERE state IN (SELECT [value] FROM OPENJSON(@statesJson))
       ORDER BY TRY_CONVERT(BIGINT, courseId), courseId`,
      {
        ...(args.limit > 0 ? { limit: { type: dbSql.Int, value: args.limit } } : {}),
        statesJson: { type: dbSql.NVarChar(dbSql.MAX), value: JSON.stringify(args.states) }
      }
    );

    return rows.map((row) => String(row.courseId)).filter(Boolean);
  }

  const rows = await database.query(
    `SELECT ${limitClause} courseId
     FROM dbo.GHIN_Courses
     ORDER BY TRY_CONVERT(BIGINT, courseId), courseId`,
    args.limit > 0 ? { limit: { type: dbSql.Int, value: args.limit } } : {}
  );

  return rows.map((row) => String(row.courseId)).filter(Boolean);
}

async function loadCacheProjectionData(courseIds) {
  if (!courseIds.length) {
    return { coursePayloads: [], teesPayload: [], holesPayload: [], invalidCourses: [] };
  }

  const dbSql = database.sql;
  const params = {
    idsJson: { type: dbSql.NVarChar(dbSql.MAX), value: JSON.stringify(courseIds) }
  };

  const [courseRows, teeRows, holeRows] = await Promise.all([
    database.query(
      `SELECT courseId, courseName, shortCourseName, facilityName, city, state, country, facilityId
       FROM dbo.GHIN_Courses
       WHERE courseId IN (SELECT [value] FROM OPENJSON(@idsJson))`,
      params
    ),
    database.query(
      `SELECT courseId, teeId, teeName, teeSetSide, gender, isDefault,
              courseRating18, slopeRating18, par18, yardage18,
              courseRatingF9, slopeRatingF9, parF9, yardageF9,
              courseRatingB9, slopeRatingB9, parB9, yardageB9
       FROM dbo.GHIN_Tees
       WHERE courseId IN (SELECT [value] FROM OPENJSON(@idsJson))`,
      params
    ),
    database.query(
      `SELECT t.courseId, h.teeId, h.holeNumber, h.par, h.handicap, h.yardage
       FROM dbo.GHIN_Holes h
       INNER JOIN dbo.GHIN_Tees t ON t.teeId = h.teeId
       WHERE t.courseId IN (SELECT [value] FROM OPENJSON(@idsJson))`,
      params
    )
  ]);

  const courseMap = new Map(courseRows.map((row) => [String(row.courseId), {
    ...row,
    courseId: String(row.courseId),
    tees: []
  }]));

  const teesByCourse = new Map();
  for (const tee of teeRows) {
    const courseId = String(tee.courseId);
    const normalized = {
      courseId,
      ghinTeeId: String(tee.teeId),
      teeName: tee.teeName,
      teeSetSide: tee.teeSetSide || 'All18',
      gender: normalizeMirrorGender(tee.gender),
      isDefault: tee.isDefault ? 1 : 0,
      courseRating18: tee.courseRating18,
      slopeRating18: tee.slopeRating18,
      par18: tee.par18,
      yardage18: tee.yardage18,
      courseRatingF9: tee.courseRatingF9,
      slopeRatingF9: tee.slopeRatingF9,
      parF9: tee.parF9,
      yardageF9: tee.yardageF9,
      courseRatingB9: tee.courseRatingB9,
      slopeRatingB9: tee.slopeRatingB9,
      parB9: tee.parB9,
      yardageB9: tee.yardageB9,
      holes: []
    };
    if (!teesByCourse.has(courseId)) {
      teesByCourse.set(courseId, new Map());
    }
    teesByCourse.get(courseId).set(normalized.ghinTeeId, normalized);
  }

  for (const hole of holeRows) {
    const courseId = String(hole.courseId);
    const teeId = String(hole.teeId);
    const tee = teesByCourse.get(courseId)?.get(teeId);
    if (!tee) continue;
    tee.holes.push({
      holeNumber: hole.holeNumber,
      par: hole.par,
      handicap: hole.handicap,
      yardage: hole.yardage
    });
  }

  const coursePayloads = [];
  const teesPayload = [];
  const holesPayload = [];
  const invalidCourses = [];

  for (const courseId of courseIds) {
    const course = courseMap.get(String(courseId));
    if (!course) {
      invalidCourses.push({ courseId: String(courseId), error: 'Course not found in cache' });
      continue;
    }

    const tees = Array.from(teesByCourse.get(String(courseId))?.values() || []);
    tees.forEach((tee) => tee.holes.sort((a, b) => a.holeNumber - b.holeNumber));
    tees.sort((a, b) => a.ghinTeeId.localeCompare(b.ghinTeeId));

    const payload = {
      ghinCourseId: course.courseId,
      facilityId: course.facilityId || null,
      facilityName: course.facilityName || course.courseName || null,
      courseName: course.courseName,
      shortCourseName: course.shortCourseName || null,
      city: course.city || null,
      state: course.state || null,
      country: course.country || 'USA',
      sourceLastChangedAt: null,
      tees
    };

    try {
      payload.payloadHash = computeGolfRuntimeHash(payload);
      coursePayloads.push(payload);

      tees.forEach((tee) => {
        teesPayload.push({
          ghinCourseId: payload.ghinCourseId,
          ghinTeeId: tee.ghinTeeId,
          teeName: tee.teeName,
          teeSetSide: tee.teeSetSide,
          gender: tee.gender,
          isDefault: tee.isDefault,
          courseRating18: tee.courseRating18,
          slopeRating18: tee.slopeRating18,
          par18: tee.par18,
          yardage18: tee.yardage18,
          courseRatingF9: tee.courseRatingF9,
          slopeRatingF9: tee.slopeRatingF9,
          parF9: tee.parF9,
          yardageF9: tee.yardageF9,
          courseRatingB9: tee.courseRatingB9,
          slopeRatingB9: tee.slopeRatingB9,
          parB9: tee.parB9,
          yardageB9: tee.yardageB9
        });

        tee.holes.forEach((hole) => {
          holesPayload.push({
            ghinCourseId: payload.ghinCourseId,
            ghinTeeId: tee.ghinTeeId,
            holeNumber: hole.holeNumber,
            par: hole.par,
            handicap: hole.handicap,
            yardage: hole.yardage
          });
        });
      });
    } catch (error) {
      invalidCourses.push({ courseId: payload.ghinCourseId, error: error.message });
    }
  }

  return { coursePayloads, teesPayload, holesPayload, invalidCourses };
}

async function getGolfPayloadHashes(pool, courseIds) {
  if (!courseIds.length) {
    return new Map();
  }

  const rows = await pool.request()
    .input('idsJson', sql.NVarChar(sql.MAX), JSON.stringify(courseIds))
    .query(`
      SELECT GhinCourseId, PayloadHash
      FROM dbo.GhinRuntimeCourses
      WHERE GhinCourseId IN (SELECT [value] FROM OPENJSON(@idsJson))
    `);

  return new Map(
    (rows.recordset || []).map((row) => [String(row.GhinCourseId), row.PayloadHash ? String(row.PayloadHash) : null])
  );
}

function filterProjectionData(data, targetIds) {
  const targetSet = new Set(Array.from(targetIds).map((id) => String(id)));
  return {
    coursePayloads: data.coursePayloads.filter((course) => targetSet.has(String(course.ghinCourseId))),
    teesPayload: data.teesPayload.filter((tee) => targetSet.has(String(tee.ghinCourseId))),
    holesPayload: data.holesPayload.filter((hole) => targetSet.has(String(hole.ghinCourseId))),
    invalidCourses: data.invalidCourses.filter((course) => targetSet.has(String(course.courseId)))
  };
}

async function applyProjectionBatch(pool, data) {
  if (!data.coursePayloads.length) {
    return;
  }

  const tx = new sql.Transaction(pool);
  await tx.begin();

  try {
    const request = new sql.Request(tx);
    await request
      .input('coursesJson', sql.NVarChar(sql.MAX), JSON.stringify(data.coursePayloads))
      .input('teesJson', sql.NVarChar(sql.MAX), JSON.stringify(data.teesPayload))
      .input('holesJson', sql.NVarChar(sql.MAX), JSON.stringify(data.holesPayload))
      .query(`
        MERGE dbo.GhinRuntimeCourses AS target
        USING (
          SELECT *
          FROM OPENJSON(@coursesJson)
          WITH (
            GhinCourseId VARCHAR(50) '$.ghinCourseId',
            FacilityId VARCHAR(50) '$.facilityId',
            FacilityName NVARCHAR(255) '$.facilityName',
            CourseName NVARCHAR(150) '$.courseName',
            ShortCourseName NVARCHAR(150) '$.shortCourseName',
            City NVARCHAR(100) '$.city',
            [State] NVARCHAR(50) '$.state',
            Country NVARCHAR(50) '$.country',
            PayloadHash CHAR(64) '$.payloadHash',
            SourceLastChangedAt NVARCHAR(50) '$.sourceLastChangedAt'
          )
        ) AS src
          ON target.GhinCourseId = src.GhinCourseId
        WHEN MATCHED THEN
          UPDATE SET
            FacilityId = src.FacilityId,
            FacilityName = src.FacilityName,
            CourseName = src.CourseName,
            ShortCourseName = src.ShortCourseName,
            City = src.City,
            State = src.[State],
            Country = src.Country,
            PayloadHash = src.PayloadHash,
            SourceLastChangedAt = TRY_CONVERT(datetime2, src.SourceLastChangedAt),
            LastSyncedAt = GETUTCDATE(),
            UpdatedAt = GETUTCDATE()
        WHEN NOT MATCHED THEN
          INSERT (GhinCourseId, FacilityId, FacilityName, CourseName, ShortCourseName, City, State, Country, PayloadHash, SourceLastChangedAt, LastSyncedAt, CreatedAt, UpdatedAt)
          VALUES (src.GhinCourseId, src.FacilityId, src.FacilityName, src.CourseName, src.ShortCourseName, src.City, src.[State], src.Country, src.PayloadHash, TRY_CONVERT(datetime2, src.SourceLastChangedAt), GETUTCDATE(), GETUTCDATE(), GETUTCDATE());

        DELETE h
        FROM dbo.GhinRuntimeHoles h
        INNER JOIN dbo.GhinRuntimeTees t ON t.GhinRuntimeTeeId = h.GhinRuntimeTeeId
        WHERE t.GhinCourseId IN (
          SELECT GhinCourseId
          FROM OPENJSON(@coursesJson)
          WITH (GhinCourseId VARCHAR(50) '$.ghinCourseId')
        );

        DELETE FROM dbo.GhinRuntimeTees
        WHERE GhinCourseId IN (
          SELECT GhinCourseId
          FROM OPENJSON(@coursesJson)
          WITH (GhinCourseId VARCHAR(50) '$.ghinCourseId')
        );

        INSERT INTO dbo.GhinRuntimeTees (
          GhinRuntimeCourseId,
          GhinCourseId,
          GhinTeeId,
          TeeName,
          TeeSetSide,
          Gender,
          IsDefault,
          CourseRating18,
          SlopeRating18,
          Par18,
          Yardage18,
          CourseRatingF9,
          SlopeRatingF9,
          ParF9,
          YardageF9,
          CourseRatingB9,
          SlopeRatingB9,
          ParB9,
          YardageB9,
          LastSyncedAt,
          CreatedAt,
          UpdatedAt
        )
        SELECT
          courses.GhinRuntimeCourseId,
          src.GhinCourseId,
          src.GhinTeeId,
          src.TeeName,
          src.TeeSetSide,
          src.Gender,
          src.IsDefault,
          src.CourseRating18,
          src.SlopeRating18,
          src.Par18,
          src.Yardage18,
          src.CourseRatingF9,
          src.SlopeRatingF9,
          src.ParF9,
          src.YardageF9,
          src.CourseRatingB9,
          src.SlopeRatingB9,
          src.ParB9,
          src.YardageB9,
          GETUTCDATE(),
          GETUTCDATE(),
          GETUTCDATE()
        FROM OPENJSON(@teesJson)
        WITH (
          GhinCourseId VARCHAR(50) '$.ghinCourseId',
          GhinTeeId NVARCHAR(64) '$.ghinTeeId',
          TeeName NVARCHAR(255) '$.teeName',
          TeeSetSide NVARCHAR(50) '$.teeSetSide',
          Gender NVARCHAR(50) '$.gender',
          IsDefault BIT '$.isDefault',
          CourseRating18 DECIMAL(6,2) '$.courseRating18',
          SlopeRating18 INT '$.slopeRating18',
          Par18 INT '$.par18',
          Yardage18 INT '$.yardage18',
          CourseRatingF9 DECIMAL(6,2) '$.courseRatingF9',
          SlopeRatingF9 INT '$.slopeRatingF9',
          ParF9 INT '$.parF9',
          YardageF9 INT '$.yardageF9',
          CourseRatingB9 DECIMAL(6,2) '$.courseRatingB9',
          SlopeRatingB9 INT '$.slopeRatingB9',
          ParB9 INT '$.parB9',
          YardageB9 INT '$.yardageB9'
        ) AS src
        INNER JOIN dbo.GhinRuntimeCourses courses
          ON courses.GhinCourseId = src.GhinCourseId;

        INSERT INTO dbo.GhinRuntimeHoles (
          GhinRuntimeTeeId,
          GhinTeeId,
          HoleNumber,
          Par,
          Handicap,
          Yardage,
          LastSyncedAt,
          CreatedAt,
          UpdatedAt
        )
        SELECT
          runtimeTees.GhinRuntimeTeeId,
          src.GhinTeeId,
          src.HoleNumber,
          src.Par,
          src.Handicap,
          src.Yardage,
          GETUTCDATE(),
          GETUTCDATE(),
          GETUTCDATE()
        FROM OPENJSON(@holesJson)
        WITH (
          GhinCourseId VARCHAR(50) '$.ghinCourseId',
          GhinTeeId NVARCHAR(64) '$.ghinTeeId',
          HoleNumber INT '$.holeNumber',
          Par INT '$.par',
          Handicap INT '$.handicap',
          Yardage INT '$.yardage'
        ) AS src
        INNER JOIN dbo.GhinRuntimeTees runtimeTees
          ON runtimeTees.GhinCourseId = src.GhinCourseId
         AND runtimeTees.GhinTeeId = src.GhinTeeId;
      `);

    await tx.commit();
  } catch (error) {
    try {
      await tx.rollback();
    } catch (_) {
      // Ignore rollback errors.
    }
    throw error;
  }
}

async function run() {
  const args = parseArgs(process.argv.slice(2));
  const secrets = await loadSecrets();
  Object.assign(process.env, secrets);

  await database.connect();
  const golfPool = await getGolfDbPool(secrets);

  try {
    const candidateIds = await getCandidateCourseIds(args);
    const summary = {
      mode: args.mode,
      dryRun: args.dryRun,
      batchSize: args.batchSize,
      requested: candidateIds.length,
      scanned: 0,
      missing: 0,
      stale: 0,
      nochange: 0,
      projected: 0,
      failed: 0,
      failures: []
    };

    for (const idsChunk of chunk(candidateIds, args.batchSize)) {
      const cacheData = await loadCacheProjectionData(idsChunk);

      for (const invalid of cacheData.invalidCourses) {
        summary.failed += 1;
        summary.failures.push(invalid);
      }

      summary.scanned += cacheData.coursePayloads.length;
      if (!cacheData.coursePayloads.length) {
        continue;
      }

      const golfHashes = await getGolfPayloadHashes(
        golfPool,
        cacheData.coursePayloads.map((course) => course.ghinCourseId)
      );

      const missingIds = [];
      const staleIds = [];
      const nochangeIds = [];

      for (const course of cacheData.coursePayloads) {
        const golfHash = golfHashes.get(String(course.ghinCourseId));
        if (!golfHashes.has(String(course.ghinCourseId))) {
          missingIds.push(String(course.ghinCourseId));
        } else if (golfHash !== course.payloadHash) {
          staleIds.push(String(course.ghinCourseId));
        } else {
          nochangeIds.push(String(course.ghinCourseId));
        }
      }

      summary.missing += missingIds.length;
      summary.stale += staleIds.length;
      summary.nochange += nochangeIds.length;

      let targetIds = [];
      if (args.mode === 'all') {
        targetIds = cacheData.coursePayloads.map((course) => String(course.ghinCourseId));
      } else if (args.mode === 'missing') {
        targetIds = missingIds;
      } else if (args.mode === 'stale') {
        targetIds = staleIds;
      } else {
        targetIds = [...missingIds, ...staleIds];
      }

      if (!targetIds.length || args.dryRun) {
        continue;
      }

      const targetData = filterProjectionData(cacheData, targetIds);
      try {
        await applyProjectionBatch(golfPool, targetData);
        summary.projected += targetIds.length;
      } catch (batchError) {
        if (targetIds.length === 1) {
          summary.failed += 1;
          summary.failures.push({ courseId: targetIds[0], error: batchError.message });
          continue;
        }

        for (const courseId of targetIds) {
          const singleData = filterProjectionData(cacheData, [courseId]);
          try {
            await applyProjectionBatch(golfPool, singleData);
            summary.projected += 1;
          } catch (singleError) {
            summary.failed += 1;
            summary.failures.push({ courseId, error: singleError.message });
          }
        }
      }
    }

    console.log(JSON.stringify(summary, null, 2));
  } finally {
    await golfPool.close();
    await database.close();
  }
}

run().catch(async (error) => {
  try {
    await database.close();
  } catch (_) {
    // Ignore shutdown errors.
  }
  console.error('Bulk GolfDB projection failed:', error.message);
  process.exit(1);
});