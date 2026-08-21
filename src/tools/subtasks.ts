import { z } from 'zod';
import { ProductiveAPIClient } from '../api/client.js';
import { ProductiveIncludedResource } from '../api/types.js';
import { toMcpError } from '../utils/errors.js';

function resolvePersonName(
  personId: string | undefined,
  included?: ProductiveIncludedResource[],
): string | undefined {
  if (!personId || !included) return undefined;
  const person = included.find((item) => item.type === 'people' && item.id === personId);
  if (!person) return undefined;
  const first = person.attributes.first_name || '';
  const last = person.attributes.last_name || '';
  return `${first} ${last}`.trim() || undefined;
}

function resolveWorkflowStatus(
  task: { relationships?: Record<string, any> },
  included?: ProductiveIncludedResource[],
): string | undefined {
  const statusId = task.relationships?.workflow_status?.data?.id;
  if (!statusId || !included) return undefined;
  const status = included.find((item) => item.type === 'workflow_statuses' && item.id === statusId);
  return status?.attributes?.name || undefined;
}

const listSubtasksSchema = z.object({
  parent_task_id: z.string().min(1, 'Parent task ID is required'),
  limit: z.coerce.number().min(1).max(200).default(30).optional(),
  page: z.coerce.number().min(1).default(1).optional(),
});

export async function listSubtasksTool(
  client: ProductiveAPIClient,
  args: unknown,
): Promise<{ content: Array<{ type: string; text: string }> }> {
  try {
    const params = listSubtasksSchema.parse(args || {});

    const limit = params.limit ?? 30;
    const page = params.page ?? 1;

    const data = await client.listTasks({
      parent_task_id: params.parent_task_id,
      limit,
      page,
    });

    if (!data.data || data.data.length === 0) {
      return {
        content: [
          {
            type: 'text',
            text: `No subtasks found for parent task ${params.parent_task_id}.`,
          },
        ],
      };
    }

    const tasksText = data.data
      .filter((task) => task && task.attributes)
      .map((task) => {
        const projectId = task.relationships?.project?.data?.id;
        const assigneeId = task.relationships?.assignee?.data?.id;
        const assigneeName = resolvePersonName(assigneeId, data.included);
        const workflowStatusName = resolveWorkflowStatus(task, data.included);
        const fallbackStatus =
          task.attributes.status === 1
            ? 'open'
            : task.attributes.status === 2
              ? 'closed'
              : `status ${task.attributes.status}`;
        const statusText = workflowStatusName || fallbackStatus;
        const assigneeDisplay = assigneeName
          ? `Assignee: ${assigneeName} (ID: ${assigneeId})`
          : assigneeId
            ? `Assignee ID: ${assigneeId}`
            : 'Unassigned';
        return `• ${task.attributes.title} (ID: ${task.id})
  Status: ${statusText}
  ${task.attributes.due_date ? `Due: ${task.attributes.due_date}` : 'No due date'}
  ${projectId ? `Project ID: ${projectId}` : ''}
  ${assigneeDisplay}
  ${task.attributes.description ? `Description: ${task.attributes.description}` : ''}`;
      })
      .join('\n\n');

    const total = data.meta?.total_count;
    const summary = `Found ${data.data.length} subtask${data.data.length !== 1 ? 's' : ''} for parent task ${params.parent_task_id}${total ? ` (showing ${data.data.length} of ${total})` : ''}:\n\n${tasksText}`;

    return {
      content: [
        {
          type: 'text',
          text: summary,
        },
      ],
    };
  } catch (error) {
    throw toMcpError(error);
  }
}

export const listSubtasksDefinition = {
  name: 'list_subtasks',
  description:
    'List the child subtasks nested under a specific parent task (its ID goes in parent_task_id). ' +
    "Use this to see the breakdown items beneath a task; use get_task for the parent's own details, or " +
    'list_tasks/get_project_tasks to find top-level tasks. Paginated (default 30 per page, max 200).',
  inputSchema: {
    type: 'object',
    properties: {
      parent_task_id: {
        type: 'string',
        description: 'The ID of the parent task (required)',
      },
      limit: {
        type: 'number',
        description: 'Number of subtasks to return (1-200, default: 30)',
        minimum: 1,
        maximum: 200,
        default: 30,
      },
      page: {
        type: 'number',
        description: 'Page number for pagination (default: 1)',
        minimum: 1,
        default: 1,
      },
    },
    required: ['parent_task_id'],
  },
  annotations: { title: 'List subtasks', readOnlyHint: true, openWorldHint: true },
};

