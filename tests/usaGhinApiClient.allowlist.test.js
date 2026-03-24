// Unit tests for the outbound allowlist gate in usaGhinApiClient.
// Validates that only approved USGA API paths can be called.

const { isAllowlisted } = require('../src/services/usaGhinApiClient');

describe('usaGhinApiClient — outbound allowlist gate', () => {
  describe('allowlisted calls', () => {
    test('POST /users/login.json', () => {
      expect(isAllowlisted('POST', '/users/login.json')).toBe(true);
    });
    test('GET /golfers/search.json', () => {
      expect(isAllowlisted('GET', '/golfers/search.json')).toBe(true);
    });
    test('GET /golfers/search.json with query string stripped', () => {
      expect(isAllowlisted('GET', '/golfers/search.json?golfer_id=1234567&per_page=1')).toBe(true);
    });
    test('GET /golfers/{id}.json', () => {
      expect(isAllowlisted('GET', '/golfers/1234567.json')).toBe(true);
    });
    test('GET /courses/search.json', () => {
      expect(isAllowlisted('GET', '/courses/search.json')).toBe(true);
    });
    test('POST /scores.json', () => {
      expect(isAllowlisted('POST', '/scores.json')).toBe(true);
    });
  });

  describe('blocked calls', () => {
    test('GET /admin/users.json — not in approved endpoint surface', () => {
      expect(isAllowlisted('GET', '/admin/users.json')).toBe(false);
    });
    test('DELETE /golfers/1234567.json — method not approved', () => {
      expect(isAllowlisted('DELETE', '/golfers/1234567.json')).toBe(false);
    });
    test('POST /golfers/search.json — method not approved for this path', () => {
      expect(isAllowlisted('POST', '/golfers/search.json')).toBe(false);
    });
    test('GET /internal/config.json — not in approved endpoint surface', () => {
      expect(isAllowlisted('GET', '/internal/config.json')).toBe(false);
    });
  });
});
