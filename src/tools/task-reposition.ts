import { z } from 'zod';
import type { ProductiveAPIClient } from '../api/client.js';
import type { TaskReposition } from '../api/types.js';
import { toMcpError } from '../utils/errors.js';

/** Coerce "true"/"false" strings to booleans (some MCP clients send strings). */
const coerceBoolean = z.preprocess(
  (v) => (v === 'true' ? true : v === 'false' ? false : v),
  z.boolean(),
);

export const taskRepositionSchema = z.object({
  taskId: z.string().describe('The ID of the task to reposition'),
  move_before_id: z.string().optional().describe('Position the task before this task ID'),
  move_after_id: z.string().optional().describe('Position the task after this task ID'),
  moveToTop: coerceBoolean.optional().describe('Move the task to the top of its list'),
  moveToBottom: coerceBoolean.optional().describe('Move the task to the bottom of its list'),
});

export const repositionTask = async (
  apiClient: ProductiveAPIClient,
  data: z.infer<typeof taskRepositionSchema>,
) => {
  const { taskId, move_before_id, move_after_id, moveToTop, moveToBottom } = data;

  // Get the current task to determine its task list
  const currentTask = await apiClient.getTask(taskId);

  // Check if the task list ID is available in the response
  const taskListId = currentTask.data.relationships?.task_list?.data?.id;

  // If we can't find the task list ID, we'll try a different approach
  if (!taskListId) {
    console.warn('Task list ID not found for task', taskId);

    // Get all tasks and try to find suitable ones to position against
    const allTasks = await apiClient.listTasks({
      limit: 100,
    });

    // Filter out the current task from the list
    const otherTasks = allTasks.data.filter((task) => task.id !== taskId);

    // Move to top of list (find task with lowest placement and move before it)
    if (moveToTop && otherTasks.length > 0) {
      const sortedTasks = [...otherTasks].sort((a, b) => {
        const placementA = a.attributes.placement || 0;
        const placementB = b.attributes.placement || 0;
        return placementA - placementB;
      });

      if (sortedTasks.length > 0) {
        return await apiClient.repositionTask(taskId, {
          move_before_id: sortedTasks[0].id,
        });
      }
    }

    // Move to bottom of list (find task with highest placement and move after it)
    if (moveToBottom && otherTasks.length > 0) {
      const sortedTasks = [...otherTasks].sort((a, b) => {
        const placementA = a.attributes.placement || 0;
        const placementB = b.attributes.placement || 0;
        return placementB - placementA; // Descending order
      });

      if (sortedTasks.length > 0) {
        return await apiClient.repositionTask(taskId, {
          move_after_id: sortedTasks[0].id,
        });
      }
    }
  } else {
    // We have a task list ID, so we can filter tasks by that list
    const tasksInList = await apiClient.listTasks({
      limit: 100,
    });

    // Filter tasks in the same list
    const tasksInSameList = tasksInList.data.filter(
      (task) => task.relationships?.task_list?.data?.id === taskListId && task.id !== taskId, // Exclude the current task
    );

    // Move to top of list
    if (moveToTop && tasksInSameList.length > 0) {
      const sortedTasks = [...tasksInSameList].sort((a, b) => {
        const placementA = a.attributes.placement || 0;
        const placementB = b.attributes.placement || 0;
        return placementA - placementB;
      });

      if (sortedTasks.length > 0) {
        return await apiClient.repositionTask(taskId, {
          move_before_id: sortedTasks[0].id,
        });
      }
    }

    // Move to bottom of list
    if (moveToBottom && tasksInSameList.length > 0) {
      const sortedTasks = [...tasksInSameList].sort((a, b) => {
        const placementA = a.attributes.placement || 0;
        const placementB = b.attributes.placement || 0;
        return placementB - placementA; // Descending order
      });

      if (sortedTasks.length > 0) {
        return await apiClient.repositionTask(taskId, {
          move_after_id: sortedTasks[0].id,
        });
      }
    }
  }

  // Handle explicit positioning parameters if provided
  if (move_before_id || move_after_id) {
    const attributes: TaskReposition = {};
    if (move_before_id) attributes.move_before_id = move_before_id;
    if (move_after_id) attributes.move_after_id = move_after_id;
    return await apiClient.repositionTask(taskId, attributes);
  }

  // As a last resort, try default API behavior with empty attributes
  console.warn('Using default repositioning with empty attributes');
  return await apiClient.repositionTask(taskId, {});
};

export const taskRepositionDefinition = {
  name: 'reposition_task',
  description:
    'Move a task to a specific position within its task list. Provide exactly one positioning method: ' +
    'move_before_id/move_after_id (place relative to another task) OR moveToTop/moveToBottom (place at an end). ' +
    "Does not change the task's assignee, status, or list membership -- use move_task_to_list for that.",
  inputSchema: {
    type: 'object',
    properties: {
      taskId: {
        type: 'string',
        description: 'The ID of the task to reposition',
      },
      move_before_id: {
        type: 'string',
        description:
          'Place the task immediately before this task ID in the list. Do not combine with moveToTop/moveToBottom.',
      },
      move_after_id: {
        type: 'string',
        description:
          'Place the task immediately after this task ID in the list. Do not combine with moveToTop/moveToBottom.',
      },
      moveToTop: {
        type: 'boolean',
        description:
          'Move the task to the top of its list. Use instead of move_before_id/move_after_id, not together.',
      },
      moveToBottom: {
        type: 'boolean',
        description:
          'Move the task to the bottom of its list. Use instead of move_before_id/move_after_id, not together.',
      },
    },
    required: ['taskId'],
    examples: [
      { taskId: '123', move_before_id: '456' },
      { taskId: '123', moveToTop: true },
    ],
  },
};

export const taskRepositionTool = async (
  apiClient: ProductiveAPIClient,
  args: z.infer<typeof taskRepositionSchema>,
) => {
  try {
    const result = await repositionTask(apiClient, args);

    // Format the response to match the MCP tool expected format
    // Handle the new response format which is a success object
    if (result.success) {
      return {
        content: [
          {
            type: 'text',
            text: `Task ${args.taskId} repositioned successfully.
The task has been moved ${
              args.moveToTop
                ? 'to the top of the list'
                : args.moveToBottom
                  ? 'to the bottom of the list'
                  : args.move_before_id
                    ? `before task ${args.move_before_id}`
                    : args.move_after_id
                      ? `after task ${args.move_after_id}`
                      : 'to a new position'
            }.`,
          },
        ],
      };
    } else if (result.data) {
      // Fallback for old response format if somehow returned
      return {
        content: [
          {
            type: 'text',
            text: `Task ${result.data.id} repositioned successfully.
Title: ${result.data.attributes?.title || 'Unknown'}
Position updated according to the requested parameters.`,
          },
        ],
      };
    } else {
      // Generic success if neither format is matched
      return {
        content: [
          {
            type: 'text',
            text: `Task repositioning operation completed successfully.`,
          },
        ],
      };
    }
  } catch (error) {
    // This used to return the failure as a *successful* tool result -- error
    // text in a content block, no isError flag -- so a client and the model both
    // read a failed reposition as a completed one. Throw like every other tool.
    throw toMcpError(error);
  }
};
