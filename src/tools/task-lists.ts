import { z } from 'zod';
import { ProductiveAPIClient } from '../api/client.js';
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';

/** Coerce "true"/"false" strings to booleans (some MCP clients send strings). */
const coerceBoolean = z.preprocess(
  (v) => (v === 'true' ? true : v === 'false' ? false : v),
  z.boolean(),
);

const ListTaskListsSchema = z.object({
  board_id: z.string().optional().describe('Filter to Task Lists inside this board/Folder ID'),
  limit: z.coerce
    .number()
    .optional()
    .default(30)
    .describe('Max number of Task Lists to return (default 30, max 200)'),
});

export async function listTaskLists(
  client: ProductiveAPIClient,
  args: unknown,
): Promise<{ content: Array<{ type: string; text: string }> }> {
  try {
    const params = ListTaskListsSchema.parse(args || {});

    const response = await client.listTaskLists({
      board_id: params.board_id,
      limit: params.limit,
    });

    if (!response || !response.data || response.data.length === 0) {
      const filterText = params.board_id ? ` for board ${params.board_id}` : '';
      return {
        content: [
          {
            type: 'text',
            text: `No task lists found${filterText}`,
          },
        ],
      };
    }

    const taskListsText = response.data
      .filter((taskList) => taskList && taskList.attributes)
      .map((taskList) => {
        let text = `Task List: ${taskList.attributes.name} (ID: ${taskList.id})`;
        if (taskList.attributes.position !== undefined) {
          text += `\nPosition: ${taskList.attributes.position}`;
        }
        if (taskList.relationships?.board?.data?.id) {
          text += `\nBoard ID: ${taskList.relationships.board.data.id}`;
        }
        return text;
      })
      .join('\n\n');

    return {
      content: [
        {
          type: 'text',
          text: taskListsText,
        },
      ],
    };
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw new McpError(
        ErrorCode.InvalidParams,
        `Invalid parameters: ${error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join(', ')}`,
      );
    }

    if (error instanceof Error) {
      throw new McpError(ErrorCode.InternalError, `API error: ${error.message}`);
    }

    throw new McpError(ErrorCode.InternalError, 'Unknown error occurred while fetching task lists');
  }
}

export const listTaskListsTool = {
  name: 'list_task_lists',
  description:
    'List Task Lists. A Task List lives inside a Folder/Board and groups tasks -- it is NOT the Folder/Board itself. In the hierarchy Project -> Folder/Board -> Task List -> Task, task lists are the layer between a folder/board and its tasks. Pass board_id to get the task lists of one folder/board. Returns up to `limit` results (default 30, max 200).',
  inputSchema: {
    type: 'object',
    properties: {
      board_id: {
        type: 'string',
        description: 'Filter to Task Lists inside this board/Folder ID',
      },
      limit: {
        type: 'number',
        description: 'Max number of Task Lists to return (default 30, max 200)',
        default: 30,
      },
    },
  },
  annotations: { readOnlyHint: true },
};

const CreateTaskListSchema = z.object({
  board_id: z.string().describe('The ID of the board/Folder to create the Task List in'),
  project_id: z.string().describe('The ID of the project the board/Folder belongs to'),
  name: z.string().describe('Name for the new Task List'),
  description: z.string().optional().describe('Optional description of the Task List'),
});

export async function createTaskList(
  client: ProductiveAPIClient,
  args: unknown,
): Promise<{ content: Array<{ type: string; text: string }> }> {
  try {
    const params = CreateTaskListSchema.parse(args);

    const taskListData = {
      data: {
        type: 'task_lists' as const,
        attributes: {
          name: params.name,
          ...(params.description && { description: params.description }),
          position: 0,
          project_id: params.project_id,
        },
        relationships: {
          board: {
            data: {
              id: params.board_id,
              type: 'boards' as const,
            },
          },
        },
      },
    };

    const response = await client.createTaskList(taskListData);

    let text = `Task list created successfully!\n`;
    text += `Name: ${response.data.attributes.name} (ID: ${response.data.id})`;
    text += `\nBoard ID: ${params.board_id}`;

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
        `Invalid parameters: ${error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join(', ')}`,
      );
    }

    if (error instanceof Error) {
      throw new McpError(ErrorCode.InternalError, `API error: ${error.message}`);
    }

    throw new McpError(ErrorCode.InternalError, 'Unknown error occurred while creating task list');
  }
}

