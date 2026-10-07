import { z } from 'zod';
import { ProductiveAPIClient } from '../api/client.js';
import { ProductiveServiceCreate, ProductiveServiceUpdate } from '../api/types.js';
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import { toMcpError } from '../utils/errors.js';
import { toNumericId } from './tool-helpers.js';
import { confirmSection } from './budget-sections.js';

// ---------------------------------------------------------------------------
// Tool: create_budget_service
// ---------------------------------------------------------------------------

const createBudgetServiceSchema = z.object({
  budget_id: z.string().min(1, 'Budget ID is required'),
  name: z.string().min(1, 'Name is required'),
  unit_id: z.coerce.number().optional().default(1),
  billing_type_id: z.coerce.number().optional().default(2),
  description: z.string().optional(),
  price: z.coerce.number().optional(),
  quantity: z.coerce.number().optional(),
  budgeted_time: z.coerce.number().optional(),
  section_id: z.string().min(1).optional(),
});

const SECTION_HINT =
  'Use a section of the same budget (from list_budget_sections or create_budget_section). ' +
  'The service is read back to confirm the assignment.';

const createSectionIdProperty = {
  type: 'string',
  description: `Section to put the service into. ${SECTION_HINT}`,
};

const updateSectionIdProperty = {
  type: 'string',
  description: `Section to put the service into, or "none" to take it out of its section. ${SECTION_HINT}`,
};

/** `"none"` takes a service out of its section, sent as `section_id: null`. */
function sectionChoice(value: string | undefined): number | null | undefined {
  if (value === undefined) return undefined;
  return value.trim().toLowerCase() === 'none' ? null : toNumericId(value, 'section_id');
}

export async function createBudgetServiceTool(
  client: ProductiveAPIClient,
  args: unknown,
): Promise<{ content: Array<{ type: string; text: string }> }> {
  try {
    const params = createBudgetServiceSchema.parse(args);
    const sectionId =
      params.section_id === undefined ? undefined : toNumericId(params.section_id, 'section_id');

    const data: ProductiveServiceCreate = {
      data: {
        type: 'services',
        attributes: {
          name: params.name,
          unit_id: params.unit_id,
          billing_type_id: params.billing_type_id,
          ...(params.description !== undefined && { description: params.description }),
          ...(params.price !== undefined && { price: params.price }),
          ...(params.quantity !== undefined && { quantity: params.quantity }),
          ...(params.budgeted_time !== undefined && { budgeted_time: params.budgeted_time }),
          ...(sectionId !== undefined && { section_id: sectionId }),
        },
        relationships: {
          deal: { data: { id: params.budget_id, type: 'deals' } },
        },
      },
    };

    const response = await client.createService(data);
    const id = response.data.id;
    const serviceName = response.data.attributes.name;
    const sectionNote =
      sectionId === undefined
        ? ''
        : `\n${await confirmSection(client, id, String(sectionId), 'created')}`;

    return {
      content: [
        {
          type: 'text',
          text:
            `Service created! Service ID: ${id} (${serviceName}) on budget ${params.budget_id}${sectionNote}\n\n` +
            'Next step: use update_budget_service to adjust fields, or list_deal_services to verify.',
        },
      ],
    };
  } catch (error) {
    throw toMcpError(error);
  }
}

