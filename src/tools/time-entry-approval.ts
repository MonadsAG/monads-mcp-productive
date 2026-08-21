import { z } from 'zod';
import { ProductiveAPIClient } from '../api/client.js';
import { ProductiveTimeEntry } from '../api/types.js';
import { formatMinutesDisplay } from './time-entries.js';
import { toMcpError } from '../utils/errors.js';

const setTimeEntryApprovalSchema = z
  .object({
    time_entry_id: z.string().min(1, 'Time entry ID is required'),
    action: z.enum(['approve', 'unapprove', 'reject', 'unreject']),
    rejected_reason: z.string().optional(),
  })
  .superRefine((data, ctx) => {
    if (data.rejected_reason !== undefined && data.action !== 'reject') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['rejected_reason'],
        message: 'rejected_reason is only valid when action is "reject"',
      });
    }
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

export async function setTimeEntryApprovalTool(
  client: ProductiveAPIClient,
  args: unknown,
): Promise<{ content: Array<{ type: string; text: string }> }> {
  try {
    const params = setTimeEntryApprovalSchema.parse(args);

    switch (params.action) {
      case 'approve': {
        const response = await client.approveTimeEntry(params.time_entry_id);
        return formatTimeEntryResponse('approved successfully', response.data);
      }
      case 'unapprove': {
        const response = await client.unapproveTimeEntry(params.time_entry_id);
        return formatTimeEntryResponse('unapproved successfully', response.data);
      }
      case 'reject': {
        const response = await client.rejectTimeEntry(params.time_entry_id, params.rejected_reason);
        const extra = params.rejected_reason ? `Reason: ${params.rejected_reason}` : undefined;
        return formatTimeEntryResponse('rejected', response.data, extra);
      }
      case 'unreject': {
        const response = await client.unrejectTimeEntry(params.time_entry_id);
        return formatTimeEntryResponse('unrejected successfully', response.data);
      }
    }
  } catch (error) {
    throw toMcpError(error);
  }
}

export const setTimeEntryApprovalDefinition = {
  name: 'set_time_entry_approval',
  description:
    'Change the approval state of a time entry: approve/unapprove (reviewer sign-off) or ' +
    'reject/unreject (send back for correction, with an optional reason). Use list_time_entries ' +
    'first to find the time_entry_id. This is a single state machine -- the four Productive.io ' +
    'sub-endpoints (/approve, /unapprove, /reject, /unreject) are dispatched from the action value.',
  inputSchema: {
    type: 'object',
    properties: {
      time_entry_id: {
        type: 'string',
        description: 'ID of the time entry to update (required)',
      },
      action: {
        type: 'string',
        enum: ['approve', 'unapprove', 'reject', 'unreject'],
        description: 'The approval action to apply.',
      },
      rejected_reason: {
        type: 'string',
        description: 'Reason for rejecting the time entry. Only valid when action is "reject".',
      },
    },
    required: ['time_entry_id', 'action'],
    examples: [
      { time_entry_id: '123', action: 'approve' },
      {
        time_entry_id: '123',
        action: 'reject',
        rejected_reason: 'Logged against the wrong project',
      },
    ],
  },
};
