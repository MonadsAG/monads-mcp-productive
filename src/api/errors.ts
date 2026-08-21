import type { ProductiveError } from './types.js';

/** One JSON:API error object as Productive returns it. */
export type ProductiveErrorDetail = ProductiveError['errors'][number];

/**
 * An error response from the Productive API, carrying the HTTP status.
 *
 * The status is the whole point: without it every failure looks the same to the
 * caller, so a mistyped ID (404) and a broken gateway (502) both surface as
 * "something went wrong at my end". `src/utils/errors.ts` maps the status onto
 * the right MCP error code.
 *
 * Lives in its own module rather than in client.ts so that consumers which only
 * need to recognise the error -- the tool layer, via toMcpError -- do not have
 * to import the whole API client.
 */
export class ProductiveApiError extends Error {
  readonly httpStatus: number;
  readonly errors: ProductiveErrorDetail[];

  constructor(message: string, httpStatus: number, errors: ProductiveErrorDetail[] = []) {
    super(message);
    this.name = 'ProductiveApiError';
    this.httpStatus = httpStatus;
    this.errors = errors;
  }
}

/**
 * Render JSON:API error objects into one human-readable line.
 *
 * This is the message format `makeRequest` has always produced: `detail`
 * preferred over `title`, the failing field appended in parentheses when the API
 * names one, several errors joined with `; `.
 *
 * The one deliberate departure: an error object carrying neither `detail` nor
 * `title` contributes nothing instead of the literal "Unknown error". That way
 * `{"errors":[{"status":"500"}]}` falls through to the caller's
 * `API request failed with status 500`, which at least names the status, rather
 * than replacing it with a string that says less.
 *
 * @param errors - The `errors` array from the response body, possibly empty.
 * @returns The joined message, or an empty string when there is nothing to say.
 */
export function formatProductiveErrors(errors: ProductiveErrorDetail[]): string {
  return errors
    .map((e) => {
      const text = e.detail || e.title;
      if (!text) return '';
      const field = e.source?.pointer ? ` (${e.source.pointer})` : '';
      return `${text}${field}`;
    })
    .filter(Boolean)
    .join('; ');
}
