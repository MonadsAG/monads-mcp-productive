import { z } from 'zod';
import { ProductiveAPIClient } from '../api/client.js';
import { buildIncludeMap, resolveName } from './include-resolver.js';
import { toMcpError } from '../utils/errors.js';

/** Coerce "true"/"false" strings to booleans (some MCP clients send strings). */
const coerceBoolean = z.preprocess(
  (v) => (v === 'true' ? true : v === 'false' ? false : v),
  z.boolean(),
);

// ---- Schemas ----

const listTodosSchema = z.object({
  task_id: z.string().optional(),
  status: z.enum(['open', 'closed']).optional(),
  limit: z.coerce.number().min(1).max(200).default(50).optional(),
});

const getTodoSchema = z.object({
  todo_id: z.string().min(1, 'Todo ID is required'),
});

const createTodoSchema = z.object({
  description: z.string().min(1, 'Description is required'),
  task_id: z.string().optional(),
  deal_id: z.string().optional(),
  assignee_id: z.string().optional(),
  due_date: z.string().optional(),
});

const updateTodoSchema = z.object({
  todo_id: z.string().min(1, 'Todo ID is required'),
  description: z.string().optional(),
  closed: coerceBoolean.optional(),
  due_date: z.string().optional(),
});

const deleteTodoSchema = z.object({
  todo_id: z.string().min(1, 'Todo ID is required'),
});

// ---- Handlers ----

export async function listTodosTool(
  client: ProductiveAPIClient,
  args: unknown,
): Promise<{ content: Array<{ type: string; text: string }> }> {
  try {
    const params = listTodosSchema.parse(args);

    const queryParams: Record<string, unknown> = {};
    if (params.task_id) queryParams.task_id = params.task_id;
    if (params.status) queryParams.status = params.status === 'open' ? 1 : 2;
    if (params.limit) queryParams.limit = params.limit;

    const response = await client.listTodos(queryParams);

    if (!response.data || response.data.length === 0) {
      return {
        content: [{ type: 'text', text: 'No todos found matching the criteria.' }],
      };
    }

    let text = `Found ${response.data.length} todo(s):\n\n`;

    const nameMap = buildIncludeMap(response.included);

    for (const todo of response.data) {
      const attrs = todo.attributes;
      const closedStatus = attrs.closed ? 'Closed' : 'Open';
      const assigneeId = todo.relationships?.assignee?.data?.id;
      const taskId = todo.relationships?.task?.data?.id;
      const dealId = todo.relationships?.deal?.data?.id;
      const assigneeName = resolveName(nameMap, 'people', assigneeId);
      const taskName = resolveName(nameMap, 'tasks', taskId);
      const dealName = resolveName(nameMap, 'deals', dealId);

      text += `- [${closedStatus}] ${attrs.description}\n`;
      text += `  ID: ${todo.id}\n`;
      if (attrs.due_date) text += `  Due: ${attrs.due_date}\n`;
      if (assigneeName) text += `  Assignee: ${assigneeName}\n`;
      else if (assigneeId) text += `  Assignee ID: ${assigneeId}\n`;
      if (taskName) text += `  Task: ${taskName}\n`;
      else if (taskId) text += `  Task ID: ${taskId}\n`;
      if (dealName) text += `  Deal: ${dealName}\n`;
      else if (dealId) text += `  Deal ID: ${dealId}\n`;
      text += `\n`;
    }

    return {
      content: [{ type: 'text', text: text.trimEnd() }],
    };
  } catch (error) {
    throw toMcpError(error);
  }
}

