/**
 * Execute GHIN mock database SQL scripts
 * Loads secrets from Key Vault and runs schema/seed files
 */

const fs = require('fs');
const sql = require('mssql');
const { loadSecrets } = require('../src/config/secrets');

async function runScripts() {
  console.log('Starting GHIN mock database setup...\n');
  
  try {
    // Load secrets from Key Vault
    console.log('🔐 Loading secrets from Key Vault...');
    const secrets = await loadSecrets();
    console.log('✅ Secrets loaded\n');
    
    const config = {
      server: secrets.AZURE_SQL_SERVER,
      database: secrets.AZURE_SQL_DATABASE,
      user: secrets.AZURE_SQL_USER,
      password: secrets.AZURE_SQL_PASSWORD,
      options: {
        encrypt: true,
        trustServerCertificate: false,
        enableArithAbort: true,
        connectTimeout: 30000
      }
    };

    console.log(`📡 Connecting to ${config.server}/${config.database}...`);
    const pool = await sql.connect(config);
    console.log('✅ Connected\n');
    
    const scripts = [
      'db-schema/ghin-mock/001_create_ghin_tables.sql',
      'db-schema/ghin-mock/002_seed_ghin_data.sql',
      'db-schema/ghin-mock/003_seed_ca_courses.sql',
      'db-schema/ghin-mock/005_seed_red_rocks.sql'
    ];

    for (const scriptPath of scripts) {
      console.log(`📄 Executing: ${scriptPath}`);
      const sqlContent = fs.readFileSync(scriptPath, 'utf8');
      
      // Split by GO statements (must be on its own line)
      const batches = sqlContent
        .split(/\r?\n\s*GO\s*\r?\n/i)
        .map(b => b.trim())
        .filter(b => b.length > 10); // Filter out tiny fragments
      
      let executed = 0;
      for (const batch of batches) {
        if (!batch) continue;
        
        try {
          await pool.request().query(batch);
          executed++;
          if (executed % 10 === 0) process.stdout.write('.');
        } catch (err) {
          console.error(`\n   ❌ Error in batch ${executed + 1}:`, err.message);
          console.error('   SQL:', batch.substring(0, 300));
          throw err;
        }
      }
      console.log(`\n   ✅ Executed (${executed} batches)`);
    }

    console.log('\n🎉 All scripts executed successfully!');
    console.log('\n📊 Verifying data...');
    
    const courseCount = await pool.request().query('SELECT COUNT(*) as count FROM GHIN_Courses');
    const teeCount = await pool.request().query('SELECT COUNT(*) as count FROM GHIN_Tees');
    const holeCount = await pool.request().query('SELECT COUNT(*) as count FROM GHIN_Holes');
    
    console.log(`   Courses: ${courseCount.recordset[0].count}`);
    console.log(`   Tees: ${teeCount.recordset[0].count}`);
    console.log(`   Holes: ${holeCount.recordset[0].count}`);
    
    await pool.close();
    console.log('\n✅ Setup complete! Set GHIN_USE_DATABASE=true to enable database mode.');
    
  } catch (error) {
    console.error('\n💥 Fatal error:', error.message);
    process.exit(1);
  }
}

runScripts();
