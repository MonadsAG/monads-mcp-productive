/**
 * Cloudflare Worker entry-point for the Productive MCP remote server.
 *
 * Architecture:
 * - OAuthProvider handles the OAuth 2.1 flow with Entra ID
 * - ProductiveMCP (McpAgent / Durable Object) handles MCP tool calls
 * - All secrets come from Cloudflare environment bindings (wrangler secret put)
 * - User identity flows through this.props (EntraProps from the auth handler)
 */

import OAuthProvider from '@cloudflare/workers-oauth-provider';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { McpAgent } from 'agents/mcp';
import type { WorkerEnv } from './config/worker-config.js';
import { getWorkerConfig } from './config/worker-config.js';
import { ProductiveAPIClient } from './api/client.js';
import { resolveUserId } from './auth/user-resolver.js';
import { EntraAuthHandler, type EntraProps } from './auth/entra-handler.js';
import { registerToolsOnServer } from './tools/registry.js';

export class ProductiveMCP extends McpAgent<WorkerEnv, Record<string, never>, EntraProps> {
  server = new Server(
    { name: 'productive-mcp', version: '1.1.0' },
    { capabilities: { tools: {} } },
  );

  async init() {
    const email = this.props?.email;
    const userId = email ? await resolveUserId(this.env, email) : undefined;
    const config = getWorkerConfig(this.env, userId);
    const apiClient = new ProductiveAPIClient(config);

    // Same registration as stdio -- JSON Schema inputSchemas work with low-level Server
    registerToolsOnServer(this.server, apiClient, config);
  }
}

export default new OAuthProvider({
  apiRoute: '/mcp',
  apiHandler: ProductiveMCP.serve('/mcp'),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  defaultHandler: EntraAuthHandler as any,
  authorizeEndpoint: '/authorize',
  tokenEndpoint: '/token',
  clientRegistrationEndpoint: '/register',
});
