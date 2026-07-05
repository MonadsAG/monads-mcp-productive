import { z } from 'zod';
import { ProductiveAPIClient } from '../api/client.js';
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import {
  ProductiveTaskCreate,
  ProductiveTaskUpdate,
  ProductiveIncludedResource,
} from '../api/types.js';
import { buildIncludeMap, resolveName } from './include-resolver.js';
import { buildCustomFieldValueMap, resolveCustomFieldsText } from './custom-field-resolver.js';

function resolveWorkflowStatus(
  task: { relationships?: Record<string, any> },
  included?: ProductiveIncludedResource[],
): string | undefined {
  const statusId = task.relationships?.workflow_status?.data?.id;
  if (!statusId || !included) return undefined;
  const status = included.find((item) => item.type === 'workflow_statuses' && item.id === statusId);
  return status?.attributes?.name || undefined;
}

const listTasksSchema = z.object({
  project_id: z.string().optional(),
  assignee_id: z.string().optional(),
  status: z.enum(['open', 'closed']).optional(),
  limit: z.coerce.number().min(1).max(200).default(30).optional(),
});

const getProjectTasksSchema = z.object({
  project_id: z.string().min(1, 'Project ID is required'),
  status: z.enum(['open', 'closed']).optional(),
});

const getTaskSchema = z.object({
  task_id: z.string().min(1, 'Task ID is required'),
});

