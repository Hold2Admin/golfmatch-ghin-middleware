#!/usr/bin/env node
/**
 * GHIN Mock DB Helper
 * Reusable CLI to insert/update courses, tees, and holes in the middleware mock database.
 * Uses Key Vault secrets via src/config/secrets.
 *
 * Commands:
 *  - add-course --file <path>
 *  - update-tee --teeId <id> [--courseRating <n>] [--slope <n>] [--par <n>] [--yardage <n>] [--no-bumpCourse]
 *  - update-hole --teeId <id> --hole <1-18> [--par <n>] [--handicap <n>] [--yardage <n>] [--no-bumpCourse]
 *  - bump-course --courseId <id>
 *  - show-course --courseId <id>
 */

const fs = require('fs');
const path = require('path');
const sql = require('mssql');
const { loadSecrets } = require('../src/config/secrets');

function parseArgs(argv) {
  const args = {};
  const rest = argv.slice(2);
  args.command = rest.shift();
  while (rest.length) {
    const key = rest.shift();
    if (!key.startsWith('--')) continue;
    const name = key.replace(/^--/, '');
    const next = rest[0];
    if (!next || next.startsWith('--')) {
      args[name] = true; // boolean flag
    } else {
      args[name] = rest.shift();
    }
  }
  return args;
}

async function getPool() {
  const secrets = await loadSecrets();
  const config = {
    server: secrets.AZURE_SQL_SERVER,
    database: secrets.AZURE_SQL_DATABASE,
    user: secrets.AZURE_SQL_USER,
    password: secrets.AZURE_SQL_PASSWORD,
    options: { encrypt: true, enableArithAbort: true }
  };
  const pool = await sql.connect(config);
  return pool;
}

async function addCourse(filePath) {
  const pool = await getPool();
  const full = path.resolve(filePath);
  if (!fs.existsSync(full)) throw new Error(`File not found: ${full}`);
  const json = JSON.parse(fs.readFileSync(full, 'utf8'));

  const { courseId, courseName, city, state, country = 'USA', facilityId, tees = [] } = json;
  if (!courseId || !courseName || !city || !state) throw new Error('Missing required course fields');

  await pool.request()
    .input('courseId', sql.VarChar, courseId)
    .input('courseName', sql.NVarChar, courseName)
    .input('city', sql.NVarChar, city)
    .input('state', sql.VarChar, state)
    .input('country', sql.VarChar, country)
    .input('facilityId', sql.VarChar, facilityId || null)
    .query(`INSERT INTO GHIN_Courses (courseId, courseName, city, state, country, facilityId)
            VALUES (@courseId, @courseName, @city, @state, @country, @facilityId)`);

  for (const t of tees) {
    await pool.request()
      .input('teeId', sql.VarChar, t.teeId)
      .input('courseId', sql.VarChar, courseId)
      .input('teeName', sql.NVarChar, t.teeName)
      .input('gender', sql.VarChar, (t.gender || '').toUpperCase())
      .input('isDefault', sql.Bit, t.isDefault ? 1 : 0)
      .input('courseRating', sql.Decimal(4,1), t.courseRating)
      .input('slope', sql.Int, t.slope)
      .input('par', sql.Int, t.par)
      .input('yardage', sql.Int, t.yardage)
      .query(`INSERT INTO GHIN_Tees (teeId, courseId, teeName, gender, isDefault, courseRating, slope, par, yardage)
              VALUES (@teeId, @courseId, @teeName, @gender, @isDefault, @courseRating, @slope, @par, @yardage)`);

    for (const h of (t.holes || [])) {
      await pool.request()
        .input('teeId', sql.VarChar, t.teeId)
        .input('holeNumber', sql.Int, h.holeNumber)
        .input('par', sql.Int, h.par)
        .input('handicap', sql.Int, h.handicap)
        .input('yardage', sql.Int, h.yardage)
        .query(`INSERT INTO GHIN_Holes (teeId, holeNumber, par, handicap, yardage)
                VALUES (@teeId, @holeNumber, @par, @handicap, @yardage)`);
    }
  }

  console.log(`✅ Added course ${courseId} with ${tees.length} tees`);
  await pool.close();
}

