/**
 * Cloudflare Worker entry-point for the Productive MCP remote server.
 *
 * Architecture:
 * - OAuthProvider handles the OAuth 2.1 flow with Entra ID
 * - createMcpHandler serves stateless Streamable HTTP (no Durable Object)
 * - All secrets come from Cloudflare environment bindings (wrangler secret put)
 * - User identity flows through ctx.props (EntraProps from the auth handler)
 */

import OAuthProvider from '@cloudflare/workers-oauth-provider';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { createMcpHandler } from 'agents/mcp';
import type { WorkerEnv } from './config/worker-config.js';
import { getWorkerConfig } from './config/worker-config.js';
import { ProductiveAPIClient } from './api/client.js';
import { resolveUserId } from './auth/user-resolver.js';
import { getUserPat } from './auth/pat-store.js';
import { EntraAuthHandler, type EntraProps } from './auth/entra-handler.js';
import { registerNoTokenHandlers, registerToolsOnServer } from './tools/registry.js';
import { getEnabledToolNames } from './tools/toolsets.js';
import { LOGO_DATA_URI } from './auth/logo.js';

export default new OAuthProvider({
  apiRoute: '/mcp',
  apiHandler: {
    fetch: async (request: Request, env: WorkerEnv, ctx: ExecutionContext) => {
      const props = (ctx as unknown as { props?: EntraProps }).props;
      const oid = props?.oid;
      const email = props?.email;
      const enabledToolNames = getEnabledToolNames(env.PRODUCTIVE_TOOLSETS);

      const server = new Server(
        {
          name: 'Productive Remote MCP',
          version: '1.2.0',
          icons: [{ src: LOGO_DATA_URI, mimeType: 'image/svg+xml', sizes: ['any'] }],
        },
        { capabilities: { tools: {} } },
      );

      // BYOT: each request authenticates with the calling user's own Productive
      // PAT, loaded + decrypted from KV by their Entra oid -- no shared admin token.
      // getUserPat returns null both when no PAT is stored and when a stored PAT
      // can't be decrypted, so either way the user gets the FR-9 hint, not a 500.
      const pat = oid ? await getUserPat(env, oid) : null;
      if (!oid || !pat) {
        // No usable PAT (FR-9): tools/list still works, but every tools/call
        // returns a structured hint pointing at the settings page.
        registerNoTokenHandlers(server, new URL('/settings', request.url).href, enabledToolNames);
      } else {
        const userId = email ? await resolveUserId(env, oid, email, pat) : undefined;
        const config = getWorkerConfig(env, userId, pat);
        registerToolsOnServer(server, new ProductiveAPIClient(config), config, enabledToolNames);
      }

      return createMcpHandler(server)(request, env, ctx);
    },
  },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  defaultHandler: EntraAuthHandler as any,
  authorizeEndpoint: '/authorize',
  tokenEndpoint: '/token',
  clientRegistrationEndpoint: '/register',
});
