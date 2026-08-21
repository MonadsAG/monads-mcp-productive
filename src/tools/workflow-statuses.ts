import { z } from 'zod';
import { ProductiveAPIClient } from '../api/client.js';
import { toMcpError } from '../utils/errors.js';

const listWorkflowStatusesSchema = z.object({
  workflow_id: z.string().optional(),
  category_id: z.coerce.number().int().min(1).max(3).optional(),
  limit: z.coerce.number().min(1).max(200).default(50).optional(),
});

export async function listWorkflowStatusesTool(
  client: ProductiveAPIClient,
  args: unknown,
): Promise<{ content: Array<{ type: string; text: string }> }> {
  try {
    const params = listWorkflowStatusesSchema.parse(args);

    const response = await client.listWorkflowStatuses({
      workflow_id: params.workflow_id,
      category_id: params.category_id,
      limit: params.limit,
    });

    if (!response.data || response.data.length === 0) {
      return {
        content: [
          {
            type: 'text',
            text: 'No workflow statuses found.',
          },
        ],
      };
    }

    const statusesText = response.data
      .map((status) => {
        const categoryName =
          status.attributes.category_id === 1
            ? 'Not Started'
            : status.attributes.category_id === 2
              ? 'Started'
              : status.attributes.category_id === 3
                ? 'Closed'
                : `Category ${status.attributes.category_id}`;

        return `• ${status.attributes.name} (ID: ${status.id})
  Category: ${categoryName} (${status.attributes.category_id})
  Workflow ID: ${status.relationships?.workflow?.data?.id || 'N/A'}
  Position: ${status.attributes.position || 'N/A'}`;
      })
      .join('\n\n');

    const summary = `Found ${response.data.length} workflow status${response.data.length !== 1 ? 'es' : ''}:\n\n${statusesText}`;

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

export const listWorkflowStatusesDefinition = {
  name: 'list_workflow_statuses',
  description:
    "List the workflow statuses defined in the workspace, each with its ID, name, and category (1=Not Started, 2=Started, 3=Closed). A status ID from here is the value you pass to update_task_status to move a task. Filter by workflow_id to see one board/workflow's statuses, or by category_id to see every status in one category.",
  inputSchema: {
    type: 'object',
    properties: {
      workflow_id: {
        type: 'string',
        description: 'Filter to a single workflow by its ID',
      },
      category_id: {
        type: 'number',
        description: 'Filter by category: 1=Not Started, 2=Started, 3=Closed',
        minimum: 1,
        maximum: 3,
      },
      limit: {
        type: 'number',
        description: 'Number of statuses to return (default 50, max 200)',
        minimum: 1,
        maximum: 200,
        default: 50,
      },
    },
  },
  annotations: { title: 'List workflow statuses', readOnlyHint: true, openWorldHint: true },
};
