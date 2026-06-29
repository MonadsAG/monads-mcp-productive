import { productiveApiBase, type WorkerEnv } from '../config/worker-config.js';

const KV_TTL_SECONDS = 86400; // 24 hours

/**
 * Resolve the calling user's Productive.io person ID, authenticating with THEIR
 * own PAT (BYOT) -- no shared admin token. Cached in USER_MAPPING_KV keyed by the
 * stable Entra oid (not email, which is mutable). The person ID powers the "me"
 * keyword in tools; it is not used for authorization.
 */
export async function resolveUserId(
  env: WorkerEnv,
  oid: string,
  email: string,
  userPat: string,
): Promise<string | undefined> {
  const cached = await env.USER_MAPPING_KV.get(oid);
  if (cached) return cached;

  if (!email) return undefined;

  // The person ID only powers the "me" keyword; it is optional. A transient
  // network/API error (or a least-privilege PAT that can't list people) must
  // degrade to undefined, never throw -- otherwise it would 500 the whole request.
  try {
    const base = productiveApiBase(env);
    const response = await fetch(
      `${base}people?${new URLSearchParams({ 'filter[email]': email, 'page[size]': '1' })}`,
      {
        headers: {
          'Content-Type': 'application/vnd.api+json',
          'X-Auth-Token': userPat,
          'X-Organization-Id': env.PRODUCTIVE_ORG_ID,
        },
      },
    );

    if (!response.ok) {
      console.error(`Failed to resolve person ID for oid ${oid}: ${response.status}`);
      return undefined;
    }

    const body = (await response.json()) as { data?: Array<{ id: string }> };
    const person = body.data?.[0];
    if (!person) return undefined;

    await env.USER_MAPPING_KV.put(oid, person.id, { expirationTtl: KV_TTL_SECONDS });
    return person.id;
  } catch (error) {
    console.error(
      `Error resolving person ID for oid ${oid}:`,
      error instanceof Error ? error.message : 'unknown',
    );
    return undefined;
  }
}
