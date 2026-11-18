'use strict';

/**
 * The one reply path for every middleware error response: { error: { code, message, ...fields } }.
 * A status outside 400-599, or a missing code or message, is a defect in the caller and throws.
 */
function isHttpErrorStatus(status) {
  return Number.isInteger(status) && status >= 400 && status <= 599;
}

function hasText(value) {
  return typeof value === 'string' && value.trim() !== '';
}

function sendErrorReply(res, status, error) {
  if (!isHttpErrorStatus(status)) {
    throw new Error(`Error reply status must be an HTTP error status (400-599), got ${status}`);
  }
  if (error === null || typeof error !== 'object') {
    throw new Error('Error reply needs an error object');
  }
  if (!hasText(error.code)) {
    throw new Error('Error reply needs an error code');
  }
  if (!hasText(error.message)) {
    throw new Error(`Error reply ${error.code} needs a message`);
  }
  return res.status(status).json({ error });
}

/** The caught error's own message, or the route's message when the error carries none. */
function readCaughtErrorMessage(caught, routeMessage) {
  if (!(caught instanceof Error)) {
    throw new Error(`Caught error reply needs an Error, got ${typeof caught}`);
  }
  return hasText(caught.message) ? caught.message : routeMessage;
}

/**
 * A caught error replies with its own HTTP status, code and message when it carries them (an
 * upstream or request error); what it lacks is the route's own failure: routeFailure gives the
 * route's status, code and message. routeFailure.reportsRetryable adds retryable: true for a 5xx.
 */
function readCaughtErrorReply(caught, routeFailure) {
  const message = readCaughtErrorMessage(caught, routeFailure.message);
  const status = isHttpErrorStatus(caught.status) ? caught.status : routeFailure.status;
  const error = {
    code: hasText(caught.code) ? caught.code : routeFailure.code,
    message
  };
  if (routeFailure.reportsRetryable === true) {
    error.retryable = status >= 500;
  }
  return { status, error };
}

function sendCaughtErrorReply(res, caught, routeFailure) {
  const reply = readCaughtErrorReply(caught, routeFailure);
  return sendErrorReply(res, reply.status, reply.error);
}

module.exports = {
  sendErrorReply,
  readCaughtErrorMessage,
  readCaughtErrorReply,
  sendCaughtErrorReply
};
