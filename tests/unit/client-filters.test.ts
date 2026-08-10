import { describe, it, expect, vi, afterEach } from 'vitest';
import { ProductiveAPIClient } from '../../src/api/client.js';
import type { Config } from '../../src/config/index.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

function makeClient(fetchImpl: typeof fetch): ProductiveAPIClient {
  const config = {
    PRODUCTIVE_API_TOKEN: 'token',
    PRODUCTIVE_ORG_ID: 'org',
    // Trailing slash matters: makeRequest() does `${base}${path}` with no
    // separator of its own -- the config layer is what guarantees the slash
    // (see src/config/worker-config.ts's `.replace(/\/?$/, '/')`).
    PRODUCTIVE_API_BASE_URL: 'https://api.productive.io/api/v2/',
  } as unknown as Config;
  const client = new ProductiveAPIClient(config);
  vi.stubGlobal('fetch', fetchImpl);
  return client;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/vnd.api+json' },
  });
}

// Productive's REST API validates filter[...] keys against a fixed allowlist
// per resource and rejects unknown keys with a 422 ("Filter 'x' is not
// supported on this endpoint"). These tests pin the client to the documented
// filter keys (docs/api-spec/resources/*.yaml) instead of the JSON:API
// response *attribute* names that happen to share a resource's vocabulary.
describe('ProductiveAPIClient filter keys', () => {
  it('listPeople sends filter[status] (not filter[is_active]) for is_active:true', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ data: [] }));
    const client = makeClient(fetchMock);

    await client.listPeople({ is_active: true });

    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toContain('filter%5Bstatus%5D=1');
    expect(url).not.toContain('is_active');
  });

  it('listPeople sends filter[status]=2 (not filter[is_active]) for is_active:false', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ data: [] }));
    const client = makeClient(fetchMock);

    await client.listPeople({ is_active: false });

    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toContain('filter%5Bstatus%5D=2');
    expect(url).not.toContain('is_active');
  });

  it('listCompanyBudgets sends filter[budget_status] (not filter[status])', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ data: [] }));
    const client = makeClient(fetchMock);

    await client.listCompanyBudgets({ company_id: '1', status: 1 });

    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toContain('filter%5Bbudget_status%5D=1');
    expect(url).not.toContain('filter%5Bstatus%5D=1');
  });

  it('listProjectDeals sends filter[type] (not filter[budget_type])', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ data: [] }));
    const client = makeClient(fetchMock);

    await client.listProjectDeals({ project_id: '1', budget_type: 2 });

    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toContain('filter%5Btype%5D=2');
    expect(url).not.toContain('budget_type');
  });
});
