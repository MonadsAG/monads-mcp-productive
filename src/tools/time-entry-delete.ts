import { z } from 'zod';
import { ProductiveAPIClient } from '../api/client.js';
import { toMcpError } from '../utils/errors.js';
import { formatMinutesDisplay, formatApprovalLine } from './time-entries.js';
import { coerceBoolean, type ToolResult } from './tool-helpers.js';

const deleteTimeEntrySchema = z.object({
  time_entry_id: z.string().min(1, 'time_entry_id is required'),
  confirm: coerceBoolean.optional().default(false),
});

export async function deleteTimeEntryTool(
  client: ProductiveAPIClient,
  args: unknown,
): Promise<ToolResult> {
  try {
    const params = deleteTimeEntrySchema.parse(args);

    // Read first: an id alone says nothing about whose entry, what date, how
    // much time, or its approval state -- and deletion can't be undone.
    const current = await client.getTimeEntry(params.time_entry_id);
    const entry = current.data;
    const a = entry.attributes;

    if (!params.confirm) {
      return {
        content: [
          {
            type: 'text',
            text: `Time entry ${params.time_entry_id}
Date: ${a.date}
Time: ${formatMinutesDisplay(a.time)}${a.note ? `\nNote: ${a.note}` : ''}
${formatApprovalLine(entry)}

Deleting removes it outright -- there is no undo.

Call again with "confirm": true to delete it.`,
          },
        ],
      };
    }

    await client.deleteTimeEntry(params.time_entry_id);

    return {
      content: [
        {
          type: 'text',
          text: `Time entry ${params.time_entry_id} (${a.date}, ${formatMinutesDisplay(a.time)}) has been deleted.`,
        },
      ],
    };
  } catch (error) {
    throw toMcpError(error);
  }
}

export const deleteTimeEntryDefinition = {
  name: 'delete_time_entry',
  description:
    "Delete a time entry from Productive.io by its ID. Irreversible -- shows the entry's date, duration, note, and approval status and requires a follow-up call with confirm: true before deleting. Find time_entry_id via list_time_entries.",
  inputSchema: {
    type: 'object',
    properties: {
      time_entry_id: {
        type: 'string',
        description: 'ID of the time entry to delete (required)',
      },
      confirm: {
        type: 'boolean',
        description: 'Must be true to actually delete; omitted/false returns a preview instead',
      },
    },
    required: ['time_entry_id'],
  },
  annotations: {
    title: 'Delete time entry',
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: true,
    openWorldHint: true,
  },
};
