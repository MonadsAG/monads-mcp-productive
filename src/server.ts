import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { getConfig } from './config/index.js';
import { ProductiveAPIClient } from './api/client.js';
import { registerToolsOnServer } from './tools/registry.js';
import { LOGO_DATA_URI } from './auth/logo.js';
import {
  generateTimesheetPrompt,
  timesheetPromptDefinition,
  generateQuickTimesheetPrompt,
  quickTimesheetPromptDefinition,
} from './prompts/timesheet.js';

export async function createServer() {
  const config = getConfig();
  const hasConfiguredUser = !!config.PRODUCTIVE_USER_ID;

  const server = new Server(
    {
      name: 'Productive Remote MCP',
      version: '1.1.0',
      icons: [{ src: LOGO_DATA_URI, mimeType: 'image/svg+xml', sizes: ['any'] }],
      description: `MCP server for Productive.io API integration. Productive has a hierarchical structure: Customers → Projects → Boards → Task Lists → Tasks.${hasConfiguredUser ? ` IMPORTANT: When users say "me" or "assign to me", use "me" as the assignee_id value - it automatically resolves to the configured user ID ${config.PRODUCTIVE_USER_ID}.` : ' No user configured - set PRODUCTIVE_USER_ID to enable "me" context.'} Use the 'whoami' tool to check current user context.`,
    },
    {
      capabilities: {
        tools: {},
        prompts: {},
      },
    },
  );
  const apiClient = new ProductiveAPIClient(config);

  // Register all tools via shared registry
  registerToolsOnServer(server, apiClient, config);

  // Register prompt handlers
  server.setRequestHandler(ListPromptsRequestSchema, async () => ({
    prompts: [timesheetPromptDefinition, quickTimesheetPromptDefinition],
  }));

  server.setRequestHandler(GetPromptRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    switch (name) {
      case 'timesheet_entry':
        return await generateTimesheetPrompt(args);

      case 'timesheet_step':
        return await generateQuickTimesheetPrompt(args);

      default:
        throw new Error(`Unknown prompt: ${name}`);
    }
  });

  // Connect to stdio transport
  const transport = new StdioServerTransport();
  await server.connect(transport);

  return server;
}