async function updateTee({ teeId, courseRating, slope, par, yardage, bumpCourse = true }) {
  if (!teeId) throw new Error('--teeId is required');
  const fields = [];
  if (courseRating != null) fields.push(['courseRating', Number(courseRating)]);
  if (slope != null) fields.push(['slope', Number(slope)]);
  if (par != null) fields.push(['par', Number(par)]);
  if (yardage != null) fields.push(['yardage', Number(yardage)]);
  if (!fields.length) throw new Error('Provide at least one field to update (courseRating, slope, par, yardage)');

  const pool = await getPool();
  const setClauses = fields.map(([k]) => `${k} = @${k}`).join(', ');
  const req = pool.request().input('teeId', sql.VarChar, teeId);
  for (const [k, v] of fields) req.input(k, typeof v === 'number' ? sql.Decimal(4,1) : sql.NVarChar, v);

  await req.query(`UPDATE GHIN_Tees SET ${setClauses}, updatedAt = GETUTCDATE() WHERE teeId = @teeId`);

  if (bumpCourse) {
    await pool.request()
      .input('teeId', sql.VarChar, teeId)
      .query(`UPDATE c SET c.updatedAt = GETUTCDATE()
              FROM GHIN_Courses c
              JOIN GHIN_Tees t ON c.courseId = t.courseId
              WHERE t.teeId = @teeId`);
  }

  console.log(`✅ Updated tee ${teeId} (${fields.map(([k,v])=>`${k}=${v}`).join(', ')})`);
  await pool.close();
}

async function updateHole({ teeId, holeNumber, par, handicap, yardage, bumpCourse = true }) {
  if (!teeId) throw new Error('--teeId is required');
  if (!holeNumber) throw new Error('--hole is required');
  const fields = [];
  if (par != null) fields.push(['par', Number(par)]);
  if (handicap != null) fields.push(['handicap', Number(handicap)]);
  if (yardage != null) fields.push(['yardage', Number(yardage)]);
  if (!fields.length) throw new Error('Provide at least one field to update (par, handicap, yardage)');

  const pool = await getPool();
  const setClauses = fields.map(([k]) => `${k} = @${k}`).join(', ');
  const req = pool.request()
    .input('teeId', sql.VarChar, teeId)
    .input('holeNumber', sql.Int, Number(holeNumber));
  for (const [k, v] of fields) req.input(k, sql.Int, v);

  await req.query(`UPDATE GHIN_Holes SET ${setClauses} WHERE teeId = @teeId AND holeNumber = @holeNumber`);
  await pool.request().input('teeId', sql.VarChar, teeId).query(`UPDATE GHIN_Tees SET updatedAt = GETUTCDATE() WHERE teeId = @teeId`);

  if (bumpCourse) {
    await pool.request()
      .input('teeId', sql.VarChar, teeId)
      .query(`UPDATE c SET c.updatedAt = GETUTCDATE()
              FROM GHIN_Courses c
              JOIN GHIN_Tees t ON c.courseId = t.courseId
              WHERE t.teeId = @teeId`);
  }

  console.log(`✅ Updated hole ${holeNumber} on tee ${teeId} (${fields.map(([k,v])=>`${k}=${v}`).join(', ')})`);
  await pool.close();
}

async function bumpCourseTimestamp(courseId) {
  if (!courseId) throw new Error('--courseId is required');
  const pool = await getPool();
  await pool.request().input('courseId', sql.VarChar, courseId).query(`UPDATE GHIN_Courses SET updatedAt = GETUTCDATE() WHERE courseId = @courseId`);
  console.log(`✅ Bumped course updatedAt for ${courseId}`);
  await pool.close();
}

async function showCourse(courseId) {
  if (!courseId) throw new Error('--courseId is required');
  const pool = await getPool();
  const tees = await pool.request().input('courseId', sql.VarChar, courseId).query(`
    SELECT teeId, courseId, teeName, gender, isDefault, courseRating, slope, par, yardage, updatedAt
    FROM GHIN_Tees WHERE courseId = @courseId ORDER BY gender, teeName
  `);
  console.table(tees.recordset);
  await pool.close();
}

(async () => {
  try {
    const args = parseArgs(process.argv);
    switch (args.command) {
      case 'add-course':
        await addCourse(args.file);
        break;
      case 'update-tee':
        await updateTee({ teeId: args.teeId, courseRating: args.courseRating, slope: args.slope, par: args.par, yardage: args.yardage, bumpCourse: args['no-bumpCourse'] ? false : true });
        break;
      case 'update-hole':
        await updateHole({ teeId: args.teeId, holeNumber: args.hole, par: args.par, handicap: args.handicap, yardage: args.yardage, bumpCourse: args['no-bumpCourse'] ? false : true });
        break;
      case 'bump-course':
        await bumpCourseTimestamp(args.courseId);
        break;
      case 'show-course':
        await showCourse(args.courseId);
        break;
      default:
        console.log('Usage:\n  node scripts/mockdb-helper.js add-course --file ./JSON/course-template.json\n  node scripts/mockdb-helper.js update-tee --teeId GHIN-TEE-3001 --courseRating 76.3\n  node scripts/mockdb-helper.js update-hole --teeId GHIN-TEE-1001 --hole 1 --yardage 392\n  node scripts/mockdb-helper.js bump-course --courseId GHIN-76543\n  node scripts/mockdb-helper.js show-course --courseId GHIN-76543');
    }
  } catch (err) {
    console.error('💥 Error:', err.message);
    process.exit(1);
  } finally {
    try { await sql.close(); } catch {}
  }
})();
