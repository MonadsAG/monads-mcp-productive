import { z } from 'zod';
import { ProductiveAPIClient } from '../api/client.js';
import { buildIncludeMap, resolveName } from './include-resolver.js';
import { toMcpError } from '../utils/errors.js';

const listProjectsSchema = z.object({
  status: z.enum(['active', 'archived']).optional(),
  company_id: z.string().optional(),
  limit: z.coerce.number().min(1).max(200).default(30).optional(),
});

export async function listProjectsTool(
  client: ProductiveAPIClient,
  args: unknown,
): Promise<{ content: Array<{ type: string; text: string }> }> {
  try {
    const params = listProjectsSchema.parse(args || {});

    const response = await client.listProjects({
      status: params.status,
      company_id: params.company_id,
      limit: params.limit,
    });

    if (!response || !response.data || response.data.length === 0) {
      return {
        content: [
          {
            type: 'text',
            text: 'No projects found matching the criteria.',
          },
        ],
      };
    }

    const nameMap = buildIncludeMap(response.included);

    const projectsText = response.data
      .filter((project) => project && project.attributes)
      .map((project) => {
        const companyId = project.relationships?.company?.data?.id;
        const companyName = resolveName(nameMap, 'companies', companyId);
        return `• ${project.attributes.name} (ID: ${project.id})
  Status: ${project.attributes.status}
  ${companyName ? `Company: ${companyName}` : companyId ? `Company ID: ${companyId}` : ''}`;
      })
      .join('\n\n');

    const summary = `Found ${response.data.length} project${response.data.length !== 1 ? 's' : ''}${response.meta?.total_count ? ` (showing ${response.data.length} of ${response.meta.total_count})` : ''}:\n\n${projectsText}`;

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

export const listProjectsDefinition = {
  name: 'list_projects',
  description:
    "List projects, optionally filtered by company_id or by active/archived status. Each result includes the project's ID, status, and resolved company name. Use a project ID to scope list_tasks, list_folders, and list_custom_fields to that project — the typical drill-down is list_companies -> list_projects -> list_tasks. Returns 30 results by default; raise limit (max 200) for large workspaces.",
  inputSchema: {
    type: 'object',
    properties: {
      status: {
        type: 'string',
        enum: ['active', 'archived'],
        description: 'Filter by project status: active or archived',
      },
      company_id: {
        type: 'string',
        description: 'Filter projects to a single company (get the ID from list_companies)',
      },
      limit: {
        type: 'number',
        description: 'Number of projects to return (default 30, max 200)',
        minimum: 1,
        maximum: 200,
        default: 30,
      },
    },
  },
  annotations: { title: 'List projects', readOnlyHint: true, openWorldHint: true },
};
