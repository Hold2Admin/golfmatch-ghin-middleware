/**
 * Local development settings live in .env.local at the repo root (gitignored, never in the deploy
 * package), e.g. MIDDLEWARE_ALLOWED_ORIGINS=http://localhost:5173 for the laptop's web dev server.
 * Loaded once, first thing in src/index.js, before anything reads process.env. A value already in the
 * environment (App Service app settings) is never overridden. No file means no local settings: nothing
 * is guessed. A file that can't be read throws.
 */
const fs = require('fs');
const path = require('path');

const LOCAL_ENV_PATH = path.join(__dirname, '..', '..', '.env.local');

function loadLocalEnvFile() {
  if (!fs.existsSync(LOCAL_ENV_PATH)) {
    return false;
  }
  process.loadEnvFile(LOCAL_ENV_PATH);
  return true;
}

module.exports = { loadLocalEnvFile, LOCAL_ENV_PATH };
