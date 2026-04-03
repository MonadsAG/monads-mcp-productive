import { z } from 'zod';
import { ProductiveAPIClient } from '../api/client.js';
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import { ProductiveTimeEntryUpdate } from '../api/types.js';
import { parseTimeToMinutes, parseDate, formatMinutesDisplay } from './time-entries.js';

const updateTimeEntrySchema = z.object({
  time_entry_id: z.string().min(1, 'Time entry ID is required'),
  date: z.string().optional(),
  time: z.string().optional(),
  billable_time: z.string().optional(),
  note: z.string().optional(),
});

export async function updateTimeEntryTool(
  client: ProductiveAPIClient,
  args: unknown,
): Promise<{ content: Array<{ type: string; text: string }> }> {
  try {
    const params = updateTimeEntrySchema.parse(args);

    const attributes: Record<string, string | number> = {};

    if (params.date !== undefined) {
      try {
        attributes.date = parseDate(params.date);
      } catch (error) {
        throw new McpError(
          ErrorCode.InvalidParams,
          error instanceof Error ? error.message : 'Invalid date format',
        );
      }
    }

    if (params.time !== undefined) {
      try {
        attributes.time = parseTimeToMinutes(params.time);
      } catch (error) {
        throw new McpError(
          ErrorCode.InvalidParams,
          error instanceof Error ? error.message : 'Invalid time format',
        );
      }
    }

    if (params.billable_time !== undefined) {
      try {
        attributes.billable_time = parseTimeToMinutes(params.billable_time);
      } catch (error) {
        throw new McpError(
          ErrorCode.InvalidParams,
          `Invalid billable time format: ${error instanceof Error ? error.message : 'Invalid time format'}`,
        );
      }
    }

    if (params.note !== undefined) {
      attributes.note = params.note;
    }

    if (Object.keys(attributes).length === 0) {
      throw new McpError(
        ErrorCode.InvalidParams,
        'At least one field to update must be provided (date, time, billable_time, or note)',
      );
    }

    const updateData: ProductiveTimeEntryUpdate = {
      data: {
        type: 'time_entries',
        id: params.time_entry_id,
        attributes,
      },
    };

    const response = await client.updateTimeEntry(params.time_entry_id, updateData);

    const entry = response.data;
    let text = `Time entry updated successfully!\n`;
    text += `ID: ${entry.id}\n`;
    text += `Date: ${entry.attributes.date}\n`;
    text += `Time: ${formatMinutesDisplay(entry.attributes.time)}`;

    if (
      entry.attributes.billable_time !== undefined &&
      entry.attributes.billable_time !== entry.attributes.time
    ) {
      text += ` (Billable: ${formatMinutesDisplay(entry.attributes.billable_time)})`;
    }

    if (entry.attributes.note) {
      text += `\nNote: ${entry.attributes.note}`;
    }

    if (entry.attributes.updated_at) {
      text += `\nUpdated at: ${entry.attributes.updated_at}`;
    }

    return {
      content: [{ type: 'text', text }],
    };
  } catch (error) {
    if (error instanceof McpError) {
      throw error;
    }

    if (error instanceof z.ZodError) {
      throw new McpError(
        ErrorCode.InvalidParams,
        `Invalid parameters: ${error.errors.map((e) => e.message).join(', ')}`,
      );
    }

    throw new McpError(
      ErrorCode.InternalError,
      error instanceof Error ? error.message : 'Unknown error occurred',
    );
  }
}

export const updateTimeEntryDefinition = {
  name: 'update_time_entry',
  description:
    'Update an existing time entry in Productive.io. All fields except time_entry_id are optional - only provided fields will be updated. Use list_time_entries to find the time entry ID first.',
  inputSchema: {
    type: 'object',
    properties: {
      time_entry_id: {
        type: 'string',
        description: 'ID of the time entry to update (required)',
      },
      date: {
        type: 'string',
        description: 'New date. Accepts "today", "yesterday", or YYYY-MM-DD format',
      },
      time: {
        type: 'string',
        description:
          'New time duration. Accepts formats like "2h", "120m", "2.5h", or "2.5" (assumed hours)',
      },
      billable_time: {
        type: 'string',
        description: 'New billable time duration. Same formats as time field',
      },
      note: {
        type: 'string',
        description: 'Updated work description',
      },
    },
    required: ['time_entry_id'],
  },
};
