import { z } from 'zod';
import { ProductiveAPIClient } from '../api/client.js';
import {
  ProductiveDealCreate,
  ProductiveDealUpdate,
  ProductiveDealFromOrigin,
} from '../api/types.js';
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';

// ---------------------------------------------------------------------------
// Tool: create_budget
// ---------------------------------------------------------------------------

const createBudgetSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  company_id: z.string().min(1, 'Company ID is required'),
  project_id: z.string().optional(),
  responsible_id: z.string().optional(),
  deal_type_id: z.coerce.number().optional().default(2),
  date: z.string().optional(),
  currency: z.string().optional().default('CHF'),
  end_date: z.string().optional(),
  deal_value: z.coerce.number().optional(),
  purchase_order_number: z.string().optional(),
  budget_warning: z.coerce.number().optional(),
});

export async function createBudgetTool(
  client: ProductiveAPIClient,
  args: unknown,
  config?: { PRODUCTIVE_USER_ID?: string },
): Promise<{ content: Array<{ type: string; text: string }> }> {
  try {
    const params = createBudgetSchema.parse(args);

    // "me" mirrors the sentinel used by create_task/update_task_assignment;
    // omitting the field entirely resolves to the same default.
    const requestedResponsibleId =
      params.responsible_id === 'me' ? undefined : params.responsible_id;
    const responsibleId = requestedResponsibleId ?? config?.PRODUCTIVE_USER_ID;
    if (!responsibleId) {
      throw new McpError(
        ErrorCode.InvalidParams,
        'responsible_id is required: no value was provided and PRODUCTIVE_USER_ID is not ' +
          'configured in the environment to default to.',
      );
    }

    const data: ProductiveDealCreate = {
      data: {
        type: 'deals',
        attributes: {
          name: params.name,
          deal_type_id: params.deal_type_id,
          date: params.date ?? new Date().toISOString().slice(0, 10),
          currency: params.currency,
          budget: true,
          ...(params.end_date !== undefined && { end_date: params.end_date }),
          ...(params.deal_value !== undefined && { deal_value: params.deal_value }),
          ...(params.purchase_order_number !== undefined && {
            purchase_order_number: params.purchase_order_number,
          }),
          ...(params.budget_warning !== undefined && { budget_warning: params.budget_warning }),
        },
        relationships: {
          company: { data: { id: params.company_id, type: 'companies' } },
          responsible: { data: { id: responsibleId, type: 'people' } },
          ...(params.project_id !== undefined && {
            project: { data: { id: params.project_id, type: 'projects' } },
          }),
        },
      },
    };

    const response = await client.createDeal(data);
    const id = response.data.id;
    const budgetName = response.data.attributes.name;

    return {
      content: [
        {
          type: 'text',
          text:
            `Budget created! Budget ID: ${id} (${budgetName})\n\n` +
            'Next step: use update_budget to adjust fields, or list_company_budgets to verify.',
        },
      ],
    };
  } catch (error) {
    if (error instanceof McpError) throw error;
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

export const createBudgetDefinition = {
  name: 'create_budget',
  description:
    'Create a new budget for a company. Only name and company_id are required — ' +
    'responsible_id defaults to the configured user (PRODUCTIVE_USER_ID) if omitted, ' +
    'deal_type_id defaults to 2 (client), date defaults to today, currency defaults to "CHF". ' +
    'Always creates a budget (not a plain deal). Use list_companies to get company_id and ' +
    'list_projects to get project_id.',
  inputSchema: {
    type: 'object',
    required: ['name', 'company_id'],
    properties: {
      name: { type: 'string', description: 'Budget name' },
      company_id: { type: 'string', description: 'Company ID (use list_companies to find)' },
      project_id: { type: 'string', description: 'Project ID to link this budget to (optional)' },
      responsible_id: {
        type: 'string',
        description:
          'Person ID of the budget owner. Defaults to PRODUCTIVE_USER_ID if configured and ' +
          'omitted, or pass "me" explicitly to the same effect.',
      },
      deal_type_id: {
        type: 'number',
        description: 'Deal type: 1 = internal, 2 = client (default: 2)',
      },
      date: { type: 'string', description: 'Start date YYYY-MM-DD (default: today)' },
      currency: { type: 'string', description: 'Currency code (default: "CHF")' },
      end_date: { type: 'string', description: 'End date YYYY-MM-DD' },
      deal_value: { type: 'number', description: 'Budget value' },
      purchase_order_number: { type: 'string', description: 'PO number' },
      budget_warning: {
        type: 'number',
        description: 'Budget consumption percentage that triggers a warning',
      },
    },
  },
};

// ---------------------------------------------------------------------------
// Tool: update_budget
// ---------------------------------------------------------------------------

const updateBudgetSchema = z.object({
  budget_id: z.string().min(1, 'Budget ID is required'),
  name: z.string().optional(),
  date: z.string().optional(),
  end_date: z.string().optional(),
  currency: z.string().optional(),
  deal_value: z.coerce.number().optional(),
  purchase_order_number: z.string().optional(),
  budget_warning: z.coerce.number().optional(),
});

export async function updateBudgetTool(
  client: ProductiveAPIClient,
  args: unknown,
): Promise<{ content: Array<{ type: string; text: string }> }> {
  try {
    const { budget_id, ...fields } = updateBudgetSchema.parse(args);

    const attributes: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(fields)) {
      if (value !== undefined) {
        attributes[key] = value;
      }
    }

    if (Object.keys(attributes).length === 0) {
      throw new McpError(ErrorCode.InvalidParams, 'No fields to update provided.');
    }

    const data: ProductiveDealUpdate = {
      data: {
        type: 'deals',
        id: budget_id,
        attributes: attributes as ProductiveDealUpdate['data']['attributes'],
      },
    };

    const response = await client.updateDeal(budget_id, data);
    const budget = response.data;

    return {
      content: [
        {
          type: 'text',
          text: `Budget ${budget_id} updated.\n\nName: ${budget.attributes.name}\nEnd date: ${budget.attributes.end_date ?? 'N/A'}`,
        },
      ],
    };
  } catch (error) {
    if (error instanceof McpError) throw error;
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

export const updateBudgetDefinition = {
  name: 'update_budget',
  description:
    'Update a budget. Can change name, dates, currency, value, PO number, and budget warning threshold.',
  inputSchema: {
    type: 'object',
    required: ['budget_id'],
    properties: {
      budget_id: { type: 'string', description: 'Budget ID' },
      name: { type: 'string', description: 'Budget name' },
      date: { type: 'string', description: 'Start date YYYY-MM-DD' },
      end_date: { type: 'string', description: 'End date YYYY-MM-DD' },
      currency: { type: 'string', description: 'Currency code' },
      deal_value: { type: 'number', description: 'Budget value' },
      purchase_order_number: { type: 'string', description: 'PO number' },
      budget_warning: {
        type: 'number',
        description: 'Budget consumption percentage that triggers a warning',
      },
    },
  },
};

// ---------------------------------------------------------------------------
// Tool: create_budget_from_deal
// ---------------------------------------------------------------------------

const createBudgetFromDealSchema = z.object({
  // Unlike every other *_id field in this file, origin_deal_id is sent to
  // Productive as a plain numeric attribute, not a relationship — hence the
  // coercion to number here despite the string-typed JSON schema below,
  // which stays "string" only for input-shape consistency with company_id/
  // project_id/etc.
  origin_deal_id: z.coerce.number(),
  project_id: z.string().min(1, 'Project ID is required'),
  name: z.string().optional(),
  date: z.string().optional(),
  end_date: z.string().optional(),
});

export async function createBudgetFromDealTool(
  client: ProductiveAPIClient,
  args: unknown,
): Promise<{ content: Array<{ type: string; text: string }> }> {
  try {
    const params = createBudgetFromDealSchema.parse(args);

    // Advisory only — if this check itself fails (network blip, transient
    // 5xx), proceed with creation rather than blocking it. The point is to
    // warn about likely duplicates, not to gate the primary operation.
    let existingIds: string[] = [];
    try {
      const existing = await client.listDealsByOriginId(params.origin_deal_id.toString());
      existingIds = existing.data.map((d) => d.id);
    } catch {
      // couldn't verify — proceed without a duplicate warning
    }

    const data: ProductiveDealFromOrigin = {
      data: {
        type: 'deals',
        attributes: {
          origin_deal_id: params.origin_deal_id,
          ...(params.name !== undefined && { name: params.name }),
          ...(params.date !== undefined && { date: params.date }),
          ...(params.end_date !== undefined && { end_date: params.end_date }),
        },
        relationships: {
          project: { data: { id: params.project_id, type: 'projects' } },
        },
      },
    };

    const response = await client.createDealFromOrigin(data);
    const id = response.data.id;
    const budgetName = response.data.attributes.name;

    let text = `Budget created from deal ${params.origin_deal_id}! Budget ID: ${id} (${budgetName})`;
    if (existingIds.length > 0) {
      text +=
        `\n\nWarning: ${existingIds.length} budget(s) were already derived from this deal: ` +
        `${existingIds.join(', ')}. This may be a duplicate.`;
    }

    return { content: [{ type: 'text', text }] };
  } catch (error) {
    if (error instanceof McpError) throw error;
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

export const createBudgetFromDealDefinition = {
  name: 'create_budget_from_deal',
  description:
    'Derive a new budget from an existing deal (contract). The origin deal must be in a "Won" ' +
    'status — Productive rejects derivation from open/lost deals. Productive copies the deal ' +
    'value, budgeted time, PO number, currency, and deal type from the origin deal ' +
    'automatically. Warns (but does not block) if a budget was already derived from this deal. ' +
    'Use list_project_deals to find origin_deal_id.',
  inputSchema: {
    type: 'object',
    required: ['origin_deal_id', 'project_id'],
    properties: {
      origin_deal_id: {
        type: 'string',
        description: 'ID of the source deal to derive the budget from',
      },
      project_id: { type: 'string', description: 'Project ID to link the new budget to' },
      name: { type: 'string', description: 'Override the derived budget name' },
      date: { type: 'string', description: 'Override start date YYYY-MM-DD (default: today)' },
      end_date: { type: 'string', description: 'Override end date YYYY-MM-DD' },
    },
  },
};
