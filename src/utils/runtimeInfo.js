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

// Read once when the process starts, so /health reports the code that is actually running.
// Reading it per request reported a new deploy's commit while the old process was still serving.
const deploymentInfo = loadDeploymentInfo();

function getRuntimeInfo() {
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