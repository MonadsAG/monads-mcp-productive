import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import {
  generateTimesheetPrompt,
  timesheetPromptDefinition,
  generateQuickTimesheetPrompt,
  quickTimesheetPromptDefinition,
} from './timesheet.js';

/**
 * Register the prompt handlers on a server. Shared by both entry points (stdio
 * and Worker), like `registerToolsOnServer`; the server must declare the
 * `prompts` capability. The prompts are static guidance and need no API token,
 * so the Worker registers them on the no-token path as well.
 */
export function registerPromptsOnServer(server: Server): void {
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
}
