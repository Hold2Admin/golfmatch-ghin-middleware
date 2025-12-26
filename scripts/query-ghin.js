/**
 * Query middleware GHIN cache for targeted verification
 * Shows Cedar Ridge tees and key fields
 */

const sql = require('mssql');
const { loadSecrets } = require('../src/config/secrets');

async function run() {
  try {
    const secrets = await loadSecrets();
    const config = {
      server: secrets.AZURE_SQL_SERVER,
      database: secrets.AZURE_SQL_DATABASE,
      user: secrets.AZURE_SQL_USER,
      password: secrets.AZURE_SQL_PASSWORD,
      options: { encrypt: true, enableArithAbort: true }
    };

    const pool = await sql.connect(config);

    const courseId = process.argv[2] || 'GHIN-54321'; // default Cedar Ridge

    const tees = await pool.request().query(`
      SELECT teeId, courseId, teeName, gender, isDefault, courseRating, slope, par, yardage, updatedAt
      FROM GHIN_Tees
      WHERE courseId = '${courseId}'
      ORDER BY gender, teeName;
    `);

    console.log(`${courseId} — GHIN_Tees`);
    console.table(tees.recordset);

    // If Arrowhead, show Championship M tee values
    if (courseId === 'GHIN-65432') {
      const champM = await pool.request().query(`
        SELECT courseRating, slope, par, yardage
        FROM GHIN_Tees WHERE teeId = 'GHIN-TEE-2001';
      `);
      console.log('Arrowhead Championship M current values:');
      console.table(champM.recordset);
    } else if (courseId === 'GHIN-76543') {
      const tournM = await pool.request().query(`
        SELECT courseRating, slope, par, yardage, updatedAt
        FROM GHIN_Tees WHERE teeId = 'GHIN-TEE-3001';
      `);
      console.log('Broadmoor Tournament M current values:');
      console.table(tournM.recordset);
    } else {
      const blueM = await pool.request().query(`
        SELECT courseRating, slope, par, yardage
        FROM GHIN_Tees WHERE teeId = 'GHIN-TEE-1001';
      `);
      console.log('Cedar Ridge Blue M current values:');
      console.table(blueM.recordset);

      const hole1 = await pool.request().query(`
        SELECT holeNumber, par, handicap, yardage
        FROM GHIN_Holes WHERE teeId = 'GHIN-TEE-1001' AND holeNumber = 1;
      `);
      console.log('Cedar Ridge Blue M hole 1:');
      console.table(hole1.recordset);
    }

    await pool.close();
  } catch (err) {
    console.error('Query error:', err.message);
    process.exit(1);
  }
}

run();
