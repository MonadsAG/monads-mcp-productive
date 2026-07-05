import { z } from 'zod';
import { ProductiveAPIClient } from '../api/client.js';
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';

const listCustomFieldsSchema = z.object({
  name: z.string().optional(),
  project_id: z.string().optional(),
  customizable_type: z.string().optional(),
  archived: z.boolean().optional(),
  global: z.boolean().optional(),
});

export async function listCustomFieldsTool(
  client: ProductiveAPIClient,
  args: unknown,
): Promise<{ content: Array<{ type: string; text: string }> }> {
  try {
    const params = listCustomFieldsSchema.parse(args || {});

    const response = await client.listCustomFields({
      name: params.name,
      projectId: params.project_id,
      customizableType: params.customizable_type,
      archived: params.archived,
      global: params.global,
    });

    if (!response || !response.data || response.data.length === 0) {
      return {
        content: [
          {
            type: 'text',
            text: 'No custom fields found.',
          },
        ],
      };
    }

    const fieldsText = response.data
      .filter((field) => field && field.attributes)
      .map((field) => {
        let line = `- ${field.attributes.name} (ID: ${field.id})`;
        if (field.attributes.data_type_id !== undefined && field.attributes.data_type_id !== null) {
          line += `\n  Data type ID: ${field.attributes.data_type_id}`;
        }
        if (field.attributes.customizable_type) {
          line += `\n  Applies to: ${field.attributes.customizable_type}`;
        }
        line += `\n  Raw attributes: ${JSON.stringify(field.attributes)}`;
        return line;
      })
      .join('\n\n');

    return {
      content: [
        {
          type: 'text',
          text: `Found ${response.data.length} custom field${response.data.length !== 1 ? 's' : ''}:\n\n${fieldsText}`,
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

    if (error instanceof McpError) {
      throw error;
    }

    throw new McpError(
      ErrorCode.InternalError,
      error instanceof Error ? error.message : 'Unknown error occurred',
    );
  }
}

export const listCustomFieldsDefinition = {
  name: 'list_custom_fields',
  description:
    'Step 1 of working with custom fields: discover the custom fields defined in Productive.io ' +
    '(e.g. for tasks) and their field IDs. For dropdown/multi-select fields, follow up with ' +
    'list_custom_field_options to get the valid option IDs. The field ID (and any option IDs) then ' +
    'feed the custom_fields object of create_task / update_task. NOTE: the generated OpenAPI spec for ' +
    'the custom_fields resource does not document exact attribute names, so this tool renders the full ' +
    'raw attributes defensively alongside the commonly expected ones.',
  inputSchema: {
    type: 'object',
    properties: {
      name: {
        type: 'string',
        description: 'Filter by (partial) custom field name.',
      },
      project_id: {
        type: 'string',
        description: 'Filter by the project the custom field is scoped to.',
      },
      customizable_type: {
        type: 'string',
        description:
          'Filter by the entity type the field applies to. Values are lowercase plural, e.g. ' +
          '"tasks" (not "Task"). Used to find valid custom_field IDs for a given entity before ' +
          'calling create_task / update_task.',
      },
      archived: {
        type: 'boolean',
        description: 'Filter by archived status.',
      },
      global: {
        type: 'boolean',
        description: 'Filter by whether the field is global (applies across all projects).',
      },
    },
  },
  annotations: { readOnlyHint: true },
};

const listCustomFieldOptionsSchema = z.object({
  custom_field_id: z.string().min(1, 'custom_field_id is required'),
  archived: z.boolean().optional(),
});

export async function listCustomFieldOptionsTool(
  client: ProductiveAPIClient,
  args: unknown,
): Promise<{ content: Array<{ type: string; text: string }> }> {
  try {
    const params = listCustomFieldOptionsSchema.parse(args);

    const response = await client.listCustomFieldOptions({
      customFieldId: params.custom_field_id,
      archived: params.archived,
    });

    if (!response || !response.data || response.data.length === 0) {
      return {
        content: [
          {
            type: 'text',
            text: `No custom field options found for custom field ${params.custom_field_id}.`,
          },
        ],
      };
    }

    const optionsText = response.data
      .filter((option) => option && option.attributes)
      .map((option) => {
        const label = option.attributes.name ?? JSON.stringify(option.attributes);
        return `- ${label} (ID: ${option.id})`;
      })
      .join('\n');

    return {
      content: [
        {
          type: 'text',
          text: `Found ${response.data.length} option${response.data.length !== 1 ? 's' : ''} for custom field ${params.custom_field_id}:\n\n${optionsText}`,
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

    if (error instanceof McpError) {
      throw error;
    }

    throw new McpError(
      ErrorCode.InternalError,
      error instanceof Error ? error.message : 'Unknown error occurred',
    );
  }
}

export const listCustomFieldOptionsDefinition = {
  name: 'list_custom_field_options',
  description:
    'Step 2 of working with custom fields: after list_custom_fields (step 1) gives you a field ID, ' +
    'discover the valid options (e.g. dropdown/multi-select choices) and their option IDs for that ' +
    'field. Pass those option IDs in the custom_fields object of create_task / update_task.',
  inputSchema: {
    type: 'object',
    properties: {
      custom_field_id: {
        type: 'string',
        description: 'ID of the custom field to list options for (from list_custom_fields).',
      },
      archived: {
        type: 'boolean',
        description: 'Filter by archived status.',
      },
    },
    required: ['custom_field_id'],
  },
  annotations: { readOnlyHint: true },
};
