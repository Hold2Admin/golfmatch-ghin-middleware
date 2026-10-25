// Golfer product access status must come only from the golfer's own entry on
// USGA's access list. USGA ignores golfer_id on /users/accesses.json and returns
// every golfer, so a golfer missing from the list has no access.

process.env.GHIN_SANDBOX_EMAIL = 'partner@example.com';
process.env.GHIN_SANDBOX_PASSWORD = 'x';
process.env.GHIN_API_BASE_URL = 'https://usga.test/api/v1';

const client = require('../src/services/usaGhinApiClient');

function jsonResponse(body) {
  return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) };
}

function entry(id, name, status) {
  return { golfer: { id: String(id) }, user_access: { id: `ua${id}`, golfer_name: name, gpa_status: status } };
}

describe('usaGhinApiClient golfer product access', () => {
  let accessCalls;
  beforeEach(() => {
    accessCalls = [];
    global.fetch = jest.fn(async (url) => {
      const u = new URL(String(url));
      if (u.pathname.endsWith('/users/login.json')) {
        return jsonResponse({ token: 't', user: { id: 1 } });
      }
      if (u.pathname.endsWith('/users/accesses.json')) {
        accessCalls.push(u.searchParams.get('page'));
        return jsonResponse({ golfers: [entry(988765, 'Howard Nordin', 'approved'), entry(373538, 'Dan Cichy', 'pending')] });
      }
      throw new Error(`unexpected ${url}`);
    });
  });

  test('a golfer missing from the list is none, never the first golfer on the list', async () => {
    const result = await client.getGolferProductAccessStatus('11030614');
    expect(result).toEqual({ ghinNumber: '11030614', status: 'none', userAccessId: null, golferName: null, hasAccess: false });
  });

  test('a golfer on the list gets his own status', async () => {
    const result = await client.getGolferProductAccessStatus('373538');
    expect(result.status).toBe('pending');
    expect(result.golferName).toBe('Dan Cichy');
    expect(result.hasAccess).toBe(true);
  });

  test('the list stops after a short page (one USGA call)', async () => {
    const list = await client.listGolferProductAccesses();
    expect(list.map((x) => x.ghinNumber)).toEqual(['988765', '373538']);
    expect(accessCalls).toEqual(['1']);
  });
});