export async function listTasksTool(
  client: ProductiveAPIClient,
  args: unknown,
): Promise<{ content: Array<{ type: string; text: string }> }> {
  try {
    const params = listTasksSchema.parse(args || {});

    const response = await client.listTasks({
      project_id: params.project_id,
      assignee_id: params.assignee_id,
      status: params.status,
      limit: params.limit,
    });

    if (!response || !response.data || response.data.length === 0) {
      return {
        content: [
          {
            type: 'text',
            text: 'No tasks found matching the criteria.',
          },
        ],
      };
    }

    const nameMap = buildIncludeMap(response.included);
    const customFieldMap = await buildCustomFieldValueMap(client, response.data);
    const tasksText = response.data
      .filter((task) => task && task.attributes)
      .map((task) => {
        const projectId = task.relationships?.project?.data?.id;
        const assigneeId = task.relationships?.assignee?.data?.id;
        const assigneeName = resolveName(nameMap, 'people', assigneeId);
        const projectName = resolveName(nameMap, 'projects', projectId);
        const workflowStatusName = resolveWorkflowStatus(task, response.included);
        const fallbackStatus =
          task.attributes.status === 1
            ? 'open'
            : task.attributes.status === 2
              ? 'closed'
              : `status ${task.attributes.status}`;
        const statusText = workflowStatusName || fallbackStatus;
        const assigneeDisplay = assigneeName
          ? `Assignee: ${assigneeName}`
          : assigneeId
            ? `Assignee ID: ${assigneeId}`
            : 'Unassigned';
        const customFieldsLines = resolveCustomFieldsText(
          customFieldMap,
          task.attributes.custom_fields,
        );
        const customFieldsSuffix =
          customFieldsLines.length > 0 ? `\n  Custom Fields: ${customFieldsLines.join('; ')}` : '';
        return `• ${task.attributes.title} (ID: ${task.id})
  Status: ${statusText}
  ${task.attributes.due_date ? `Due: ${task.attributes.due_date}` : 'No due date'}
  ${projectName ? `Project: ${projectName}` : projectId ? `Project ID: ${projectId}` : ''}
  ${assigneeDisplay}
  ${task.attributes.description ? `Description: ${task.attributes.description}` : ''}${customFieldsSuffix}`;
      })
      .join('\n\n');

    const summary = `Found ${response.data.length} task${response.data.length !== 1 ? 's' : ''}${response.meta?.total_count ? ` (showing ${response.data.length} of ${response.meta.total_count})` : ''}:\n\n${tasksText}`;

    return {
      content: [
        {
          type: 'text',
          text: summary,
        },
      ],
    };
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

export async function getProjectTasksTool(
  client: ProductiveAPIClient,
  args: unknown,
): Promise<{ content: Array<{ type: string; text: string }> }> {
  try {
    const params = getProjectTasksSchema.parse(args);

    const response = await client.listTasks({
      project_id: params.project_id,
      status: params.status,
      limit: 200, // Get maximum tasks for a project
    });

    if (!response || !response.data || response.data.length === 0) {
      return {
        content: [
          {
            type: 'text',
            text: `No tasks found for project ${params.project_id}.`,
          },
        ],
      };
    }

    const nameMap = buildIncludeMap(response.included);
    const customFieldMap = await buildCustomFieldValueMap(client, response.data);
    const tasksText = response.data
      .filter((task) => task && task.attributes)
      .map((task) => {
        const assigneeId = task.relationships?.assignee?.data?.id;
        const assigneeName = resolveName(nameMap, 'people', assigneeId);
        const workflowStatusName = resolveWorkflowStatus(task, response.included);
        const fallbackStatus =
          task.attributes.status === 1
            ? 'open'
            : task.attributes.status === 2
              ? 'closed'
              : `status ${task.attributes.status}`;
        const statusText = workflowStatusName || fallbackStatus;
        const assigneeDisplay = assigneeName
          ? `Assignee: ${assigneeName}`
          : assigneeId
            ? `Assignee ID: ${assigneeId}`
            : 'Unassigned';
        const customFieldsLines = resolveCustomFieldsText(
          customFieldMap,
          task.attributes.custom_fields,
        );
        const customFieldsSuffix =
          customFieldsLines.length > 0 ? `\n  Custom Fields: ${customFieldsLines.join('; ')}` : '';
        return `• ${task.attributes.title} (ID: ${task.id})
  Status: ${statusText}
  ${task.attributes.due_date ? `Due: ${task.attributes.due_date}` : 'No due date'}
  ${assigneeDisplay}
  ${task.attributes.description ? `Description: ${task.attributes.description}` : ''}${customFieldsSuffix}`;
      })
      .join('\n\n');

    const summary = `Project ${params.project_id} has ${response.data.length} task${response.data.length !== 1 ? 's' : ''}:\n\n${tasksText}`;

    return {
      content: [
        {
          type: 'text',
          text: summary,
        },
      ],
    };
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

export async function getTaskTool(
  client: ProductiveAPIClient,
  args: unknown,
): Promise<{ content: Array<{ type: string; text: string }> }> {
  try {
    const params = getTaskSchema.parse(args);

    const response = await client.getTask(params.task_id);
    const task = response.data;
    const included = response.included;

    const nameMap = buildIncludeMap(included);
    const projectId = task.relationships?.project?.data?.id;
    const assigneeId = task.relationships?.assignee?.data?.id;
    const taskListId = task.relationships?.task_list?.data?.id;
    const projectName = resolveName(nameMap, 'projects', projectId);
    const assigneeName = resolveName(nameMap, 'people', assigneeId);
    const taskListName = resolveName(nameMap, 'task_lists', taskListId);

    // Resolve workflow status name from included data, fall back to closed boolean
    const workflowStatusName = resolveWorkflowStatus(task, included);
    const fallbackStatus =
      task.attributes.closed === false
        ? 'open'
        : task.attributes.closed === true
          ? 'closed'
          : 'unknown';
    const statusText = workflowStatusName || fallbackStatus;

    let text = `Task Details:\n\n`;
    text += `Title: ${task.attributes.title}\n`;
    text += `ID: ${task.id}\n`;
    text += `Status: ${statusText}\n`;

    if (task.attributes.description) {
      text += `Description: ${task.attributes.description}\n`;
    }

    if (task.attributes.due_date) {
      text += `Due Date: ${task.attributes.due_date}\n`;
    } else {
      text += `Due Date: No due date set\n`;
    }

    if (projectId) {
      text += projectName ? `Project: ${projectName}\n` : `Project ID: ${projectId}\n`;
    }

    if (assigneeId) {
      text += assigneeName ? `Assignee: ${assigneeName}\n` : `Assignee ID: ${assigneeId}\n`;
    } else {
      text += `Assignee: Unassigned\n`;
    }

    if (task.attributes.created_at) {
      text += `Created: ${task.attributes.created_at}\n`;
    }

    if (task.attributes.updated_at) {
      text += `Updated: ${task.attributes.updated_at}\n`;
    }

    if (task.attributes.priority !== undefined) {
      text += `Priority: ${task.attributes.priority}\n`;
    }

    if (task.attributes.placement !== undefined) {
      text += `Position: ${task.attributes.placement}\n`;
    }

    if (task.attributes.task_number) {
      text += `Task Number: ${task.attributes.task_number}\n`;
    }

    if (task.attributes.private !== undefined) {
      text += `Private: ${task.attributes.private ? 'Yes' : 'No'}\n`;
    }

    if (task.attributes.initial_estimate) {
      text += `Initial Estimate: ${task.attributes.initial_estimate}\n`;
    }

    if (task.attributes.worked_time) {
      text += `Worked Time: ${task.attributes.worked_time}\n`;
    }

    if (task.attributes.last_activity_at) {
      text += `Last Activity: ${task.attributes.last_activity_at}\n`;
    }

    if (taskListId) {
      text += taskListName ? `Task List: ${taskListName}\n` : `Task List ID: ${taskListId}\n`;
    }

    if (task.attributes.custom_fields && Object.keys(task.attributes.custom_fields).length > 0) {
      const customFieldMap = await buildCustomFieldValueMap(client, [task]);
      text += formatCustomFieldsBlock(customFieldMap, task.attributes.custom_fields);
    }

    return {
      content: [
        {
          type: 'text',
          text: text,
        },
      ],
    };
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

/**
 * Formats a "Custom Fields:" block (header + one indented "name: value" line per
 * entry, each ending with a trailing newline) for appending to trailing-newline-style
 * text output. Returns an empty string when there are no custom fields to show.
 */
function formatCustomFieldsBlock(
  map: Map<string, { name: string; options: Map<string, string> }>,
  rawCustomFields: Record<string, unknown> | null | undefined,
): string {
  const lines = resolveCustomFieldsText(map, rawCustomFields);
  if (lines.length === 0) return '';
  return `Custom Fields:\n${lines.map((line) => `  ${line}\n`).join('')}`;
}

export const listTasksDefinition = {
  name: 'list_tasks',
  description:
    'List tasks across Productive.io, optionally filtered by project, assignee, and open/closed status. ' +
    'Reach for this for flexible or cross-project queries and whenever you are filtering by assignee. ' +
    "Prefer get_project_tasks when you want one project's complete task list (it fetches up to 200; this defaults to 30), " +
    "get_task when you already have a task ID and need its full record, or my_tasks for the current user's own tasks. " +
    'Returns a paginated summary (default 30, max 200).',
  inputSchema: {
    type: 'object',
    properties: {
      project_id: {
        type: 'string',
        description: 'Filter to tasks in this project ID. Omit to search across all projects.',
      },
      assignee_id: {
        type: 'string',
        description:
          "Filter to tasks assigned to this person ID. For the current user's own tasks, prefer my_tasks.",
      },
      status: {
        type: 'string',
        enum: ['open', 'closed'],
        description: 'Filter by task status (open or closed). Omit to return both.',
      },
      limit: {
        type: 'number',
        description: 'Number of tasks to return (1-200, default 30).',
        minimum: 1,
        maximum: 200,
        default: 30,
      },
    },
  },
  annotations: { readOnlyHint: true },
};

export const getProjectTasksDefinition = {
  name: 'get_project_tasks',
  description:
    'Get all tasks for a single project (fetches up to 200 in one call, unlike list_tasks which defaults to 30). ' +
    "Prefer this over list_tasks when you need one project's complete task list; use list_tasks for cross-project or assignee-filtered queries. " +
    'ALSO used as STEP 4 in the timesheet workflow to find task_id for linking time entries to specific tasks. ' +
    'Workflow: list_projects → list_project_deals → list_deal_services → get_project_tasks → create_time_entry.',
  inputSchema: {
    type: 'object',
    properties: {
      project_id: {
        type: 'string',
        description: 'The ID of the project',
      },
      status: {
        type: 'string',
        enum: ['open', 'closed'],
        description: 'Filter by task status (open or closed)',
      },
    },
    required: ['project_id'],
  },
  annotations: { readOnlyHint: true },
};

export const getTaskDefinition = {
  name: 'get_task',
  description:
    'Get the full record for one task by its ID — title, description, status, assignee, project, task list, ' +
    'due/created/updated dates, priority, position, estimate, worked time, and resolved custom fields. ' +
    'Use this when you already have a task_id and need its complete details; use list_tasks or get_project_tasks ' +
    "to discover task IDs first, or list_subtasks to see a task's children.",
  inputSchema: {
    type: 'object',
    properties: {
      task_id: {
        type: 'string',
        description: 'The ID of the task to retrieve',
      },
    },
    required: ['task_id'],
  },
  annotations: { readOnlyHint: true },
};

const createTaskSchema = z.object({
  title: z.string().min(1, 'Task title is required'),
  description: z.string().optional(),
  description_html: z.string().optional(),
  project_id: z.string().optional(),
  board_id: z.string().optional(),
  task_list_id: z.string().optional(),
  assignee_id: z.string().optional(),
  due_date: z.string().optional(),
  status: z.enum(['open', 'closed']).optional().default('open'),
  custom_fields: z
    .record(
      z.string(),
      z.union([z.string(), z.number(), z.boolean(), z.array(z.string()), z.null()]),
    )
    .optional(),
});

export async function createTaskTool(
  client: ProductiveAPIClient,
  args: unknown,
  config?: { PRODUCTIVE_USER_ID?: string },
): Promise<{ content: Array<{ type: string; text: string }> }> {
  try {
    const params = createTaskSchema.parse(args || {});

    // Handle "me" reference for assignee
    let assigneeId = params.assignee_id;
    if (assigneeId === 'me') {
      if (!config?.PRODUCTIVE_USER_ID) {
        throw new McpError(
          ErrorCode.InvalidParams,
          'Cannot use "me" reference - PRODUCTIVE_USER_ID is not configured in environment',
        );
      }
      assigneeId = config.PRODUCTIVE_USER_ID;
    }

    // Use description_html if provided, otherwise fall back to description
    const descriptionValue = params.description_html || params.description;

    const taskData = {
      data: {
        type: 'tasks' as const,
        attributes: {
          title: params.title,
          description: descriptionValue,
          due_date: params.due_date,
          status: params.status === 'open' ? 1 : 2,
        } as ProductiveTaskCreate['data']['attributes'],
        relationships: {} as any,
      },
    };

    if (params.custom_fields) {
      taskData.data.attributes.custom_fields = params.custom_fields;
    }

    // Add relationships if provided
    if (params.project_id) {
      taskData.data.relationships.project = {
        data: {
          id: params.project_id,
          type: 'projects' as const,
        },
      };
    }

    if (params.board_id) {
      taskData.data.relationships.board = {
        data: {
          id: params.board_id,
          type: 'boards' as const,
        },
      };
    }

    if (params.task_list_id) {
      taskData.data.relationships.task_list = {
        data: {
          id: params.task_list_id,
          type: 'task_lists' as const,
        },
      };
    }

    if (assigneeId) {
      taskData.data.relationships.assignee = {
        data: {
          id: assigneeId,
          type: 'people' as const,
        },
      };
    }

    const response = await client.createTask(taskData);

    let text = `Task created successfully!\n`;
    text += `Title: ${response.data.attributes.title} (ID: ${response.data.id})`;
    if (response.data.attributes.description) {
      text += `\nDescription: ${response.data.attributes.description}`;
    }
    const statusText = response.data.attributes.status === 1 ? 'open' : 'closed';
    text += `\nStatus: ${statusText}`;
    if (response.data.attributes.due_date) {
      text += `\nDue date: ${response.data.attributes.due_date}`;
    }
    if (params.project_id) {
      text += `\nProject ID: ${params.project_id}`;
    }
    if (params.board_id) {
      text += `\nBoard ID: ${params.board_id}`;
    }
    if (params.task_list_id) {
      text += `\nTask List ID: ${params.task_list_id}`;
    }
    if (assigneeId) {
      text += `\nAssignee ID: ${assigneeId}`;
      if (params.assignee_id === 'me' && config?.PRODUCTIVE_USER_ID) {
        text += ` (me)`;
      }
    }
    if (response.data.attributes.created_at) {
      text += `\nCreated at: ${response.data.attributes.created_at}`;
    }

    if (
      response.data.attributes.custom_fields &&
      Object.keys(response.data.attributes.custom_fields).length > 0
    ) {
      const customFieldMap = await buildCustomFieldValueMap(client, [response.data]);
      const block = formatCustomFieldsBlock(customFieldMap, response.data.attributes.custom_fields);
      if (block) {
        text += `\n${block}`;
      }
    }

    return {
      content: [
        {
          type: 'text',
          text: text,
        },
      ],
    };
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

export const createTaskDefinition = {
  name: 'create_task',
  description:
    'Create a new task in Productive.io. If PRODUCTIVE_USER_ID is configured, you can use "me" to refer to the configured user when assigning.',
  inputSchema: {
    type: 'object',
    properties: {
      title: {
        type: 'string',
        description: 'Task title (required)',
      },
      description: {
        type: 'string',
        description: 'Task description (plain text)',
      },
      description_html: {
        type: 'string',
        description:
          'Task description with HTML formatting. Supports tags like <h2>, <p>, <ul>, <li>, <strong>, <em>, <a href="">. Takes precedence over description if both provided.',
      },
      project_id: {
        type: 'string',
        description: 'ID of the project to add the task to',
      },
      board_id: {
        type: 'string',
        description: 'ID of the board to add the task to',
      },
      task_list_id: {
        type: 'string',
        description: 'ID of the task list to add the task to',
      },
      assignee_id: {
        type: 'string',
        description:
          'ID of the person to assign the task to. If PRODUCTIVE_USER_ID is configured in environment, "me" refers to that user.',
      },
      due_date: {
        type: 'string',
        description: 'Due date in YYYY-MM-DD format',
      },
      status: {
        type: 'string',
        enum: ['open', 'closed'],
        description: 'Task status (default: open)',
      },
      custom_fields: {
        type: 'object',
        additionalProperties: true,
        description:
          'Custom field values, keyed by custom field ID. Use list_custom_fields to find valid ' +
          'field IDs and list_custom_field_options to find valid option IDs for dropdown/select ' +
          "fields. The value shape depends on the field's type: a string for text fields, a number " +
          'for numeric fields, a boolean for checkboxes, an ISO date string (YYYY-MM-DD) for date ' +
          'fields, an array of option ID strings for dropdown/multi-select fields, or null to clear ' +
          'the field.',
      },
    },
    required: ['title'],
  },
  annotations: { title: 'Create task', readOnlyHint: false, destructiveHint: false },
};

const updateTaskSchema = z.object({
  task_id: z.string().min(1, 'Task ID is required'),
  title: z.string().min(1, 'Task title cannot be empty').optional(),
  description: z.string().optional(),
  description_html: z.string().optional(),
  assignee_id: z
    .string()
    .nullable()
    .optional()
    .describe('ID of the person to assign, or null to unassign'),
  custom_fields: z
    .record(
      z.string(),
      z.union([z.string(), z.number(), z.boolean(), z.array(z.string()), z.null()]),
    )
    .optional(),
});

export async function updateTaskTool(
  client: ProductiveAPIClient,
  args: unknown,
  config?: { PRODUCTIVE_USER_ID?: string },
): Promise<{ content: Array<{ type: string; text: string }> }> {
  try {
    const params = updateTaskSchema.parse(args);

    if (
      !params.title &&
      params.description === undefined &&
      params.description_html === undefined &&
      params.assignee_id === undefined &&
      params.custom_fields === undefined
    ) {
      throw new McpError(
        ErrorCode.InvalidParams,
        'At least one field (title, description, description_html, assignee_id, or custom_fields) must be provided for update',
      );
    }

    // Resolve "me" and null; leave undefined untouched (field not being updated)
    let resolvedAssigneeId: string | null | undefined;
    if (params.assignee_id !== undefined) {
      if (params.assignee_id === 'me') {
        if (!config?.PRODUCTIVE_USER_ID) {
          throw new McpError(
            ErrorCode.InvalidParams,
            'Cannot use "me" reference - PRODUCTIVE_USER_ID is not configured in environment',
          );
        }
        resolvedAssigneeId = config.PRODUCTIVE_USER_ID;
      } else {
        resolvedAssigneeId = params.assignee_id;
      }
    }

    const taskUpdate: ProductiveTaskUpdate = {
      data: {
        type: 'tasks',
        id: params.task_id,
      },
    };

    const attributes: NonNullable<ProductiveTaskUpdate['data']['attributes']> = {};
    if (params.title) {
      attributes.title = params.title;
    }
    if (params.description_html !== undefined) {
      attributes.description = params.description_html;
    } else if (params.description !== undefined) {
      attributes.description = params.description;
    }
    if (params.custom_fields) {
      attributes.custom_fields = params.custom_fields;
    }
    if (Object.keys(attributes).length > 0) {
      taskUpdate.data.attributes = attributes;
    }

    if (resolvedAssigneeId !== undefined) {
      taskUpdate.data.relationships = {
        assignee: {
          data: resolvedAssigneeId === null ? null : { id: resolvedAssigneeId, type: 'people' },
        },
      };
    }

    const response = await client.updateTask(params.task_id, taskUpdate);

    let text = `Task updated successfully!\n`;
    text += `Task: ${response.data.attributes.title} (ID: ${response.data.id})\n`;

    if (params.title) {
      text += `✓ Title updated to: "${response.data.attributes.title}"\n`;
    }

    if (params.description_html !== undefined || params.description !== undefined) {
      if (response.data.attributes.description) {
        const truncated =
          response.data.attributes.description.length > 100
            ? response.data.attributes.description.substring(0, 100) + '...'
            : response.data.attributes.description;
        text += `✓ Description updated${params.description_html ? ' (HTML)' : ''}: "${truncated}"\n`;
      } else {
        text += `✓ Description cleared\n`;
      }
    }

    if (resolvedAssigneeId !== undefined) {
      if (resolvedAssigneeId) {
        text += `✓ Assigned to: Person ID ${resolvedAssigneeId}`;
        if (params.assignee_id === 'me' && config?.PRODUCTIVE_USER_ID) {
          text += ` (me)`;
        }
        text += `\n`;
      } else {
        text += `✓ Task is now unassigned\n`;
      }
    }

    if (params.custom_fields) {
      const customFieldMap = await buildCustomFieldValueMap(client, [response.data]);
      const block = formatCustomFieldsBlock(customFieldMap, response.data.attributes.custom_fields);
      if (block) {
        text += `${block}\n`;
      }
    }

    if (response.data.attributes.updated_at) {
      text += `Updated at: ${response.data.attributes.updated_at}`;
    }

    return {
      content: [
        {
          type: 'text',
          text: text,
        },
      ],
    };
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

export const updateTaskDefinition = {
  name: 'update_task',
  description:
    "Update an existing task's title, description, assignee, and/or custom fields in a single call. " +
    "To change task status (open/closed) use update_task_status instead -- that's a separate workflow-state " +
    'transition, not a content edit. To move a task between task lists, use move_task_to_list. ' +
    'At least one field must be provided.',
  inputSchema: {
    type: 'object',
    properties: {
      task_id: {
        type: 'string',
        description: 'ID of the task to update (required)',
      },
      title: {
        type: 'string',
        description: 'New title/name for the task (optional, but cannot be empty if provided)',
      },
      description: {
        type: 'string',
        description:
          'New description for the task in plain text (optional, use empty string to clear description)',
      },
      description_html: {
        type: 'string',
        description:
          'New description with HTML formatting. Supports tags like <h2>, <p>, <ul>, <li>, <strong>, <em>, <a href="">. Takes precedence over description if both provided.',
      },
      assignee_id: {
        type: ['string', 'null'],
        description:
          'ID of the person to assign the task to, or null to unassign. If PRODUCTIVE_USER_ID is ' +
          'configured in environment, "me" resolves to that user.',
      },
      custom_fields: {
        type: 'object',
        additionalProperties: true,
        description:
          'Custom field values to set, keyed by custom field ID. Use list_custom_fields to find valid ' +
          'field IDs and list_custom_field_options to find valid option IDs for dropdown/select ' +
          "fields. The value shape depends on the field's type: a string for text fields, a number " +
          'for numeric fields, a boolean for checkboxes, an ISO date string (YYYY-MM-DD) for date ' +
          'fields, an array of option ID strings for dropdown/multi-select fields, or null to clear ' +
          'the field.',
      },
    },
    required: ['task_id'],
    examples: [
      { task_id: '123', assignee_id: 'me' },
      {
        task_id: '123',
        custom_fields: { '456': 'In Progress', '789': ['101', '102'] },
      },
    ],
  },
  annotations: { title: 'Update task', readOnlyHint: false, destructiveHint: false },
};

const deleteTaskSchema = z.object({
  task_id: z.string().min(1, 'Task ID is required'),
});

export async function deleteTaskTool(
  client: ProductiveAPIClient,
  args: unknown,
): Promise<{ content: Array<{ type: string; text: string }> }> {
  try {
    const params = deleteTaskSchema.parse(args);

    await client.deleteTask(params.task_id);

    return {
      content: [
        {
          type: 'text',
          text: `Task ${params.task_id} has been successfully deleted.`,
        },
      ],
    };
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

export const deleteTaskDefinition = {
  name: 'delete_task',
  description: 'Delete a task from Productive.io by its ID',
  inputSchema: {
    type: 'object',
    properties: {
      task_id: {
        type: 'string',
        description: 'The ID of the task to delete (required)',
      },
    },
    required: ['task_id'],
  },
  annotations: { title: 'Delete task', readOnlyHint: false, destructiveHint: true },
};