export const createBudgetServiceDefinition = {
  name: 'create_budget_service',
  description:
    'Create a new service (line item) attached to an existing budget. Only budget_id and ' +
    'name are required — unit_id defaults to 1 (Hour), billing_type_id defaults to 2 (Actuals). ' +
    'Use list_company_budgets or create_budget to get budget_id.',
  inputSchema: {
    type: 'object',
    required: ['budget_id', 'name'],
    properties: {
      budget_id: {
        type: 'string',
        description:
          "Budget ID to attach this service to. Internally this is sent to Productive.io as the API's `deal` relationship — the same ID returned by list_company_budgets/create_budget, not a separately-named resource.",
      },
      name: { type: 'string', description: 'Service name' },
      unit_id: {
        type: 'number',
        description: 'Tracking unit: 1 = Hour, 2 = Piece, 3 = Day (default: 1)',
      },
      billing_type_id: {
        type: 'number',
        description: 'Billing type: 1 = Fixed, 2 = Actuals, 3 = None, 4 = Percentage (default: 2)',
      },
      description: { type: 'string', description: 'Service description' },
      price: { type: 'number', description: 'Unit price' },
      quantity: { type: 'number', description: 'Number of units (hours/days/pieces)' },
      budgeted_time: { type: 'number', description: 'Allocated hours for this service' },
      section_id: createSectionIdProperty,
    },
  },
  annotations: {
    title: 'Create budget service',
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: true,
  },
};

// ---------------------------------------------------------------------------
// Tool: update_budget_service
// ---------------------------------------------------------------------------

const updateBudgetServiceSchema = z.object({
  service_id: z.string().min(1, 'Service ID is required'),
  name: z.string().optional(),
  description: z.string().optional(),
  price: z.coerce.number().optional(),
  quantity: z.coerce.number().optional(),
  unit_id: z.coerce.number().optional(),
  billing_type_id: z.coerce.number().optional(),
  budgeted_time: z.coerce.number().optional(),
  section_id: z.string().min(1).optional(),
});

export async function updateBudgetServiceTool(
  client: ProductiveAPIClient,
  args: unknown,
): Promise<{ content: Array<{ type: string; text: string }> }> {
  try {
    const { service_id, section_id, ...fields } = updateBudgetServiceSchema.parse(args);

    const attributes: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(fields)) {
      if (value !== undefined) {
        attributes[key] = value;
      }
    }
    const sectionId = sectionChoice(section_id);
    if (sectionId !== undefined) {
      attributes.section_id = sectionId;
    }

    if (Object.keys(attributes).length === 0) {
      throw new McpError(ErrorCode.InvalidParams, 'No fields to update provided.');
    }

    const data: ProductiveServiceUpdate = {
      data: {
        type: 'services',
        id: service_id,
        attributes: attributes as ProductiveServiceUpdate['data']['attributes'],
      },
    };

    const response = await client.updateService(service_id, data);
    const service = response.data;
    const expected = sectionId === null ? null : String(sectionId);
    const sectionNote =
      sectionId === undefined
        ? ''
        : `\n${await confirmSection(client, service_id, expected, 'updated')}`;

    return {
      content: [
        {
          type: 'text',
          text: `Service ${service_id} updated.\n\nName: ${service.attributes.name}\nPrice: ${service.attributes.price ?? 'N/A'}\nQuantity: ${service.attributes.quantity ?? 'N/A'}${sectionNote}`,
        },
      ],
    };
  } catch (error) {
    throw toMcpError(error);
  }
}

export const updateBudgetServiceDefinition = {
  name: 'update_budget_service',
  description:
    'Update a budget service (line item). Can change name, description, price, quantity, ' +
    'unit_id, billing_type_id, budgeted_time and the section (section_id, or "none" to take ' +
    'the service out of its section). Cannot move the service to a different budget.',
  inputSchema: {
    type: 'object',
    required: ['service_id'],
    properties: {
      service_id: { type: 'string', description: 'Service ID' },
      name: { type: 'string', description: 'Service name' },
      description: { type: 'string', description: 'Service description' },
      price: { type: 'number', description: 'Unit price' },
      quantity: { type: 'number', description: 'Number of units (hours/days/pieces)' },
      unit_id: {
        type: 'number',
        description: 'Tracking unit: 1 = Hour, 2 = Piece, 3 = Day',
      },
      billing_type_id: {
        type: 'number',
        description: 'Billing type: 1 = Fixed, 2 = Actuals, 3 = None, 4 = Percentage',
      },
      budgeted_time: { type: 'number', description: 'Allocated hours for this service' },
      section_id: updateSectionIdProperty,
    },
  },
  annotations: {
    title: 'Update budget service',
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  },
};
