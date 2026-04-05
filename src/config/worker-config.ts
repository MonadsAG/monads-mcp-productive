import { z } from 'zod';

/**
 * Cloudflare Worker environment bindings.
 * Values come from wrangler secrets and KV namespace bindings -- never hardcoded.
 */
export interface WorkerEnv {
  PRODUCTIVE_API_TOKEN: string;
  PRODUCTIVE_ORG_ID: string;
  PRODUCTIVE_API_BASE_URL?: string;
  ENTRA_CLIENT_ID: string;
  ENTRA_CLIENT_SECRET: string;
  ENTRA_TENANT_ID: string;
  COOKIE_ENCRYPTION_KEY: string;
  OAUTH_KV: KVNamespace;
  USER_MAPPING_KV: KVNamespace;
  MCP_OBJECT: DurableObjectNamespace;
}

const workerConfigSchema = z.object({
  PRODUCTIVE_API_TOKEN: z.string().min(1, 'API token is required'),
  PRODUCTIVE_ORG_ID: z.string().min(1, 'Organization ID is required'),
  PRODUCTIVE_USER_ID: z.string().optional(),
  PRODUCTIVE_API_BASE_URL: z.string().url().default('https://api.productive.io/api/v2/'),
});

export type WorkerConfig = z.infer<typeof workerConfigSchema>;

/**
 * Build a Config-compatible object from Cloudflare Worker env bindings.
 * The userId is resolved separately via Entra email → Productive API mapping.
 */
export function getWorkerConfig(env: WorkerEnv, userId?: string): WorkerConfig {
  const result = workerConfigSchema.safeParse({
    PRODUCTIVE_API_TOKEN: env.PRODUCTIVE_API_TOKEN,
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