export const createTaskListTool = {
  name: 'create_task_list',
  description:
    'Create a new Task List inside a Folder/Board. This is a Task List, living inside a Folder/Board -- NOT the Folder/Board itself. Task lists group the tasks within a folder/board; this is the middle drill-down step create_folder -> create_task_list -> create_task.',
  inputSchema: {
    type: 'object',
    properties: {
      board_id: {
        type: 'string',
        description: 'The ID of the board/Folder to create the Task List in',
      },
      project_id: {
        type: 'string',
        description: 'The ID of the project the board/Folder belongs to',
      },
      name: {
        type: 'string',
        description: 'Name for the new Task List',
      },
      description: {
        type: 'string',
        description: 'Optional description of the Task List',
      },
    },
    required: ['board_id', 'project_id', 'name'],
  },
};

// --- Get Task List ---

const GetTaskListSchema = z.object({
  task_list_id: z.string().describe('The ID of the Task List to retrieve'),
});

export async function getTaskList(
  client: ProductiveAPIClient,
  args: unknown,
): Promise<{ content: Array<{ type: string; text: string }> }> {
  try {
    const params = GetTaskListSchema.parse(args);

    const response = await client.getTaskList(params.task_list_id);

    const taskList = response.data;
    let text = `Task List: ${taskList.attributes.name} (ID: ${taskList.id})`;
    if (taskList.attributes.position !== undefined) {
      text += `\nPosition: ${taskList.attributes.position}`;
    }
    if (taskList.relationships?.board?.data?.id) {
      text += `\nBoard ID: ${taskList.relationships.board.data.id}`;
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
        `Invalid parameters: ${error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join(', ')}`,
      );
    }

    if (error instanceof Error) {
      throw new McpError(ErrorCode.InternalError, `API error: ${error.message}`);
    }

    throw new McpError(ErrorCode.InternalError, 'Unknown error occurred while fetching task list');
  }
}

export const getTaskListTool = {
  name: 'get_task_list',
  description:
    'Get full details of one Task List by ID -- name, description, position, and its parent Board/Folder ID. This is a Task List, living inside a Folder/Board -- NOT the Folder/Board itself (use get_folder for those).',
  inputSchema: {
    type: 'object',
    properties: {
      task_list_id: {
        type: 'string',
        description: 'The ID of the Task List to retrieve',
      },
    },
    required: ['task_list_id'],
  },
};

export const getTaskListDefinition = getTaskListTool;

// --- Update Task List ---

const UpdateTaskListSchema = z.object({
  task_list_id: z.string().describe('The ID of the Task List to update'),
  name: z.string().optional().describe('New name for the Task List'),
});

export async function updateTaskList(
  client: ProductiveAPIClient,
  args: unknown,
): Promise<{ content: Array<{ type: string; text: string }> }> {
  try {
    const params = UpdateTaskListSchema.parse(args);

    const updateData = {
      data: {
        type: 'task_lists' as const,
        id: params.task_list_id,
        attributes: {
          ...(params.name && { name: params.name }),
        },
      },
    };

    const response = await client.updateTaskList(params.task_list_id, updateData);

    const taskList = response.data;
    let text = `Task list updated successfully!\n`;
    text += `Name: ${taskList.attributes.name} (ID: ${taskList.id})`;
    if (taskList.attributes.description) {
      text += `\nDescription: ${taskList.attributes.description}`;
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
        `Invalid parameters: ${error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join(', ')}`,
      );
    }

    if (error instanceof Error) {
      throw new McpError(ErrorCode.InternalError, `API error: ${error.message}`);
    }

    throw new McpError(ErrorCode.InternalError, 'Unknown error occurred while updating task list');
  }
}

export const updateTaskListTool = {
  name: 'update_task_list',
  description:
    'Rename an existing Task List by ID. This is a Task List, living inside a Folder/Board -- NOT the Folder/Board itself; use update_folder to rename a folder/board.',
  inputSchema: {
    type: 'object',
    properties: {
      task_list_id: {
        type: 'string',
        description: 'The ID of the Task List to update',
      },
      name: {
        type: 'string',
        description: 'New name for the Task List',
      },
    },
    required: ['task_list_id'],
  },
};

export const updateTaskListDefinition = updateTaskListTool;

// --- Archive Task List ---

const ArchiveTaskListSchema = z.object({
  task_list_id: z.string().describe('The ID of the Task List to archive'),
});

