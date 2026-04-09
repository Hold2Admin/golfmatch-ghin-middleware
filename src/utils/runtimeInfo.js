const fs = require('fs');
const path = require('path');
const packageJson = require('../../package.json');

const deploymentInfoPath = path.resolve(__dirname, '../../deployment-info.json');

function loadDeploymentInfo() {
  try {
    return JSON.parse(fs.readFileSync(deploymentInfoPath, 'utf8'));
  } catch {
    return {};
  }
}

function getRuntimeInfo() {
  const deploymentInfo = loadDeploymentInfo();

  return {
    appVersion: packageJson.version,
    deploymentVersion: process.env.APP_DEPLOYMENT_VERSION || deploymentInfo.deploymentVersion || packageJson.version,
    commitSha: process.env.APP_DEPLOYMENT_SHA || deploymentInfo.commitSha || null,
    runId: process.env.APP_DEPLOYMENT_RUN_ID || deploymentInfo.runId || null,
    runAttempt: process.env.APP_DEPLOYMENT_RUN_ATTEMPT || deploymentInfo.runAttempt || null,
    deployedAtUtc: process.env.APP_DEPLOYED_AT_UTC || deploymentInfo.deployedAtUtc || null,
    packageBlobName: process.env.APP_PACKAGE_BLOB_NAME || deploymentInfo.packageBlobName || null
  };
}

module.exports = {
  getRuntimeInfo
};