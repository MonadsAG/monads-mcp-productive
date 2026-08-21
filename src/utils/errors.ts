import { z } from 'zod';
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import { ProductiveApiError } from '../api/errors.js';

/**
 * HTTP statuses that mean the caller's argument was wrong, rather than the
 * server or the credentials being at fault.
 *
 * - 400 the query parameter is not supported (an unknown filter, sort, include)
 * - 404 the ID given does not exist
 * - 409 the request conflicts with current state -- a comment that is already
 *   pinned, a time entry already rejected. `docs/api-spec/` documents 409 on 22
 *   operations, four of which we call (pin/unpin comment, reject/unreject time
 *   entry); treating those as InternalError told the model to give up when the
 *   honest answer was "already done, move on".
 * - 422 the value was well-formed but rejected (a locked timesheet period, an
 *   attribute the resource does not accept). By far the most common: the spec
 *   documents it on 203 operations, and it is also what the live API really
 *   answers for an unsupported filter, whichever status the guides claim.
 *
 * Deliberately excluded: 401 and 403 are a token or permission problem, 406 and
 * 415 come from headers this client sends, and 429 and 5xx are transient or
 * server-side. None of those are fixed by passing different arguments.
 *
 * Matched on the numeric status only, never on the JSON:API `code` field -- that
 * field appears in neither the spec nor the guides, and its 422 values change on
 * 2026-09-15 (`invalid_attribute` -> `invalid_attribute_value`, announced by
 * email only). Reading the status keeps us out of that entirely.
 */
const CALLER_FAULT_STATUSES = new Set([400, 404, 409, 422]);

/**
 * Convert any thrown value into an McpError with an accurate code.
 *
 * JSON-RPC offers two useful codes here: InvalidParams (-32602) means "you gave
 * me a bad argument, fixing it is on you", InternalError (-32603) means
 * "something failed at my end, retrying or changing your argument will not
 * help". Collapsing everything into the latter -- which is what every tool did
 * before -- tells the caller nothing.
 *
 * @param error - The caught value.
 * @returns The McpError to throw.
 */
export function toMcpError(error: unknown): McpError {
  // Already mapped by the tool itself (a hand-written validation message, the
  // toolset gate). Do not re-wrap and lose the code it chose.
  if (error instanceof McpError) {
    return error;
  }

  if (error instanceof z.ZodError) {
    // Keep the field path Zod gives us ("limit: Number must be <= 200"): without
    // it, a caller passing several arguments cannot tell which one was rejected.
    const details = error.errors.map((e) =>
      e.path.length > 0 ? `${e.path.join('.')}: ${e.message}` : e.message,
    );
    return new McpError(ErrorCode.InvalidParams, `Invalid parameters: ${details.join(', ')}`);
  }

  if (error instanceof ProductiveApiError) {
    if (CALLER_FAULT_STATUSES.has(error.httpStatus)) {
      return new McpError(ErrorCode.InvalidParams, error.message);
    }

    if (error.httpStatus === 429) {
      // Productive publishes no Retry-After and no X-RateLimit-* headers, so
      // there is nothing to retry against automatically -- say what the limits
      // are instead. See docs/api-spec/guides/rate-limits.md.
      return new McpError(
        ErrorCode.InternalError,
        `${error.message} -- Productive rate limit reached (100 requests/10s, 4000/30min; ` +
          'reports 10/30s). Wait before retrying.',
      );
    }
  }

  return new McpError(
    ErrorCode.InternalError,
    error instanceof Error ? error.message : 'Unknown error occurred',
  );
}
