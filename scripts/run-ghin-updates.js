/**
 * Run targeted updates against GHIN mock database to simulate data changes
 */

const fs = require('fs');
const sql = require('mssql');
const { loadSecrets } = require('../src/config/secrets');

async function runUpdates() {
  try {
    console.log('🔐 Loading secrets from Key Vault...');
    const secrets = await loadSecrets();

    const config = {
      server: secrets.AZURE_SQL_SERVER,
      database: secrets.AZURE_SQL_DATABASE,
      user: secrets.AZURE_SQL_USER,
      password: secrets.AZURE_SQL_PASSWORD,
      options: { encrypt: true, enableArithAbort: true }
    };

    console.log(`📡 Connecting to ${config.server}/${config.database}...`);
    const pool = await sql.connect(config);
    console.log('✅ Connected');

    const scriptPath = 'db-schema/ghin-mock/004_update_all_courses.sql';
    console.log(`📄 Executing updates: ${scriptPath}`);
    const sqlContent = fs.readFileSync(scriptPath, 'utf8');

    // Execute entire file as a single batch (supports multiple statements)
    await pool.request().batch(sqlContent);
    console.log('✅ Executed updates batch');

    console.log('📊 Sampling updated values...');
    const rows = await pool.request().query(`
      SELECT TOP 6 t.teeId, t.courseId, t.teeName, t.gender, t.courseRating, t.slope, t.yardage
      FROM GHIN_Tees t
      ORDER BY t.courseId, t.teeId;
    `);
    console.table(rows.recordset);

    await pool.close();
    console.log('✅ Updates complete. Re-run GolfMatch sync to pull changes.');
  } catch (err) {
    console.error('💥 Fatal error:', err.message);
    process.exit(1);
  }
}

runUpdates();
