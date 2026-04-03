import { z } from 'zod';
import { ProductiveAPIClient } from '../api/client.js';
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import { ProductiveTimeEntry } from '../api/types.js';
import { formatMinutesDisplay } from './time-entries.js';

const timeEntryIdSchema = z.object({
  time_entry_id: z.string().min(1, 'Time entry ID is required'),
});

const rejectTimeEntrySchema = z.object({
  time_entry_id: z.string().min(1, 'Time entry ID is required'),
  rejected_reason: z.string().optional(),
});

function formatTimeEntryResponse(
  action: string,
  entry: ProductiveTimeEntry,
  extra?: string,
): { content: Array<{ type: string; text: string }> } {
  let text = `Time entry ${action}!\n`;
  text += `ID: ${entry.id}\n`;
  text += `Date: ${entry.attributes.date}\n`;
  text += `Time: ${formatMinutesDisplay(entry.attributes.time)}`;

  if (extra) {
    text += `\n${extra}`;
  }

  if (entry.attributes.note) {
    text += `\nNote: ${entry.attributes.note}`;
  }

  if (entry.attributes.updated_at) {
    text += `\nUpdated at: ${entry.attributes.updated_at}`;
  }

  return { content: [{ type: 'text', text }] };
}

export async function approveTimeEntryTool(
  client: ProductiveAPIClient,
  args: unknown,
): Promise<{ content: Array<{ type: string; text: string }> }> {
  try {
    const params = timeEntryIdSchema.parse(args);
    const response = await client.approveTimeEntry(params.time_entry_id);
    return formatTimeEntryResponse('approved successfully', response.data);
  } catch (error) {
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

export async function unapproveTimeEntryTool(
  client: ProductiveAPIClient,
  args: unknown,
): Promise<{ content: Array<{ type: string; text: string }> }> {
  try {
    const params = timeEntryIdSchema.parse(args);
    const response = await client.unapproveTimeEntry(params.time_entry_id);
    return formatTimeEntryResponse('unapproved successfully', response.data);
  } catch (error) {
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

export async function rejectTimeEntryTool(
  client: ProductiveAPIClient,
  args: unknown,
): Promise<{ content: Array<{ type: string; text: string }> }> {
  try {
    const params = rejectTimeEntrySchema.parse(args);
    const response = await client.rejectTimeEntry(params.time_entry_id, params.rejected_reason);
    const extra = params.rejected_reason ? `Reason: ${params.rejected_reason}` : undefined;
    return formatTimeEntryResponse('rejected', response.data, extra);
  } catch (error) {
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

export async function unrejectTimeEntryTool(
  client: ProductiveAPIClient,
  args: unknown,
): Promise<{ content: Array<{ type: string; text: string }> }> {
  try {
    const params = timeEntryIdSchema.parse(args);
    const response = await client.unrejectTimeEntry(params.time_entry_id);
    return formatTimeEntryResponse('unrejected successfully', response.data);
  } catch (error) {
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

export const approveTimeEntryDefinition = {
  name: 'approve_time_entry',
  description:
    'Approve a time entry in Productive.io. Use list_time_entries to find the time entry ID first.',
  inputSchema: {
    type: 'object',
    properties: {
      time_entry_id: {
        type: 'string',
        description: 'ID of the time entry to approve (required)',
      },
    },
    required: ['time_entry_id'],
  },
};

export const unapproveTimeEntryDefinition = {
  name: 'unapprove_time_entry',
  description:
    'Unapprove (reverse approval of) a time entry in Productive.io. Use list_time_entries to find the time entry ID first.',
  inputSchema: {
    type: 'object',
    properties: {
      time_entry_id: {
        type: 'string',
        description: 'ID of the time entry to unapprove (required)',
      },
    },
    required: ['time_entry_id'],
  },
};

export const rejectTimeEntryDefinition = {
  name: 'reject_time_entry',
  description:
    'Reject a time entry in Productive.io with an optional reason. Use list_time_entries to find the time entry ID first.',
  inputSchema: {
    type: 'object',
    properties: {
      time_entry_id: {
        type: 'string',
        description: 'ID of the time entry to reject (required)',
      },
      rejected_reason: {
        type: 'string',
        description: 'Reason for rejecting the time entry (optional)',
      },
    },
    required: ['time_entry_id'],
  },
};

export const unrejectTimeEntryDefinition = {
  name: 'unreject_time_entry',
  description:
    'Unreject (reverse rejection of) a time entry in Productive.io. Use list_time_entries to find the time entry ID first.',
  inputSchema: {
    type: 'object',
    properties: {
      time_entry_id: {
        type: 'string',
        description: 'ID of the time entry to unreject (required)',
      },
    },
    required: ['time_entry_id'],
  },
};
