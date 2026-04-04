import { z } from 'zod';
import { ProductiveAPIClient } from '../api/client.js';
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import { ProductiveTimer, ProductiveTimerCreate, ProductiveTimeEntryUpdate } from '../api/types.js';
import { formatMinutesDisplay } from './time-entries.js';

const getTimerSchema = z.object({
  timer_id: z.string().min(1, 'Timer ID is required'),
});

const startTimerSchema = z.object({
  service_id: z.string().optional(),
  time_entry_id: z.string().optional(),
  note: z.string().min(5, 'Work description must be at least 5 characters'),
});

const stopTimerSchema = z.object({
  timer_id: z.string().min(1, 'Timer ID is required'),
});

function formatTimerResponse(
  action: string,
  timer: ProductiveTimer,
): { content: Array<{ type: string; text: string }> } {
  const isRunning = timer.attributes.stopped_at === null;
  let text = `Timer ${action}!\n`;
  text += `ID: ${timer.id}\n`;
  text += `Status: ${isRunning ? 'Running' : 'Stopped'}\n`;
  text += `Started at: ${timer.attributes.started_at}`;

  if (timer.attributes.stopped_at) {
    text += `\nStopped at: ${timer.attributes.stopped_at}`;
  }

  if (timer.attributes.total_time > 0) {
    text += `\nTotal time: ${formatMinutesDisplay(timer.attributes.total_time)}`;
  }

  const timeEntryId = timer.relationships?.time_entry?.data?.id;
  if (timeEntryId) {
    text += `\nTime Entry ID: ${timeEntryId}`;
  }

  return { content: [{ type: 'text', text }] };
}

function formatServicesList(
  services: Array<{ id: string; attributes: { name: string; [key: string]: unknown } }>,
): string {
  return services.map((s) => `• ${s.attributes.name} (ID: ${s.id})`).join('\n');
}

export async function getTimerTool(
  client: ProductiveAPIClient,
  args: unknown,
): Promise<{ content: Array<{ type: string; text: string }> }> {
  try {
    const params = getTimerSchema.parse(args);
    const response = await client.getTimer(params.timer_id);
    return formatTimerResponse('found', response.data);
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

export async function startTimerTool(
  client: ProductiveAPIClient,
  args: unknown,
): Promise<{ content: Array<{ type: string; text: string }> }> {
  try {
    const params = startTimerSchema.parse(args);

    let resolvedServiceId = params.service_id;

    // If no service_id and no time_entry_id, show available services
    if (!resolvedServiceId && !params.time_entry_id) {
      const services = await client.listServices({ budget_status: 1, limit: 200 });

      if (!services.data || services.data.length === 0) {
        return {
          content: [{ type: 'text', text: 'No services with open budgets found.' }],
        };
      }

      return {
        content: [
          {
            type: 'text',
            text: `Please choose a service and call start_timer again with the service_id:\n\n${formatServicesList(services.data)}`,
          },
        ],
      };
    }

    const timerData: ProductiveTimerCreate = {
      data: {
        type: 'timers',
        attributes: {},
        relationships: {},
      },
    };

    if (params.time_entry_id) {
      timerData.data.relationships.time_entry = {
        data: { id: params.time_entry_id, type: 'time_entries' },
      };
    } else if (resolvedServiceId) {
      timerData.data.relationships.service = {
        data: { id: resolvedServiceId, type: 'services' },
      };
    }

    const response = await client.createTimer(timerData);

    // Resolve the time entry ID to set the note
    let timeEntryId = params.time_entry_id;
    if (!timeEntryId) {
      const timerDetail = await client.getTimerWithTimeEntry(response.data.id);
      timeEntryId = timerDetail.data.relationships?.time_entry?.data?.id;
    }

    let noteWarning = '';
    if (timeEntryId) {
      try {
        const updateData: ProductiveTimeEntryUpdate = {
          data: {
            type: 'time_entries',
            id: timeEntryId,
            attributes: { note: params.note },
          },
        };
        await client.updateTimeEntry(timeEntryId, updateData);
      } catch {
        noteWarning = '\nWarning: Timer started but note could not be set on the time entry.';
      }
    } else {
      noteWarning = '\nWarning: Could not resolve time entry ID — note was not set.';
    }

    const result = formatTimerResponse('started', response.data);
    if (noteWarning) {
      result.content[0].text += noteWarning;
    }
    return result;
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

export async function stopTimerTool(
  client: ProductiveAPIClient,
  args: unknown,
): Promise<{ content: Array<{ type: string; text: string }> }> {
  try {
    const params = stopTimerSchema.parse(args);
    const response = await client.stopTimer(params.timer_id);
    return formatTimerResponse('stopped', response.data);
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

export const getTimerDefinition = {
  name: 'get_timer',
  description: 'Get a timer by ID to check its status (running or stopped).',
  inputSchema: {
    type: 'object',
    properties: {
      timer_id: {
        type: 'string',
        description: 'ID of the timer to check (required)',
      },
    },
    required: ['timer_id'],
  },
  annotations: { readOnlyHint: true },
};

export const startTimerDefinition = {
  name: 'start_timer',
  description:
    'Start a new timer for time tracking. If no service_id is provided, returns a list of available services with open budgets for the user to choose from. A work description (note) is always required.',
  inputSchema: {
    type: 'object',
    properties: {
      service_id: {
        type: 'string',
        description:
          'Service ID to track time against. If not provided, a list of available services will be returned.',
      },
      time_entry_id: {
        type: 'string',
        description: 'Existing time entry ID to attach timer to (optional).',
      },
      note: {
        type: 'string',
        description: 'REQUIRED: Description of work being performed (minimum 5 characters).',
        minLength: 5,
      },
    },
    required: ['note'],
  },
};

export const stopTimerDefinition = {
  name: 'stop_timer',
  description: `Stop a running timer. The timer's total_time will be added to the associated time entry.`,
  inputSchema: {
    type: 'object',
    properties: {
      timer_id: {
        type: 'string',
        description: 'ID of the timer to stop (required)',
      },
    },
    required: ['timer_id'],
  },
};
