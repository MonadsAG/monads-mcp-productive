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

/**
 * These assert on the real query string rather than on arguments handed to a
 * mocked client: a wrong `filter[...]` key is invisible to a tool-level test,
 * which is exactly how a broken filter shipped here before.
 */
describe('ProductiveAPIClient.listPages hierarchy filters', () => {
  it('sends filter[parent_page_id] for direct children', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ data: [] }));
    const client = makeClient(fetchMock);

    await client.listPages({ parent_page_id: '725358' });

    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toContain('filter%5Bparent_page_id%5D=725358');
  });

  it('sends filter[root_page_id] for a whole document', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ data: [] }));
    const client = makeClient(fetchMock);

    await client.listPages({ root_page_id: '725358', limit: 200, page: 2, sort: 'id' });

    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toContain('filter%5Broot_page_id%5D=725358');
    expect(url).toContain('page%5Bsize%5D=200');
    expect(url).toContain('page%5Bnumber%5D=2');
    expect(url).toContain('sort=id');
  });

  // Without this the collection response carries every page's full body.
  it('sends fields[pages] as a comma-separated sparse fieldset', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ data: [] }));
    const client = makeClient(fetchMock);

    await client.listPages({ root_page_id: '1', fields: ['title', 'parent_page_id'] });

    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toContain('fields%5Bpages%5D=title%2Cparent_page_id');
  });

  it('omits fields[pages] when no fields are asked for', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ data: [] }));
    const client = makeClient(fetchMock);

    await client.listPages({ root_page_id: '1', fields: [] });

    expect(fetchMock.mock.calls[0][0] as string).not.toContain('fields');
  });

  // Not a sparse fieldset: the single-page endpoint ignores fields[pages]
  // (measured -- the full body comes back regardless), so getPage deliberately
  // does not offer one.
  it('asks the single-page endpoint for the sideloads, without a fieldset', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ data: { id: '1', type: 'pages' } }));
    const client = makeClient(fetchMock);

    await client.getPage('725358');

    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toContain('pages/725358?include=creator,project');
    expect(url).not.toContain('fields');
  });

  it('omits both filters when neither is asked for', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ data: [] }));
    const client = makeClient(fetchMock);

    await client.listPages({ project_id: '42' });

    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toContain('filter%5Bproject_id%5D=42');
    expect(url).not.toContain('parent_page_id');
    expect(url).not.toContain('root_page_id');
  });
});
