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
    deploymentVersion: deploymentInfo.deploymentVersion || packageJson.version,
    commitSha: deploymentInfo.commitSha || null,
    runId: deploymentInfo.runId || null,
    runAttempt: deploymentInfo.runAttempt || null,
    deployedAtUtc: deploymentInfo.deployedAtUtc || null,
    packageBlobName: deploymentInfo.packageBlobName || null
  };
}

module.exports = {
  getRuntimeInfo
};