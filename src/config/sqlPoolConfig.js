/**
 * One source of truth for mssql pool sizing in the middleware.
 * min > 0 keeps warm connections so a quiet gap never forces a cold Azure SQL login;
 * idleTimeoutMillis only closes connections above min.
 */
const SQL_POOL_MAIN = Object.freeze({ max: 10, min: 4, idleTimeoutMillis: 300000 });

module.exports = { SQL_POOL_MAIN };
