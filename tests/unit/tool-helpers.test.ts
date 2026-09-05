import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';
import { ProductiveApiError } from '../../src/api/errors.js';
import { rethrowToolError, toNumericId } from '../../src/tools/tool-helpers.js';

/** Catch what the helper throws, without asserting on its type up front. */
function thrownBy(call: () => unknown): unknown {
  try {
    call();
  } catch (error) {
    return error;
  }
  throw new Error('expected the call to throw, but it returned');
}

function rethrown(error: unknown): McpError {
  const thrown = thrownBy(() => rethrowToolError(error));
  expect(thrown).toBeInstanceOf(McpError);
  return thrown as McpError;
}

// The booking tools used to build their McpError by hand, which collapsed every
// API failure into InternalError: a mistyped ID read the same as a broken
// gateway, and a rate limit said nothing about the limits. rethrowToolError
// hands everything but the booking-specific messages to toMcpError instead.
describe('rethrowToolError maps API failures onto the right code', () => {
  it('treats a 404 as the caller passing a bad ID', () => {
    const error = rethrown(new ProductiveApiError('Booking not found', 404));

    expect(error.code).toBe(ErrorCode.InvalidParams);
    expect(error.message).toContain('Booking not found');
  });

  it('treats a 422 as the caller passing a bad value', () => {
    const error = rethrown(new ProductiveApiError('Person must exist', 422));

    expect(error.code).toBe(ErrorCode.InvalidParams);
  });

  it('keeps a 401 an internal error -- different arguments will not help', () => {
    expect(rethrown(new ProductiveApiError('Unauthorized', 401)).code).toBe(
      ErrorCode.InternalError,
    );
  });

  it('keeps a 500 an internal error', () => {
    expect(rethrown(new ProductiveApiError('Server error', 500)).code).toBe(
      ErrorCode.InternalError,
    );
  });

  it('spells out the rate limits on a 429', () => {
    const error = rethrown(new ProductiveApiError('Too many requests', 429));

    expect(error.message).toContain('100 requests/10s');
    expect(error.message).toContain('4000/30min');
  });
});

describe('rethrowToolError explains the booking failures worth explaining', () => {
  it('turns a missing allowance into advice', () => {
    const error = rethrown(new Error('Event has no allowance for this person'));

    expect(error.code).toBe(ErrorCode.InvalidParams);
    expect(error.message).toContain('allowance');
    expect(error.message).toContain('admin');
  });

  it('turns an unbookable service period into advice', () => {
    const error = rethrown(new Error('Service unavailable for booking during selected period'));

    expect(error.code).toBe(ErrorCode.InvalidParams);
    expect(error.message).toContain('budget');
  });
});

describe('rethrowToolError leaves already-mapped errors alone', () => {
  it('passes an McpError straight through', () => {
    const original = new McpError(ErrorCode.InvalidParams, 'date_to is before date_from');

    expect(thrownBy(() => rethrowToolError(original))).toBe(original);
  });

  it('keeps the field path from a ZodError', () => {
    const parsed = thrownBy(() => z.object({ limit: z.number().max(200) }).parse({ limit: 500 }));
    const error = rethrown(parsed);

    expect(error.code).toBe(ErrorCode.InvalidParams);
    expect(error.message).toContain('limit');
  });
});

// Number('abc') is NaN and JSON.stringify writes that as null, so a mistyped ID
// used to reach the API as a missing attribute and come back as a confusing 422.
describe('toNumericId', () => {
  it('accepts a digit string', () => {
    expect(toNumericId('42', 'person_id')).toBe(42);
  });

  it('ignores surrounding whitespace', () => {
    expect(toNumericId(' 42 ', 'person_id')).toBe(42);
  });

  it.each(['abc', '', '12a'])('rejects %o and names the field', (value) => {
    const error = thrownBy(() => toNumericId(value, 'person_id'));

    expect(error).toBeInstanceOf(McpError);
    expect((error as McpError).code).toBe(ErrorCode.InvalidParams);
    expect((error as McpError).message).toContain('person_id');
  });
});
