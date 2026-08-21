import { describe, it, expect, vi, afterEach } from 'vitest';
import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';
import { ProductiveAPIClient } from '../../src/api/client.js';
import { ProductiveApiError } from '../../src/api/errors.js';
import { toMcpError } from '../../src/utils/errors.js';
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

function errorResponse(status: number, errors: unknown[]): Response {
  return new Response(JSON.stringify({ errors }), {
    status,
    headers: { 'Content-Type': 'application/vnd.api+json' },
  });
}

/** Catch what the client throws, without asserting on its type up front. */
async function thrownBy(call: () => Promise<unknown>): Promise<unknown> {
  try {
    await call();
    throw new Error('expected the call to reject, but it resolved');
  } catch (error) {
    return error;
  }
}

// The client used to throw a plain Error and drop response.status on the floor,
// so a mistyped ID (404) and a broken gateway (502) reached the caller looking
// identical. These tests pin the status to the thrown error and the mapping from
// status to MCP error code.
describe('ProductiveApiError from the API client', () => {
  it('carries the HTTP status and the JSON:API error details', async () => {
    const client = makeClient(
      vi
        .fn()
        .mockResolvedValue(
          errorResponse(422, [
            { status: '422', title: 'Invalid Attribute', detail: 'Company must exist' },
          ]),
        ),
    );

    const error = await thrownBy(() => client.getTask('1'));

    expect(error).toBeInstanceOf(ProductiveApiError);
    expect((error as ProductiveApiError).httpStatus).toBe(422);
    expect((error as ProductiveApiError).errors).toHaveLength(1);
  });

  it('keeps the source.pointer suffix in the message', async () => {
    const client = makeClient(
      vi.fn().mockResolvedValue(
        errorResponse(422, [
          {
            title: 'Invalid Attribute',
            detail: 'Company must exist',
            source: { pointer: 'data/attributes/company' },
          },
        ]),
      ),
    );

    const error = await thrownBy(() => client.getTask('1'));

    expect((error as Error).message).toBe('Company must exist (data/attributes/company)');
  });

  it('joins several errors the way it always has', async () => {
    const client = makeClient(
      vi
        .fn()
        .mockResolvedValue(
          errorResponse(422, [{ detail: 'first is wrong' }, { detail: 'second is wrong' }]),
        ),
    );

    const error = await thrownBy(() => client.getTask('1'));

    expect((error as Error).message).toBe('first is wrong; second is wrong');
  });

  it('falls back to title when the API sends no detail', async () => {
    const client = makeClient(
      vi.fn().mockResolvedValue(errorResponse(404, [{ title: 'Record Not Found' }])),
    );

    const error = await thrownBy(() => client.getTask('1'));

    expect((error as Error).message).toBe('Record Not Found');
  });

  // The old makeRequest called response.json() unguarded, so a proxy answering
  // 502 with an HTML page surfaced a JSON SyntaxError and the real failure was
  // never reported.
  it('reports the status when the error body is not JSON', async () => {
    const client = makeClient(
      vi.fn().mockResolvedValue(new Response('<html>Bad Gateway</html>', { status: 502 })),
    );

    const error = await thrownBy(() => client.getTask('1'));

    expect(error).toBeInstanceOf(ProductiveApiError);
    expect((error as ProductiveApiError).httpStatus).toBe(502);
    expect((error as Error).message).toBe('API request failed with status 502');
    expect((error as Error).message).not.toMatch(/JSON|Unexpected token/i);
  });

  // makeVoidRequest used to read only errors[0].detail, losing the title and the
  // pointer -- on exactly the pin/archive/reject paths where 409 lives.
  it('gives void requests the same message as regular ones', async () => {
    const client = makeClient(
      vi.fn().mockResolvedValue(
        errorResponse(409, [
          {
            title: 'Conflict',
            source: { pointer: 'data/attributes/pinned' },
          },
        ]),
      ),
    );

    const error = await thrownBy(() => client.pinComment('1'));

    expect((error as ProductiveApiError).httpStatus).toBe(409);
    expect((error as Error).message).toBe('Conflict (data/attributes/pinned)');
  });
});

describe('toMcpError', () => {
  it.each([
    [400, 'an unsupported query parameter'],
    [404, 'a missing record'],
    [409, 'a conflicting state'],
    [422, 'a rejected attribute'],
  ])('maps %i (%s) to InvalidParams', (status) => {
    const mapped = toMcpError(new ProductiveApiError('nope', status));

    expect(mapped.code).toBe(ErrorCode.InvalidParams);
    expect(mapped.message).toContain('nope');
  });

  it.each([401, 403, 500, 502, 503])('leaves %i as InternalError', (status) => {
    expect(toMcpError(new ProductiveApiError('nope', status)).code).toBe(ErrorCode.InternalError);
  });

  it('explains the rate limit on 429 instead of retrying blindly', () => {
    const mapped = toMcpError(new ProductiveApiError('Rate limit reached', 429));

    expect(mapped.code).toBe(ErrorCode.InternalError);
    expect(mapped.message).toContain('100 requests/10s');
  });

  it('passes an McpError through without re-wrapping it', () => {
    const original = new McpError(ErrorCode.MethodNotFound, 'Unknown tool: nope');

    expect(toMcpError(original)).toBe(original);
  });

  it('keeps the field path when Zod rejects one of several arguments', async () => {
    const { z } = await import('zod');
    const schema = z.object({ limit: z.number().max(200) });

    let zodError: unknown;
    try {
      schema.parse({ limit: 500 });
    } catch (error) {
      zodError = error;
    }

    const mapped = toMcpError(zodError);

    expect(mapped.code).toBe(ErrorCode.InvalidParams);
    expect(mapped.message).toContain('limit:');
  });

  it('falls back to InternalError for anything that is not an Error', () => {
    const mapped = toMcpError('just a string');

    expect(mapped.code).toBe(ErrorCode.InternalError);
    expect(mapped.message).toContain('Unknown error occurred');
  });
});
