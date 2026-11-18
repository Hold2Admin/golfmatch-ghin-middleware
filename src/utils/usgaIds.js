function readId(value, label) {
  if (typeof value !== 'string' && typeof value !== 'number') {
    throw new Error(`${label} must be text or a number, got ${typeof value}`);
  }
  const id = String(value).trim();
  if (id === '') {
    throw new Error(`${label} is required`);
  }
  return id;
}

function readCourseId(value) {
  return readId(value, 'USGA course id');
}

function readGhinTeeId(value) {
  return readId(value, 'GHIN tee id');
}

module.exports = {
  readId,
  readCourseId,
  readGhinTeeId
};
