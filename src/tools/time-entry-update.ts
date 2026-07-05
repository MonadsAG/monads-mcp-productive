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
  service_id: z.string().optional(),
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

    const relationships: NonNullable<ProductiveTimeEntryUpdate['data']['relationships']> = {};

    if (params.service_id !== undefined) {
      relationships.service = { data: { id: params.service_id, type: 'services' } };
    }

    if (Object.keys(attributes).length === 0 && Object.keys(relationships).length === 0) {
      throw new McpError(
        ErrorCode.InvalidParams,
        'At least one field to update must be provided (date, time, billable_time, note, or service_id)',
      );
    }

    const updateData: ProductiveTimeEntryUpdate = {
      data: {
        type: 'time_entries',
        id: params.time_entry_id,
        attributes,
        ...(Object.keys(relationships).length > 0 ? { relationships } : {}),
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

    if (params.service_id !== undefined) {
      text += `\nReassigned to Service ID: ${params.service_id}`;
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
    "Edit fields on a time entry that already exists — its date, duration, billable duration, note, or service. Use this to correct or annotate a previously logged entry, as opposed to create_time_entry which logs a new one. Partial update: pass only the fields you want to change; every field except time_entry_id is optional and untouched fields are left as-is. Passing service_id reassigns the entry to a different service, which moves it onto that service's budget/deal — this is how you switch a time entry from one budget to another. Find the target service_id via list_services or get_project_services. Cannot reassign task or person. Find time_entry_id via list_time_entries.",
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
      service_id: {
        type: 'string',
        description:
          "Reassign the entry to a different service ID, moving it onto that service's budget/deal. Use list_services or get_project_services to find the target service ID.",
      },
    },
    required: ['time_entry_id'],
  },
};
