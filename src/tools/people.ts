import { z } from 'zod';
import { ProductiveAPIClient } from '../api/client.js';
import { toMcpError } from '../utils/errors.js';

/** Coerce "true"/"false" strings to booleans (some MCP clients send strings). */
const coerceBoolean = z.preprocess(
  (v) => (v === 'true' ? true : v === 'false' ? false : v),
  z.boolean(),
);

const listPeopleSchema = z.object({
  company_id: z.string().optional(),
  project_id: z.string().optional(),
  is_active: coerceBoolean.default(true),
  email: z.string().optional(),
  limit: z.coerce.number().min(1).max(200).default(30),
});

const getPersonSchema = z.object({
  person_id: z.string().min(1, 'Person ID is required'),
});

export async function listPeopleTool(
  client: ProductiveAPIClient,
  args: unknown,
): Promise<{ content: Array<{ type: string; text: string }> }> {
  try {
    const params = listPeopleSchema.parse(args || {});

    const response = await client.listPeople({
      company_id: params.company_id,
      project_id: params.project_id,
      is_active: params.is_active,
      email: params.email,
      limit: params.limit,
    });

    if (!response || !response.data || response.data.length === 0) {
      return {
        content: [
          {
            type: 'text',
            text: 'No people found matching the criteria.',
          },
        ],
      };
    }

    const peopleText = response.data
      .filter((person) => person && person.attributes)
      .map((person) => {
        const attrs = person.attributes;
        const name = [attrs.first_name, attrs.last_name].filter(Boolean).join(' ');
        const lines = [`• ${name} (ID: ${person.id})`];

        if (attrs.email) lines.push(`  Email: ${attrs.email}`);
        if (attrs.title) lines.push(`  Title: ${attrs.title}`);
        lines.push(`  Active: ${attrs.deactivated_at ? 'no' : 'yes'}`);

        return lines.join('\n');
      })
      .join('\n\n');

    const summary = `Found ${response.data.length} ${response.data.length !== 1 ? 'people' : 'person'}${response.meta?.total_count ? ` (showing ${response.data.length} of ${response.meta.total_count})` : ''}:\n\n${peopleText}`;

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

export async function getPersonTool(
  client: ProductiveAPIClient,
  args: unknown,
): Promise<{ content: Array<{ type: string; text: string }> }> {
  try {
    const params = getPersonSchema.parse(args);

    const response = await client.getPerson(params.person_id);

    if (!response || !response.data) {
      return {
        content: [
          {
            type: 'text',
            text: `No person found with ID: ${params.person_id}`,
          },
        ],
      };
    }

    const person = response.data;
    const attrs = person.attributes;
    const name = [attrs.first_name, attrs.last_name].filter(Boolean).join(' ');

    const lines = [`${name} (ID: ${person.id})`, `Email: ${attrs.email}`];

    if (attrs.title) lines.push(`Title: ${attrs.title}`);
    lines.push(`Active: ${attrs.deactivated_at ? 'no' : 'yes'}`);
    if (attrs.created_at) lines.push(`Created: ${attrs.created_at}`);

    return {
      content: [
        {
          type: 'text',
          text: lines.join('\n'),
        },
      ],
    };
  } catch (error) {
    throw toMcpError(error);
  }
}

export const listPeopleDefinition = {
  name: 'list_people',
  description:
    'List people/members in the organization. Use project_id to see who is on a specific project, or company_id to filter by client. Returns person IDs usable anywhere a person_id is required (e.g. create_time_entry, task assignment).',
  inputSchema: {
    type: 'object',
    properties: {
      company_id: {
        type: 'string',
        description: 'Filter people by company ID',
      },
      project_id: {
        type: 'string',
        description: 'Filter people by project ID (shows who is on a project)',
      },
      is_active: {
        type: 'boolean',
        description: 'Filter by active status (default: true)',
        default: true,
      },
      email: {
        type: 'string',
        description: 'Filter by email address',
      },
      limit: {
        type: 'number',
        description: 'Number of people to return (1-200, default 30)',
        minimum: 1,
        maximum: 200,
        default: 30,
      },
    },
  },
  annotations: { readOnlyHint: true },
};

export const getPersonDefinition = {
  name: 'get_person',
  description: 'Get details of a specific person by their ID.',
  inputSchema: {
    type: 'object',
    properties: {
      person_id: {
        type: 'string',
        description: 'The ID of the person to retrieve (required)',
      },
    },
    required: ['person_id'],
  },
  annotations: { readOnlyHint: true },
};