const createSubtaskSchema = z.object({
  parent_task_id: z.string().min(1, 'Parent task ID is required'),
  title: z.string().min(1, 'Task title is required'),
  description: z.string().optional(),
  project_id: z.string().optional(),
  task_list_id: z.string().optional(),
  assignee_id: z.string().optional(),
  due_date: z.string().optional(),
});

export async function createSubtaskTool(
  client: ProductiveAPIClient,
  args: unknown,
): Promise<{ content: Array<{ type: string; text: string }> }> {
  try {
    const params = createSubtaskSchema.parse(args || {});

    const taskData: any = {
      data: {
        type: 'tasks' as const,
        attributes: {
          title: params.title,
          description: params.description,
          due_date: params.due_date,
          status: 1,
        },
        relationships: {
          parent_task: {
            data: {
              type: 'tasks',
              id: params.parent_task_id,
            },
          },
        },
      },
    };

    if (params.project_id) {
      taskData.data.relationships.project = {
        data: { id: params.project_id, type: 'projects' as const },
      };
    }

    if (params.task_list_id) {
      taskData.data.relationships.task_list = {
        data: { id: params.task_list_id, type: 'task_lists' as const },
      };
    }

    if (params.assignee_id) {
      taskData.data.relationships.assignee = {
        data: { id: params.assignee_id, type: 'people' as const },
      };
    }

    const response = await client.createTask(taskData);

    let text = `Subtask created successfully!\n`;
    text += `Title: ${response.data.attributes.title} (ID: ${response.data.id})\n`;
    text += `Parent Task ID: ${params.parent_task_id}\n`;
    if (response.data.attributes.description) {
      text += `Description: ${response.data.attributes.description}\n`;
    }
    const statusText = response.data.attributes.status === 1 ? 'open' : 'closed';
    text += `Status: ${statusText}\n`;
    if (response.data.attributes.due_date) {
      text += `Due date: ${response.data.attributes.due_date}\n`;
    }
    if (params.project_id) {
      text += `Project ID: ${params.project_id}\n`;
    }
    if (params.task_list_id) {
      text += `Task List ID: ${params.task_list_id}\n`;
    }
    if (params.assignee_id) {
      text += `Assignee ID: ${params.assignee_id}\n`;
    }
    if (response.data.attributes.created_at) {
      text += `Created at: ${response.data.attributes.created_at}\n`;
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
    throw toMcpError(error);
  }
}

export const createSubtaskDefinition = {
  name: 'create_subtask',
  description:
    'Create a new task nested under an existing parent task (set parent_task_id). ' +
    'Use this instead of create_task when the task should appear as a child/subtask; create_task makes a top-level task. ' +
    'Nothing is inherited from the parent automatically — pass project_id, task_list_id, or assignee_id explicitly if you need them set.',
  inputSchema: {
    type: 'object',
    properties: {
      parent_task_id: {
        type: 'string',
        description: 'The ID of the parent task (required)',
      },
      title: {
        type: 'string',
        description: 'Subtask title (required)',
      },
      description: {
        type: 'string',
        description: 'Subtask description',
      },
      project_id: {
        type: 'string',
        description: 'ID of the project to add the subtask to',
      },
      task_list_id: {
        type: 'string',
        description: 'ID of the task list to add the subtask to',
      },
      assignee_id: {
        type: 'string',
        description: 'ID of the person to assign the subtask to',
      },
      due_date: {
        type: 'string',
        description: 'Due date in YYYY-MM-DD format',
      },
    },
    required: ['parent_task_id', 'title'],
  },
  annotations: {
    title: 'Create subtask',
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: true,
  },
};
