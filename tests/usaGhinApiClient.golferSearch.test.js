// Name searches ask USGA for up to 300 golfers at 100 per page. Page 1 comes first; when it is
// full, the other pages are fetched together, and the result stops at the first short page.

process.env.GHIN_SANDBOX_EMAIL = 'partner@example.com';
process.env.GHIN_SANDBOX_PASSWORD = 'x';
process.env.GHIN_API_BASE_URL = 'https://usga.test/api/v1';

const client = require('../src/services/usaGhinApiClient');

function jsonResponse(body) {
  return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) };
}

function golfers(page, count) {
  return Array.from({ length: count }, (_, index) => ({ ghin: String(page * 1000 + index), first_name: 'A', last_name: 'Smith', is_home_club: true }));
}

describe('usaGhinApiClient golfer name search paging', () => {
  let searchPages;
  let inFlight;
  let maxInFlight;
  let pageSizes;

  beforeEach(() => {
    searchPages = [];
    inFlight = 0;
    maxInFlight = 0;
    global.fetch = jest.fn(async (url) => {
      const u = new URL(String(url));
      if (u.pathname.endsWith('/users/login.json')) {
        return jsonResponse({ token: 't', user: { id: 1 } });
      }
      if (u.pathname.endsWith('/golfers/search.json')) {
        const page = Number(u.searchParams.get('page'));
        searchPages.push(page);
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 5));
        inFlight -= 1;
        return jsonResponse({ golfers: golfers(page, pageSizes[page - 1]) });
      }
      throw new Error(`unexpected ${url}`);
    });
  });

  test('a full first page fetches the other pages together and stops at the short page', async () => {
    pageSizes = [100, 40, 0];
    const result = await client.searchGolfers({ lastName: 'Smith%', perPage: 300 });
    expect(result).toHaveLength(140);
    expect(searchPages).toEqual([1, 2, 3]);
    expect(maxInFlight).toBe(2);
  });

  test('a short first page is the only USGA call', async () => {
    pageSizes = [12];
    const result = await client.searchGolfers({ lastName: 'Smith%', perPage: 300 });
    expect(result).toHaveLength(12);
    expect(searchPages).toEqual([1]);
  });

  test('three full pages return 300 golfers', async () => {
    pageSizes = [100, 100, 100];
    const result = await client.searchGolfers({ lastName: 'Smith%', perPage: 300 });
    expect(result).toHaveLength(300);
    expect(searchPages).toEqual([1, 2, 3]);
  });
});
