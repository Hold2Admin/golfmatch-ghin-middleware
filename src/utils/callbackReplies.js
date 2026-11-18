'use strict';

/**
 * The one reader for a GolfDB callback reply body. The API callback always answers with JSON, so a successful
 * reply with an empty body or a body that is not JSON is a defect and throws with the real reason.
 */
async function readCallbackReply(response, label) {
  const bodyText = await response.text();
  if (!response.ok) {
    throw new Error(`${label} failed (${response.status}): ${bodyText}`);
  }
  if (bodyText.trim() === '') {
    throw new Error(`${label} returned an empty body (${response.status})`);
  }
  try {
    return JSON.parse(bodyText);
  } catch (parseError) {
    throw new Error(`${label} returned a body that is not JSON (${response.status}): ${parseError.message}`);
  }
}

module.exports = { readCallbackReply };
