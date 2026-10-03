import { describe, it, expect, vi, afterEach, beforeEach, type MockInstance } from 'vitest';
import { ProductiveAPIClient } from '../../src/api/client.js';
import { resolveSelfPersonId, withSelfPersonId } from '../../src/auth/self-resolver.js';
import type { Config } from '../../src/config/index.js';

const TOKEN = 'secret-pat-0123456789';

const config: Config = {
  PRODUCTIVE_API_TOKEN: TOKEN,
  PRODUCTIVE_ORG_ID: '43059-monads',
  PRODUCTIVE_API_BASE_URL: 'https://api.productive.io/api/v2/',
};

let stderr: MockInstance<typeof console.error>;
let stdout: MockInstance<typeof process.stdout.write>;

beforeEach(() => {
  stderr = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  stdout = vi.spyOn(process.stdout, 'write');
});

afterEach(() => {
  // Whatever happened, the token must never reach a log line, and nothing may
  // land on stdout -- that is the MCP channel.
  expect(JSON.stringify(stderr.mock.calls)).not.toContain(TOKEN);
  expect(stdout).not.toHaveBeenCalled();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function stubFetch(impl: (url: string, init?: RequestInit) => Promise<Response>) {
  const fetchMock = vi.fn(impl);
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function memberships(...personIds: Array<string | null>): Response {
  const data = personIds.map((id, index) => ({
    id: String(index + 1),
    type: 'organization_memberships',
    relationships: { person: { data: id ? { id, type: 'people' } : null } },
  }));
  return new Response(JSON.stringify({ data }), { status: 200 });
}

function lastWarning(): string {
  return String(stderr.mock.calls.at(-1)?.[0]);
}

describe('resolveSelfPersonId', () => {
  it('takes the person of the single membership, asking with the numeric org ID', async () => {
    const fetchMock = stubFetch(async () => memberships('890553'));

    await expect(resolveSelfPersonId(new ProductiveAPIClient(config))).resolves.toBe('890553');

    const [url, init] = fetchMock.mock.calls[0];
    const query = new URL(url).searchParams;
    expect(new URL(url).pathname).toBe('/api/v2/organization_memberships');
    // The filter rejects the slug: only the integer part may be sent.
    expect(query.get('filter[organization_id]')).toBe('43059');
    // Without include the person relationship is a stub carrying no id.
    expect(query.get('include')).toBe('person');
    expect(init?.headers).toMatchObject({
      'X-Auth-Token': TOKEN,
      'X-Organization-Id': '43059-monads',
    });
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    expect(stderr).not.toHaveBeenCalled();
  });

  it('accepts several memberships as long as they name the same person', async () => {
    stubFetch(async () => memberships('890553', '890553'));

    await expect(resolveSelfPersonId(new ProductiveAPIClient(config))).resolves.toBe('890553');
  });

  it('returns undefined and warns when there is no membership', async () => {
    stubFetch(async () => memberships());

    await expect(resolveSelfPersonId(new ProductiveAPIClient(config))).resolves.toBeUndefined();
    expect(lastWarning()).toContain('no organization membership found');
  });

  it('treats a membership without person linkage as no membership', async () => {
    stubFetch(async () => memberships(null));

    await expect(resolveSelfPersonId(new ProductiveAPIClient(config))).resolves.toBeUndefined();
    expect(lastWarning()).toContain('no organization membership found');
  });

  it('refuses to guess between several people', async () => {
    stubFetch(async () => memberships('1', '2'));

    await expect(resolveSelfPersonId(new ProductiveAPIClient(config))).resolves.toBeUndefined();
    expect(lastWarning()).toContain('2 different people found');
  });

  it('degrades to undefined on HTTP 401', async () => {
    stubFetch(
      async () =>
        new Response(JSON.stringify({ errors: [{ title: 'You are not authenticated' }] }), {
          status: 401,
        }),
    );

    await expect(resolveSelfPersonId(new ProductiveAPIClient(config))).resolves.toBeUndefined();
    expect(lastWarning()).toContain('HTTP 401');
  });

  it('degrades to undefined on a network error', async () => {
    stubFetch(async () => {
      throw new TypeError('fetch failed');
    });

    await expect(resolveSelfPersonId(new ProductiveAPIClient(config))).resolves.toBeUndefined();
    expect(lastWarning()).toContain('fetch failed');
  });

  it('gives up after the timeout', async () => {
    stubFetch(
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(init.signal?.reason));
        }),
    );

    await expect(
      resolveSelfPersonId(new ProductiveAPIClient(config), { timeoutMs: 10 }),
    ).resolves.toBeUndefined();
    expect(lastWarning()).toContain('request timed out');
  });

  it('degrades to undefined on an unexpected response shape', async () => {
    stubFetch(async () => new Response(JSON.stringify({ data: 'nope' }), { status: 200 }));

    await expect(resolveSelfPersonId(new ProductiveAPIClient(config))).resolves.toBeUndefined();
    expect(lastWarning()).toContain('unexpected response shape');
  });
});

describe('withSelfPersonId', () => {
  it('keeps an explicit PRODUCTIVE_USER_ID and makes no API call', async () => {
    const fetchMock = stubFetch(async () => memberships('890553'));
    const explicit = { ...config, PRODUCTIVE_USER_ID: '42' };

    await expect(withSelfPersonId(explicit, new ProductiveAPIClient(explicit))).resolves.toBe(
      explicit,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('fills PRODUCTIVE_USER_ID from the token when it is missing', async () => {
    stubFetch(async () => memberships('890553'));

    const resolved = await withSelfPersonId(config, new ProductiveAPIClient(config));

    expect(resolved).toEqual({ ...config, PRODUCTIVE_USER_ID: '890553' });
    expect(config.PRODUCTIVE_USER_ID).toBeUndefined();
  });
});
