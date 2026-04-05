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
import { EntraAuthHandler, type EntraProps } from './auth/entra-handler.js';
import { registerToolsOnServer } from './tools/registry.js';
import { LOGO_DATA_URI } from './auth/logo.js';

export default new OAuthProvider({
  apiRoute: '/mcp',
  apiHandler: {
    fetch: async (request: Request, env: WorkerEnv, ctx: ExecutionContext) => {
      const props = (ctx as unknown as { props?: EntraProps }).props;
      const email = props?.email;
      const userId = email ? await resolveUserId(env, email) : undefined;
      const config = getWorkerConfig(env, userId);
      const apiClient = new ProductiveAPIClient(config);

      const server = new Server(
        {
          name: 'Productive Remote MCP',
          version: '1.2.0',
          icons: [{ src: LOGO_DATA_URI, mimeType: 'image/svg+xml', sizes: ['any'] }],
        },
        { capabilities: { tools: {} } },
      );
      registerToolsOnServer(server, apiClient, config);

      return createMcpHandler(server)(request, env, ctx);
    },
  },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  defaultHandler: EntraAuthHandler as any,
  authorizeEndpoint: '/authorize',
  tokenEndpoint: '/token',
  clientRegistrationEndpoint: '/register',
});
