import { z } from 'zod';
import type { ProductiveAPIClient } from '../api/client.js';
import { ProductiveApiError } from '../api/errors.js';
import type { Config } from '../config/index.js';

const DEFAULT_TIMEOUT_MS = 5000;

const MembershipsSchema = z.object({
  data: z.array(
    z.object({
      relationships: z
        .object({
          person: z.object({ data: z.object({ id: z.string().min(1) }).nullish() }).optional(),
        })
        .optional(),
    }),
  ),
});

/** stderr only: stdout is the MCP channel. Never pass the token or headers in here. */
function warn(reason: string): void {
  console.error(
    `Could not determine the Productive person ID from the API token (${reason}). ` +
      'Starting without "me" context -- set PRODUCTIVE_USER_ID to enable it.',
  );
}

function describeFailure(error: unknown): string {
  if (error instanceof ProductiveApiError) return `HTTP ${error.httpStatus}`;
  if (error instanceof Error && error.name === 'TimeoutError') return 'request timed out';
  if (error instanceof z.ZodError) return 'unexpected response shape';
  return error instanceof Error ? error.message : 'unknown error';
}

/**
 * Resolve the person ID of the token owner, for the stdio entry point where no
 * Entra identity is available (the Worker uses `user-resolver.ts` instead).
 *
 * Takes the ID only when the memberships name exactly one person -- anything
 * else is ambiguous, and a wrong "me" is worse than none. Never throws: like the
 * Worker resolver, the person ID only powers the "me" keyword, so a failure
 * degrades to `undefined` with a warning instead of stopping the server.
 */
export async function resolveSelfPersonId(
  client: ProductiveAPIClient,
  { timeoutMs = DEFAULT_TIMEOUT_MS }: { timeoutMs?: number } = {},
): Promise<string | undefined> {
  try {
    const response = await client.listOwnOrganizationMemberships(AbortSignal.timeout(timeoutMs));
    const { data } = MembershipsSchema.parse(response);
    const personIds = new Set(
      data.flatMap((membership) => membership.relationships?.person?.data?.id ?? []),
    );

    if (personIds.size === 1) return [...personIds][0];

    warn(
      personIds.size === 0
        ? 'no organization membership found'
        : `${personIds.size} different people found, refusing to guess`,
    );
    return undefined;
  } catch (error) {
    warn(describeFailure(error));
    return undefined;
  }
}

/**
 * An explicitly configured PRODUCTIVE_USER_ID always wins and costs no API call;
 * otherwise it is resolved from the token.
 */
export async function withSelfPersonId(
  config: Config,
  client: ProductiveAPIClient,
): Promise<Config> {
  if (config.PRODUCTIVE_USER_ID) return config;

  return { ...config, PRODUCTIVE_USER_ID: await resolveSelfPersonId(client) };
}
