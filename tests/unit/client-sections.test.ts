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

const SECTION = { data: { id: '7', type: 'sections', attributes: { name: 'Discovery' } } };

function call(fetchMock: ReturnType<typeof vi.fn>): { url: string; init: RequestInit } {
  const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit | undefined];
  return { url, init: init ?? {} };
}

describe('ProductiveAPIClient section methods', () => {
  it('listSections filters by deal and sideloads the deal for a client-side check', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ data: [] }));
    await makeClient(fetchMock).listSections('123', 2);

    const { url } = call(fetchMock);
    expect(url).toContain('/sections?');
    expect(url).toContain('filter%5Bdeal_id%5D=123');
    expect(url).toContain('include=deal');
    expect(url).toContain('page%5Bsize%5D=200');
    expect(url).toContain('page%5Bnumber%5D=2');
  });

  it('listServicesInSection filters services by section and sideloads the section', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ data: [] }));
    await makeClient(fetchMock).listServicesInSection('7', 3, false);

    const { url } = call(fetchMock);
    expect(url).toContain('/services?');
    expect(url).toContain('filter%5Bsection_id%5D=7');
    expect(url).toContain('include=section');
    expect(url).toContain('page%5Bsize%5D=200');
    expect(url).toContain('page%5Bnumber%5D=3');
    expect(url).not.toContain('projectless_budgets');
  });

  it('adds filter[projectless_budgets]=true when asked, for both service lookups', async () => {
    const inSection = vi.fn().mockResolvedValue(jsonResponse({ data: [] }));
    await makeClient(inSection).listServicesInSection('7', 1, true);
    expect(call(inSection).url).toContain('filter%5Bprojectless_budgets%5D=true');

    const byDeal = vi.fn().mockResolvedValue(jsonResponse({ data: [] }));
    await makeClient(byDeal).listDealServices({ deal_id: '123', projectless_budgets: true });
    expect(call(byDeal).url).toContain('filter%5Bprojectless_budgets%5D=true');
  });

  it('getSection sideloads the deal', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(SECTION));
    await makeClient(fetchMock).getSection('7');

    expect(call(fetchMock).url).toMatch(/\/sections\/7\?include=deal$/);
  });

  it('createSection POSTs the budget as a flat numeric deal_id attribute', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(SECTION, 201));
    await makeClient(fetchMock).createSection({
      data: { type: 'sections', attributes: { name: 'Discovery', deal_id: 123 } },
    });

    const { url, init } = call(fetchMock);
    expect(url).toMatch(/\/sections$/);
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({
      data: { type: 'sections', attributes: { name: 'Discovery', deal_id: 123 } },
    });
  });

  it('updateSection PATCHes the name', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(SECTION));
    await makeClient(fetchMock).updateSection('7', {
      data: { type: 'sections', id: '7', attributes: { name: 'Operations' } },
    });

    const { url, init } = call(fetchMock);
    expect(url).toMatch(/\/sections\/7$/);
    expect(init.method).toBe('PATCH');
    expect(JSON.parse(init.body as string).data.attributes).toEqual({ name: 'Operations' });
  });

  it('deleteSection sends DELETE to the section', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    await makeClient(fetchMock).deleteSection('7');

    const { url, init } = call(fetchMock);
    expect(url).toMatch(/\/sections\/7$/);
    expect(init.method).toBe('DELETE');
  });

  it('getServiceWithSection sideloads the section', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        jsonResponse({ data: { id: '9', type: 'services', attributes: { name: 'S' } } }),
      );
    await makeClient(fetchMock).getServiceWithSection('9');

    expect(call(fetchMock).url).toMatch(/\/services\/9\?include=section$/);
  });

  it('listDealServices adds include only when asked', async () => {
    const withInclude = vi.fn().mockResolvedValue(jsonResponse({ data: [] }));
    await makeClient(withInclude).listDealServices({
      deal_id: '123',
      include: 'section',
      limit: 200,
      page: 2,
    });
    const url = call(withInclude).url;
    expect(url).toContain('filter%5Bdeal_id%5D=123');
    expect(url).toContain('include=section');
    expect(url).toContain('page%5Bnumber%5D=2');

    const without = vi.fn().mockResolvedValue(jsonResponse({ data: [] }));
    await makeClient(without).listDealServices({ deal_id: '123' });
    expect(call(without).url).not.toContain('include=');
  });
});