export async function archiveTaskList(
  client: ProductiveAPIClient,
  args: unknown,
): Promise<{ content: Array<{ type: string; text: string }> }> {
  try {
    const params = ArchiveTaskListSchema.parse(args);

    await client.archiveTaskList(params.task_list_id);

    return {
      content: [
        {
          type: 'text',
          text: `Task list ${params.task_list_id} archived successfully.`,
        },
      ],
    };
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw new McpError(
        ErrorCode.InvalidParams,
        `Invalid parameters: ${error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join(', ')}`,
      );
    }

    if (error instanceof Error) {
      throw new McpError(ErrorCode.InternalError, `API error: ${error.message}`);
    }

    throw new McpError(ErrorCode.InternalError, 'Unknown error occurred while archiving task list');
  }
}

export const archiveTaskListTool = {
  name: 'archive_task_list',
  description:
    'Archive a Task List by ID: hides it and its tasks from active board/folder views while preserving its data, so it can be brought back later with restore_task_list. This is a Task List, living inside a Folder/Board -- NOT the Folder/Board itself; use archive_folder to archive the whole folder/board.',
  inputSchema: {
    type: 'object',
    properties: {
      task_list_id: {
        type: 'string',
        description: 'The ID of the Task List to archive',
      },
    },
    required: ['task_list_id'],
  },
};

export const archiveTaskListDefinition = archiveTaskListTool;

// --- Restore Task List ---

const RestoreTaskListSchema = z.object({
  task_list_id: z.string().describe('The ID of the archived Task List to restore'),
});

export async function restoreTaskList(
  client: ProductiveAPIClient,
  args: unknown,
): Promise<{ content: Array<{ type: string; text: string }> }> {
  try {
    const params = RestoreTaskListSchema.parse(args);

    await client.restoreTaskList(params.task_list_id);

    return {
      content: [
        {
          type: 'text',
          text: `Task list ${params.task_list_id} restored successfully.`,
        },
      ],
    };
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw new McpError(
        ErrorCode.InvalidParams,
        `Invalid parameters: ${error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join(', ')}`,
      );
    }

    if (error instanceof Error) {
      throw new McpError(ErrorCode.InternalError, `API error: ${error.message}`);
    }

    throw new McpError(ErrorCode.InternalError, 'Unknown error occurred while restoring task list');
  }
}

export const restoreTaskListTool = {
  name: 'restore_task_list',
  description:
    'Restore a previously archived Task List by ID, bringing it and its tasks back into active board/folder views (reverses archive_task_list). This is a Task List, living inside a Folder/Board -- NOT the Folder/Board itself; use restore_folder for those.',
  inputSchema: {
    type: 'object',
    properties: {
      task_list_id: {
        type: 'string',
        description: 'The ID of the archived Task List to restore',
      },
    },
    required: ['task_list_id'],
  },
};

export const restoreTaskListDefinition = restoreTaskListTool;

// --- Copy Task List ---

const CopyTaskListSchema = z.object({
  name: z.string().describe('Name for the new (copied) Task List'),
  template_id: z
    .string()
    .describe('The ID of the source Task List to copy from (used as a template)'),
  project_id: z.string().describe('The ID of the project the new Task List will belong to'),
  board_id: z.string().describe('The ID of the board/Folder the new Task List will be created in'),
  copy_open_tasks: coerceBoolean
    .optional()
    .describe(
      'Whether to also copy the open (incomplete) tasks from the template into the new list',
    ),
  copy_assignees: coerceBoolean
    .optional()
    .describe('Whether to preserve task assignees when copying tasks from the template'),
});

export async function copyTaskList(
  client: ProductiveAPIClient,
  args: unknown,
): Promise<{ content: Array<{ type: string; text: string }> }> {
  try {
    const params = CopyTaskListSchema.parse(args);

    const response = await client.copyTaskList({
      name: params.name,
      template_id: params.template_id,
      project_id: params.project_id,
      board_id: params.board_id,
      ...(params.copy_open_tasks !== undefined && { copy_open_tasks: params.copy_open_tasks }),
      ...(params.copy_assignees !== undefined && { copy_assignees: params.copy_assignees }),
    });

    const taskList = response.data;
    let text = `Task list copied successfully!\n`;
    text += `Name: ${taskList.attributes.name} (ID: ${taskList.id})`;
    if (taskList.attributes.description) {
      text += `\nDescription: ${taskList.attributes.description}`;
    }
    text += `\nBoard ID: ${params.board_id}`;

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
        `Invalid parameters: ${error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join(', ')}`,
      );
    }

    if (error instanceof Error) {
      throw new McpError(ErrorCode.InternalError, `API error: ${error.message}`);
    }

    throw new McpError(ErrorCode.InternalError, 'Unknown error occurred while copying task list');
  }
}