export async function getTodoTool(
  client: ProductiveAPIClient,
  args: unknown,
): Promise<{ content: Array<{ type: string; text: string }> }> {
  try {
    const params = getTodoSchema.parse(args);
    const response = await client.getTodo(params.todo_id);
    const todo = response.data;
    const attrs = todo.attributes;

    let text = `Todo: ${attrs.description}\n`;
    text += `ID: ${todo.id}\n`;
    text += `Status: ${attrs.closed ? 'Closed' : 'Open'}\n`;
    if (attrs.closed_at) text += `Closed at: ${attrs.closed_at}\n`;
    if (attrs.due_date) text += `Due date: ${attrs.due_date}\n`;
    if (attrs.due_time) text += `Due time: ${attrs.due_time}\n`;
    text += `Created at: ${attrs.created_at}\n`;
    if (attrs.todoable_type) text += `Todoable type: ${attrs.todoable_type}\n`;
    if (attrs.position !== undefined) text += `Position: ${attrs.position}\n`;

    const nameMap = buildIncludeMap(response.included);
    const taskId = todo.relationships?.task?.data?.id;
    const dealId = todo.relationships?.deal?.data?.id;
    const assigneeId = todo.relationships?.assignee?.data?.id;

    if (taskId) {
      const taskName = resolveName(nameMap, 'tasks', taskId);
      text += taskName ? `Task: ${taskName}\n` : `Task ID: ${taskId}\n`;
    }
    if (dealId) {
      const dealName = resolveName(nameMap, 'deals', dealId);
      text += dealName ? `Deal: ${dealName}\n` : `Deal ID: ${dealId}\n`;
    }
    if (assigneeId) {
      const assigneeName = resolveName(nameMap, 'people', assigneeId);
      text += assigneeName ? `Assignee: ${assigneeName}\n` : `Assignee ID: ${assigneeId}\n`;
    }

    return {
      content: [{ type: 'text', text: text.trimEnd() }],
    };
  } catch (error) {
    throw toMcpError(error);
  }
}

export async function createTodoTool(
  client: ProductiveAPIClient,
  args: unknown,
): Promise<{ content: Array<{ type: string; text: string }> }> {
  try {
    const params = createTodoSchema.parse(args);

    const relationships: Record<string, { data: { id: string; type: string } }> = {};
    if (params.task_id) {
      relationships.task = { data: { id: params.task_id, type: 'tasks' } };
    }
    if (params.deal_id) {
      relationships.deal = { data: { id: params.deal_id, type: 'deals' } };
    }
    if (params.assignee_id) {
      relationships.assignee = { data: { id: params.assignee_id, type: 'people' } };
    }

    const todoData = {
      data: {
        type: 'todos' as const,
        attributes: {
          description: params.description,
          ...(params.due_date ? { due_date: params.due_date } : {}),
        },
        relationships,
      },
    };

    const response = await client.createTodo(todoData);
    const todo = response.data;

    let text = `Todo created successfully!\n`;
    text += `ID: ${todo.id}\n`;
    text += `Description: ${todo.attributes.description}`;
    if (todo.attributes.due_date) text += `\nDue date: ${todo.attributes.due_date}`;

    return {
      content: [{ type: 'text', text }],
    };
  } catch (error) {
    throw toMcpError(error);
  }
}

export async function updateTodoTool(
  client: ProductiveAPIClient,
  args: unknown,
): Promise<{ content: Array<{ type: string; text: string }> }> {
  try {
    const params = updateTodoSchema.parse(args);

    const attributes: Record<string, unknown> = {};
    if (params.description !== undefined) attributes.description = params.description;
    if (params.closed !== undefined) attributes.closed = params.closed;
    if (params.due_date !== undefined) attributes.due_date = params.due_date;

    const todoData = {
      data: {
        type: 'todos' as const,
        id: params.todo_id,
        attributes,
      },
    };

    const response = await client.updateTodo(params.todo_id, todoData);
    const todo = response.data;

    let text = `Todo updated successfully!\n`;
    text += `ID: ${todo.id}\n`;
    text += `Description: ${todo.attributes.description}\n`;
    text += `Status: ${todo.attributes.closed ? 'Closed' : 'Open'}`;
    if (todo.attributes.due_date) text += `\nDue date: ${todo.attributes.due_date}`;

    return {
      content: [{ type: 'text', text }],
    };
  } catch (error) {
    throw toMcpError(error);
  }
}

