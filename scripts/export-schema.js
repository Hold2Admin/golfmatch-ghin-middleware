/*
Export Azure SQL schema and stored procedures for the middleware cache DB.
Reads connection credentials from Azure Key Vault (AZURE_SQL_USER/PASSWORD).
Writes outputs to db-schema/ (read-only).
*/
const fs = require('fs');
const path = require('path');
const sql = require('mssql');
const { getSecret } = require('../src/config/secrets');
const { DefaultAzureCredential } = require('@azure/identity');

// No local .env parsing; use Key Vault only.

async function main() {
  // Resolve server/database from environment (non-secret) or known defaults
  const server = process.env.GHIN_CACHE_DB_SERVER || 'golfmatchserver.database.windows.net';
  const database = 'golfdb';
  // Resolve credentials from Key Vault
  const user = await getSecret('AZURE_SQL_USER');
  const password = await getSecret('AZURE_SQL_PASSWORD');

  if (!server || !database || !user || !password) {
    console.error('Missing DB env vars GHIN_CACHE_DB_*; cannot connect.');
    process.exit(1);
  }

  const outDir = path.resolve(__dirname, '..', 'db-schema', 'golfmatch');
  const procDir = path.join(outDir, 'procedures');
  fs.mkdirSync(procDir, { recursive: true });

  // Use SQL auth with Key Vault creds (read-only expected)
  let config = {
    server,
    database,
    options: {
      encrypt: true,
      trustServerCertificate: false,
    },
    pool: { max: 4, min: 0, idleTimeoutMillis: 30000 },
  };

  let pool;
  try {
    config.user = user;
    config.password = password;
    pool = await sql.connect(config);

    const queries = {
      databases: `SELECT name FROM sys.databases ORDER BY name`,
      tables: `SELECT s.name AS schema_name, t.name AS table_name FROM sys.tables t INNER JOIN sys.schemas s ON t.schema_id = s.schema_id ORDER BY s.name, t.name`,
      columns: `SELECT TABLE_SCHEMA, TABLE_NAME, COLUMN_NAME, ORDINAL_POSITION, DATA_TYPE, CHARACTER_MAXIMUM_LENGTH, IS_NULLABLE FROM INFORMATION_SCHEMA.COLUMNS ORDER BY TABLE_SCHEMA, TABLE_NAME, ORDINAL_POSITION`,
      constraints: `SELECT TABLE_SCHEMA, TABLE_NAME, CONSTRAINT_NAME, CONSTRAINT_TYPE FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS ORDER BY TABLE_SCHEMA, TABLE_NAME, CONSTRAINT_NAME`,
      keys: `SELECT tc.TABLE_SCHEMA, tc.TABLE_NAME, tc.CONSTRAINT_NAME, kcu.COLUMN_NAME FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS tc JOIN INFORMATION_SCHEMA.KEY_COLUMN_USAGE kcu ON tc.CONSTRAINT_NAME = kcu.CONSTRAINT_NAME AND tc.TABLE_SCHEMA = kcu.TABLE_SCHEMA AND tc.TABLE_NAME = kcu.TABLE_NAME ORDER BY tc.TABLE_SCHEMA, tc.TABLE_NAME, tc.CONSTRAINT_NAME, kcu.ORDINAL_POSITION`,
      procedures: `SELECT s.name AS schema_name, p.name AS proc_name FROM sys.procedures p INNER JOIN sys.schemas s ON p.schema_id = s.schema_id ORDER BY s.name, p.name`,
    };

    const results = {};
    for (const [key, q] of Object.entries(queries)) {
      results[key] = await pool.request().query(q);
    }

    function writeCsv(file, rows) {
      if (!rows || !rows.recordset) return;
      const rs = rows.recordset;
      const headers = Object.keys(rs[0] || {});
      const lines = [headers.join(',')].concat(
        rs.map((r) => headers.map((h) => String(r[h] ?? '')).join(','))
      );
      fs.writeFileSync(file, lines.join('\n'), 'utf8');
    }

    writeCsv(path.join(outDir, 'databases.csv'), results.databases);
    writeCsv(path.join(outDir, 'tables.csv'), results.tables);
    writeCsv(path.join(outDir, 'columns.csv'), results.columns);
    writeCsv(path.join(outDir, 'constraints.csv'), results.constraints);
    writeCsv(path.join(outDir, 'keys.csv'), results.keys);
    writeCsv(path.join(outDir, 'procedures.csv'), results.procedures);

    // Dump each procedure definition
    for (const row of results.procedures.recordset) {
      const schema = row.schema_name;
      const name = row.proc_name;
      const full = `[${schema}].[${name}]`;
      let def;
      try {
        const r = await pool
          .request()
          .query(`SELECT OBJECT_DEFINITION(OBJECT_ID(N'${full}')) AS [definition]`);
        def = r.recordset[0] && r.recordset[0].definition;
      } catch (e) {
        def = `-- Failed to get definition for ${full}: ${e.message}`;
      }
      const fileSafe = `${schema}.${name}.sql`;
      fs.writeFileSync(path.join(procDir, fileSafe), def || '-- (empty)', 'utf8');
    }

    console.log('Schema export completed to', outDir);
  } catch (err) {
    console.error('Schema export failed:', err.message);
    process.exitCode = 1;
  } finally {
    if (pool) await pool.close();
  }
}

main();
