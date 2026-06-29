import { z } from 'zod';

/** Default Productive API base (trailing slash required: client builds `${base}${path}`). */
export const DEFAULT_PRODUCTIVE_API_BASE = 'https://api.productive.io/api/v2/';

/**
 * Cloudflare Worker environment bindings.
 * Values come from wrangler secrets and KV namespace bindings -- never hardcoded.
 */
export interface WorkerEnv {
  /**
   * Legacy shared admin token. After the BYOT cutover it is no longer used on the
   * tool path -- each request authenticates with the calling user's own PAT loaded
   * from USER_PAT_KV. Kept optional so the secret can be removed (see FR-11).
   */
  PRODUCTIVE_API_TOKEN?: string;
  PRODUCTIVE_ORG_ID: string;
  PRODUCTIVE_API_BASE_URL?: string;
  ENTRA_CLIENT_ID: string;
  ENTRA_CLIENT_SECRET: string;
  ENTRA_TENANT_ID: string;
  COOKIE_ENCRYPTION_KEY: string;
  /** Hex-encoded 32-byte key (openssl rand -hex 32) for AES-256-GCM PAT encryption. */
  PAT_ENC_KEY: string;
  OAUTH_KV: KVNamespace;
  USER_MAPPING_KV: KVNamespace;
  /** Per-user encrypted Productive PATs, keyed by Entra oid. */
  USER_PAT_KV: KVNamespace;
}

const workerConfigSchema = z.object({
  PRODUCTIVE_API_TOKEN: z.string().min(1, 'API token is required'),
  PRODUCTIVE_ORG_ID: z.string().min(1, 'Organization ID is required'),
  PRODUCTIVE_USER_ID: z.string().optional(),
  // Normalize to a single trailing slash so the client's `${base}${path}` never
  // produces `.../v2tasks`. Applies to operator-supplied values and the default.
  PRODUCTIVE_API_BASE_URL: z
    .string()
    .url()
    .default(DEFAULT_PRODUCTIVE_API_BASE)
    .transform((u) => u.replace(/\/?$/, '/')),
});

export type WorkerConfig = z.infer<typeof workerConfigSchema>;

/**
 * Build a Config-compatible object from Cloudflare Worker env bindings.
 *
 * The Productive credential is the calling user's own PAT (BYOT), passed in per
 * request -- never read from a shared env secret (FR-12). The org id stays shared
 * (FR-8) and the userId is resolved separately via the Entra identity → Productive
 * person mapping.
 */
export function getWorkerConfig(
  env: WorkerEnv,
  userId: string | undefined,
  userToken: string,
): WorkerConfig {
  const result = workerConfigSchema.safeParse({
    PRODUCTIVE_API_TOKEN: userToken,
    PRODUCTIVE_ORG_ID: env.PRODUCTIVE_ORG_ID,
    PRODUCTIVE_USER_ID: userId,
    PRODUCTIVE_API_BASE_URL: env.PRODUCTIVE_API_BASE_URL,
  });

  if (!result.success) {
    throw new Error(
      `Worker configuration validation failed: ${JSON.stringify(result.error.format())}`,
    );
  }

  return result.data;
}

/**
 * Canonical Productive API base URL (always trailing-slash) for callers that issue
 * fetches outside getWorkerConfig (the per-user PAT resolver and the settings page).
 */
export function productiveApiBase(env: WorkerEnv): string {
  return (env.PRODUCTIVE_API_BASE_URL || DEFAULT_PRODUCTIVE_API_BASE).replace(/\/?$/, '/');
}
