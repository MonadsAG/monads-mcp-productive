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

describe('ProductiveAPIClient board methods', () => {
  it('listBoards calls /folders (not /boards) with filters', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ data: [] }));
    const client = makeClient(fetchMock);

    await client.listBoards({ project_id: '42', status: 1, limit: 10 });

    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toContain('/folders?');
    expect(url).not.toContain('/boards');
    expect(url).toContain('filter%5Bproject_id%5D=42');
    expect(url).toContain('filter%5Bstatus%5D=1');
    expect(url).toContain('page%5Bsize%5D=10');
  });

  it('createBoard POSTs to /folders with type "folders"', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        jsonResponse({ data: { id: '1', type: 'folders', attributes: { name: 'X' } } }, 201),
      );
    const client = makeClient(fetchMock);

    await client.createBoard({
      data: {
        type: 'folders',
        attributes: { name: 'X' },
        relationships: { project: { data: { id: '9', type: 'projects' } } },
      },
    });

    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toContain('/folders');
    expect(url).not.toContain('/boards');
    expect(options.method).toBe('POST');
    expect(JSON.parse(options.body).data.type).toBe('folders');
  });

  it('moveBoard PATCHes /folders/{id}/move with project_id', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    const client = makeClient(fetchMock);

    await client.moveBoard('55', '9');

    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toContain('/folders/55/move');
    expect(options.method).toBe('PATCH');
    expect(JSON.parse(options.body).data.attributes.project_id).toBe('9');
  });

  it('repositionBoard PATCHes /folders/{id}/reposition with move_before_id', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    const client = makeClient(fetchMock);

    await client.repositionBoard('55', '60');

    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toContain('/folders/55/reposition');
    expect(JSON.parse(options.body).data.attributes.move_before_id).toBe('60');
  });

  it('copyBoard POSTs to /folders/copy with name, template_id, project_id', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        jsonResponse({ data: { id: '2', type: 'folders', attributes: { name: 'Copy' } } }, 201),
      );
    const client = makeClient(fetchMock);

    await client.copyBoard({ name: 'Copy', template_id: '1', project_id: '9' });

    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toContain('/folders/copy');
    const body = JSON.parse(options.body);
    expect(body.data.attributes).toEqual({ name: 'Copy', template_id: '1', project_id: '9' });
  });
});