export const copyTaskListTool = {
  name: 'copy_task_list',
  description:
    'Duplicate an existing Task List, used as a template, into a folder/board -- creating a new task list with the given name. This is a Task List, living inside a Folder/Board -- NOT the Folder/Board itself; use copy_folder to copy an entire folder/board.',
  inputSchema: {
    type: 'object',
    properties: {
      name: {
        type: 'string',
        description: 'Name for the new (copied) Task List',
      },
      template_id: {
        type: 'string',
        description: 'The ID of the source Task List to copy from (used as a template)',
      },
      project_id: {
        type: 'string',
        description: 'The ID of the project the new Task List will belong to',
      },
      board_id: {
        type: 'string',
        description: 'The ID of the board/Folder the new Task List will be created in',
      },
      copy_open_tasks: {
        type: 'boolean',
        description:
          'Whether to also copy the open (incomplete) tasks from the template into the new list',
      },
      copy_assignees: {
        type: 'boolean',
        description: 'Whether to preserve task assignees when copying tasks from the template',
      },
    },
    required: ['name', 'template_id', 'project_id', 'board_id'],
  },
};

export const copyTaskListDefinition = copyTaskListTool;

// --- Move Task List ---

const MoveTaskListSchema = z.object({
  task_list_id: z.string().describe('The ID of the Task List to move'),
  board_id: z
    .string()
    .describe('The ID of the destination board/Folder to move the Task List into'),
});

export async function moveTaskList(
  client: ProductiveAPIClient,
  args: unknown,
): Promise<{ content: Array<{ type: string; text: string }> }> {
  try {
    const params = MoveTaskListSchema.parse(args);

    await client.moveTaskList(params.task_list_id, params.board_id);

    return {
      content: [
        {
          type: 'text',
          text: `Task list ${params.task_list_id} moved to board ${params.board_id} successfully.`,
        },
      ],
    };
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw new McpError(
        ErrorCode.InvalidParams,
        `Invalid parameters: ${error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join(', ')}`,
      );
    }

    if (error instanceof Error) {
      throw new McpError(ErrorCode.InternalError, `API error: ${error.message}`);
    }

    throw new McpError(ErrorCode.InternalError, 'Unknown error occurred while moving task list');
  }
}

export const moveTaskListTool = {
  name: 'move_task_list',
  description:
    'Move a Task List, together with its tasks, to a different Folder/Board. This is a Task List, living inside a Folder/Board -- NOT the Folder/Board itself; use move_folder to move an entire folder/board between projects.',
  inputSchema: {
    type: 'object',
    properties: {
      task_list_id: {
        type: 'string',
        description: 'The ID of the Task List to move',
      },
      board_id: {
        type: 'string',
        description: 'The ID of the destination board/Folder to move the Task List into',
      },
    },
    required: ['task_list_id', 'board_id'],
  },
};

export const moveTaskListDefinition = moveTaskListTool;

// --- Reposition Task List ---

const RepositionTaskListSchema = z.object({
  task_list_id: z.string().describe('The ID of the Task List to reposition'),
  move_before_id: z
    .string()
    .describe('The ID of the Task List to place this one immediately before'),
});

export async function repositionTaskList(
  client: ProductiveAPIClient,
  args: unknown,
): Promise<{ content: Array<{ type: string; text: string }> }> {
  try {
    const params = RepositionTaskListSchema.parse(args);

    await client.repositionTaskList(params.task_list_id, params.move_before_id);

    return {
      content: [
        {
          type: 'text',
          text: `Task list ${params.task_list_id} repositioned before ${params.move_before_id} successfully.`,
        },
      ],
    };
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw new McpError(
        ErrorCode.InvalidParams,
        `Invalid parameters: ${error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join(', ')}`,
      );
    }

    if (error instanceof Error) {
      throw new McpError(ErrorCode.InternalError, `API error: ${error.message}`);
    }

    throw new McpError(
      ErrorCode.InternalError,
      'Unknown error occurred while repositioning task list',
    );
  }
}

export const repositionTaskListTool = {
  name: 'reposition_task_list',
  description:
    'Reorder a Task List within its Folder/Board by placing it immediately before another task list (changes display order only). This is a Task List, living inside a Folder/Board -- NOT the Folder/Board itself; use reposition_folder for those.',
  inputSchema: {
    type: 'object',
    properties: {
      task_list_id: {
        type: 'string',
        description: 'The ID of the Task List to reposition',
      },
      move_before_id: {
        type: 'string',
        description: 'The ID of the Task List to place this one immediately before',
      },
    },
    required: ['task_list_id', 'move_before_id'],
  },
};

export const repositionTaskListDefinition = repositionTaskListTool;
