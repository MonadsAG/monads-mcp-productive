import type { WorkerEnv } from '../config/worker-config.js';

const KV_TTL_SECONDS = 86400; // 24 hours
const DEFAULT_API_BASE = 'https://api.productive.io/api/v2';

/**
 * Resolve a Productive.io user ID from an email address.
 * Checks KV cache first, then falls back to the Productive API.
 */
export async function resolveUserId(env: WorkerEnv, email: string): Promise<string | undefined> {
  const cached = await env.USER_MAPPING_KV.get(email);
  if (cached) return cached;

  const apiBase = env.PRODUCTIVE_API_BASE_URL || DEFAULT_API_BASE;
  const response = await fetch(
    `${apiBase}/people?${new URLSearchParams({ 'filter[email]': email, 'page[size]': '1' })}`,
    {
      headers: {
        'Content-Type': 'application/vnd.api+json',
        'X-Auth-Token': env.PRODUCTIVE_API_TOKEN,
        'X-Organization-Id': env.PRODUCTIVE_ORG_ID,
      },
    },
  );

  if (!response.ok) {
    console.error(`Failed to resolve user ID for ${email}: ${response.status}`);
    return undefined;
  }

  const body = (await response.json()) as { data?: Array<{ id: string }> };
  const person = body.data?.[0];
  if (!person) return undefined;

  await env.USER_MAPPING_KV.put(email, person.id, { expirationTtl: KV_TTL_SECONDS });
  return person.id;
}