export async function deleteTodoTool(
  client: ProductiveAPIClient,
  args: unknown,
): Promise<{ content: Array<{ type: string; text: string }> }> {
  try {
    const params = deleteTodoSchema.parse(args);
    await client.deleteTodo(params.todo_id);

    return {
      content: [{ type: 'text', text: `Todo ${params.todo_id} deleted successfully.` }],
    };
  } catch (error) {
    throw toMcpError(error);
  }
}

// ---- Definitions ----

export const listTodosDefinition = {
  name: 'list_todos',
  description:
    'List todo checklist items, each showing its open/closed state, description, due date, and resolved assignee/task/deal names. Filter by task_id and/or status. This is the entry point of the list_todos -> get_todo -> update_todo drill-down. Returns up to `limit` todos (default 50).',
  inputSchema: {
    type: 'object',
    properties: {
      task_id: {
        type: 'string',
        description: 'Filter to todos attached to a single task',
      },
      status: {
        type: 'string',
        enum: ['open', 'closed'],
        description: 'Filter by state: "open" for outstanding todos, "closed" for completed ones',
      },
      limit: {
        type: 'number',
        description: 'Maximum number of todos to return (1-200, default 50)',
      },
    },
    required: [],
  },
};

export const getTodoDefinition = {
  name: 'get_todo',
  description:
    'Fetch one todo by ID with its full detail — description, open/closed state and closed_at, due date and time, position, and linked task/deal/assignee. Use after list_todos to inspect a single item before editing it with update_todo.',
  inputSchema: {
    type: 'object',
    properties: {
      todo_id: {
        type: 'string',
        description: 'ID of the todo to retrieve (required)',
      },
    },
    required: ['todo_id'],
  },
};

export const createTodoDefinition = {
  name: 'create_todo',
  description:
    'Create a todo checklist item, attaching it to a task and/or deal and optionally assigning it to a person with a due date. New todos start open; use update_todo later to close it or change its text.',
  inputSchema: {
    type: 'object',
    properties: {
      description: {
        type: 'string',
        description: 'Text of the todo item (required)',
      },
      task_id: {
        type: 'string',
        description: 'ID of the task to attach this todo to',
      },
      deal_id: {
        type: 'string',
        description: 'ID of the deal to attach this todo to',
      },
      assignee_id: {
        type: 'string',
        description: 'ID of the person to assign this todo to',
      },
      due_date: {
        type: 'string',
        description: 'Due date in YYYY-MM-DD format',
      },
    },
    required: ['description'],
  },
};

export const updateTodoDefinition = {
  name: 'update_todo',
  description:
    'Edit an existing todo: change its description or due date, or set closed=true to mark it done (closed=false reopens it) — the equivalent of ticking or unticking its checkbox. Omit a field to leave it unchanged. To remove a todo entirely rather than complete it, use delete_todo.',
  inputSchema: {
    type: 'object',
    properties: {
      todo_id: {
        type: 'string',
        description: 'ID of the todo to update (required)',
      },
      description: {
        type: 'string',
        description: 'Updated text for the todo',
      },
      closed: {
        type: 'boolean',
        description: 'Set true to close/complete the todo, false to reopen it',
      },
      due_date: {
        type: 'string',
        description: 'Updated due date in YYYY-MM-DD format',
      },
    },
    required: ['todo_id'],
  },
};

export const deleteTodoDefinition = {
  name: 'delete_todo',
  description:
    'Delete a todo, removing it from its task or deal entirely. This is distinct from completing it: to tick it off the checklist while keeping it, use update_todo with closed=true instead. The delete is not undoable through this server.',
  inputSchema: {
    type: 'object',
    properties: {
      todo_id: {
        type: 'string',
        description: 'ID of the todo to delete (required)',
      },
    },
    required: ['todo_id'],
  },
};
