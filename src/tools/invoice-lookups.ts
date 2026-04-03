import { z } from 'zod';
import { ProductiveAPIClient } from '../api/client.js';
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';

const listDocumentTypesSchema = z.object({
  limit: z.number().min(1).max(200).default(50).optional(),
});

export async function listDocumentTypesTool(
  client: ProductiveAPIClient,
  args: unknown,
): Promise<{ content: Array<{ type: string; text: string }> }> {
  try {
    const params = listDocumentTypesSchema.parse(args || {});
    const response = await client.listDocumentTypes({ limit: params.limit });

    if (!response?.data?.length) {
      return {
        content: [{ type: 'text', text: 'No document types found.' }],
      };
    }

    const text = response.data.map((dt) => `• ${dt.attributes.name} (ID: ${dt.id})`).join('\n');

    return {
      content: [
        {
          type: 'text',
          text: `Found ${response.data.length} document type(s):\n\n${text}`,
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
      error instanceof Error ? error.message : 'Unknown error',
    );
  }
}

export const listDocumentTypesDefinition = {
  name: 'list_document_types',
  description:
    'List available invoice document types. Use this to get the document_type_id needed for create_invoice.',
  inputSchema: {
    type: 'object',
    properties: {
      limit: {
        type: 'number',
        description: 'Max results (1-200, default 50)',
        minimum: 1,
        maximum: 200,
      },
    },
  },
};

const listTaxRatesSchema = z.object({
  limit: z.number().min(1).max(200).default(50).optional(),
});

export async function listTaxRatesTool(
  client: ProductiveAPIClient,
  args: unknown,
): Promise<{ content: Array<{ type: string; text: string }> }> {
  try {
    const params = listTaxRatesSchema.parse(args || {});
    const response = await client.listTaxRates({ limit: params.limit });

    if (!response?.data?.length) {
      return {
        content: [{ type: 'text', text: 'No tax rates found.' }],
      };
    }

    const text = response.data
      .map((tr) => `• ${tr.attributes.name} — ${tr.attributes.tax}% (ID: ${tr.id})`)
      .join('\n');

    return {
      content: [
        {
          type: 'text',
          text: `Found ${response.data.length} tax rate(s):\n\n${text}`,
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
      error instanceof Error ? error.message : 'Unknown error',
    );
  }
}

export const listTaxRatesDefinition = {
  name: 'list_tax_rates',
  description:
    'List available tax rates. Use this to get the tax_rate_id needed for generate_line_items.',
  inputSchema: {
    type: 'object',
    properties: {
      limit: {
        type: 'number',
        description: 'Max results (1-200, default 50)',
        minimum: 1,
        maximum: 200,
      },
    },
  },
};
