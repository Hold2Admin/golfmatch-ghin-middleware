const packageJson = require('../../package.json');

function getRuntimeInfo() {
  return {
    appVersion: packageJson.version,
    deploymentVersion: process.env.APP_DEPLOYMENT_VERSION || packageJson.version,
    commitSha: process.env.APP_DEPLOYMENT_SHA || null,
    runId: process.env.APP_DEPLOYMENT_RUN_ID || null,
    runAttempt: process.env.APP_DEPLOYMENT_RUN_ATTEMPT || null,
    deployedAtUtc: process.env.APP_DEPLOYED_AT_UTC || null,
    packageBlobName: process.env.APP_PACKAGE_BLOB_NAME || null
  };
}

module.exports = {
  getRuntimeInfo
};