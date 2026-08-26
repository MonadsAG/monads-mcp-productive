/**
 * Small helpers shared by the resource-management tools, kept in one place so
 * absence, booking and capacity tools behave identically.
 */
import { z } from 'zod';
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import type { ProductiveAPIClient } from '../api/client.js';

export type ToolResult = { content: Array<{ type: string; text: string }> };

/** Some MCP clients send booleans as strings; accept both. */
export const coerceBoolean = z.preprocess(
  (v) => (v === 'true' ? true : v === 'false' ? false : v),
  z.boolean(),
);

/** Resolve the "me" shorthand against the configured user. */
export function resolvePersonId(value: string, config?: { PRODUCTIVE_USER_ID?: string }): string {
  if (value !== 'me') return value;
  if (!config?.PRODUCTIVE_USER_ID) {
    throw new McpError(
      ErrorCode.InvalidParams,
      'Cannot use "me" - PRODUCTIVE_USER_ID is not configured in this deployment. Pass an explicit person_id.',
    );
  }
  return config.PRODUCTIVE_USER_ID;
}

/**
 * Best-effort display name for a person.
 *
 * Used in confirmation previews so a mistyped ID is visible before anything is
 * written. Falls back to the bare ID rather than failing the whole call.
 */
export async function describePerson(
  client: ProductiveAPIClient,
  personId: string,
): Promise<string> {
  try {
    const person = await client.getPerson(personId);
    const first = person.data.attributes.first_name ?? '';
    const last = person.data.attributes.last_name ?? '';
    const name = `${first} ${last}`.trim();
    return name ? `${name} (ID ${personId})` : `ID ${personId}`;
  } catch {
    return `ID ${personId}`;
  }
}

/** Translate the API failures worth explaining; rethrow everything else as-is. */
export function translateBookingError(message: string): McpError | null {
  if (/has no allowance for this person/i.test(message)) {
    return new McpError(
      ErrorCode.InvalidParams,
      'This absence type has a limited allowance and none is set up for this person. ' +
        'Someone with admin rights has to grant the allowance in Productive first, or pick an absence type that is not capped.',
    );
  }

  if (/unavailable for booking during selected period/i.test(message)) {
    return new McpError(
      ErrorCode.InvalidParams,
      'That service cannot take this person for the selected period. Its budget usually has to run over the whole booking period and the person has to be a member of it. ' +
        'Pick a service whose budget covers these dates, or shorten the period.',
    );
  }

  if (/data\/attributes\/person/i.test(message)) {
    return new McpError(
      ErrorCode.InvalidParams,
      'Productive rejected the person for this booking. The person may be deactivated, or the ID may not exist.',
    );
  }

  return null;
}

/** Normalise anything thrown inside a tool into an McpError. */
export function rethrowToolError(error: unknown): never {
  if (error instanceof McpError) throw error;

  if (error instanceof z.ZodError) {
    // Name the offending field: Zod's bare "Required" leaves the caller guessing
    // which parameter it meant when several are missing.
    const details = error.errors
      .map((e) => (e.path.length > 0 ? `${e.path.join('.')}: ${e.message}` : e.message))
      .join(', ');
    throw new McpError(ErrorCode.InvalidParams, `Invalid parameters: ${details}`);
  }

  const message = error instanceof Error ? error.message : 'Unknown error occurred';
  const translated = translateBookingError(message);
  if (translated) throw translated;

  throw new McpError(ErrorCode.InternalError, message);
}
