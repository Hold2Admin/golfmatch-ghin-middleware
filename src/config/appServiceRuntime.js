/**
 * The one check for "running in Azure App Service": WEBSITE_SITE_NAME is set only there
 * (same check as the API's isAppServiceRuntime in api/shared/secretsLoader.js).
 */
function isAppServiceRuntime() {
  const siteName = process.env.WEBSITE_SITE_NAME;
  const isAppService = typeof siteName === 'string' && siteName.trim() !== '';
  return isAppService;
}

module.exports = { isAppServiceRuntime };
