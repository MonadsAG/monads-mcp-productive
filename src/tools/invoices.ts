import { z } from 'zod';
import { ProductiveAPIClient } from '../api/client.js';
import {
  ProductiveInvoice,
  ProductiveInvoiceCreate,
  ProductiveLineItemGenerate,
  ProductiveIncludedResource,
} from '../api/types.js';
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';

// ---------------------------------------------------------------------------
// Helper functions
// ---------------------------------------------------------------------------

function formatInvoiceState(state?: number): string {
  if (state === 1) return 'Draft';
  if (state === 2) return 'Finalized';
  return 'Unknown';
}

function formatPaymentStatus(status?: number): string {
  if (status === 1) return 'Paid';
  if (status === 2) return 'Unpaid';
  if (status === 3) return 'Partially Paid';
  return 'Unknown';
}

function getLastMonthRange(): { date_from: string; date_to: string } {
  const now = new Date();
  const firstDay = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const lastDay = new Date(now.getFullYear(), now.getMonth(), 0);
  return {
    date_from: firstDay.toISOString().slice(0, 10),
    date_to: lastDay.toISOString().slice(0, 10),
  };
}

function resolveCompanyName(
  invoice: ProductiveInvoice,
  included?: ProductiveIncludedResource[],
): string {
  const companyId = invoice.relationships?.company?.data?.id;
  if (companyId && included) {
    const company = included.find((r) => r.type === 'companies' && r.id === companyId);
    if (company) return company.attributes.name as string;
  }
  return companyId ? `Company #${companyId}` : 'N/A';
}

// ---------------------------------------------------------------------------
// Tool 1: list_invoices
// ---------------------------------------------------------------------------

const listInvoicesSchema = z.object({
  company_id: z.string().optional(),
  project_id: z.string().optional(),
  deal_id: z.string().optional(),
  invoice_state: z.number().optional(),
  invoice_status: z.number().optional(),
  payment_status: z.number().optional(),
  after: z.string().optional(),
  before: z.string().optional(),
  full_query: z.string().optional(),
  limit: z.number().min(1).max(200).default(30).optional(),
});

/**
 * Lists invoices from Productive.io with optional filters.
 *
 * @param client - The Productive API client instance
 * @param args - Filter parameters matching listInvoicesSchema
 * @returns Formatted list of invoices with key fields
 */
export async function listInvoicesTool(
  client: ProductiveAPIClient,
  args: unknown,
): Promise<{ content: Array<{ type: string; text: string }> }> {
  try {
    const params = listInvoicesSchema.parse(args || {});
    const response = await client.listInvoices(params);

    if (!response?.data?.length) {
      return { content: [{ type: 'text', text: 'No invoices found.' }] };
    }

    const lines = response.data.map((inv) => {
      const company = resolveCompanyName(inv, response.included);
      const number = inv.attributes.number ?? 'N/A';
      const date = inv.attributes.invoiced_on ?? 'N/A';
      const amount = inv.attributes.amount_with_tax ?? 'N/A';
      const currency = inv.attributes.currency ?? '';
      const state = formatInvoiceState(inv.attributes.invoice_state);
      const payment = formatPaymentStatus(inv.attributes.payment_status);
      return `• #${number} | ${company} | ${date} | ${amount} ${currency} | ${state} | ${payment} (ID: ${inv.id})`;
    });

    return {
      content: [
        {
          type: 'text',
          text: `Found ${response.data.length} invoice(s):\n\n${lines.join('\n')}`,
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

export const listInvoicesDefinition = {
  name: 'list_invoices',
  description:
    'List invoices from Productive.io with optional filters. Use list_companies to get company_id, list_services/list_deals to get deal_id.',
  inputSchema: {
    type: 'object',
    properties: {
      company_id: { type: 'string', description: 'Filter by company ID' },
      project_id: { type: 'string', description: 'Filter by project ID' },
      deal_id: { type: 'string', description: 'Filter by deal/budget ID' },
      invoice_state: {
        type: 'number',
        description: 'Filter by state: 1=Draft, 2=Finalized',
      },
      invoice_status: {
        type: 'number',
        description: 'Filter by invoice status number',
      },
      payment_status: {
        type: 'number',
        description: 'Filter by payment status: 1=Paid, 2=Unpaid, 3=Partially Paid',
      },
      after: {
        type: 'string',
        description: 'Filter invoices after this date (YYYY-MM-DD)',
      },
      before: {
        type: 'string',
        description: 'Filter invoices before this date (YYYY-MM-DD)',
      },
      full_query: { type: 'string', description: 'Full-text search query' },
      limit: {
        type: 'number',
        description: 'Max results (1-200, default 30)',
        minimum: 1,
        maximum: 200,
      },
    },
  },
};

// ---------------------------------------------------------------------------
// Tool 2: get_invoice
// ---------------------------------------------------------------------------

const getInvoiceSchema = z.object({
  invoice_id: z.string(),
});

/**
 * Retrieves full details of a single invoice including line items.
 *
 * @param client - The Productive API client instance
 * @param args - Object containing invoice_id
 * @returns Detailed invoice information with line items
 */
export async function getInvoiceTool(
  client: ProductiveAPIClient,
  args: unknown,
): Promise<{ content: Array<{ type: string; text: string }> }> {
  try {
    const { invoice_id } = getInvoiceSchema.parse(args || {});
    const response = await client.getInvoice(invoice_id);
    const inv = response.data;
    const a = inv.attributes;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const included = (response as any).included as ProductiveIncludedResource[] | undefined;
    const company = resolveCompanyName(inv, included);

    const lineItems = included?.filter((r) => r.type === 'line_items') ?? [];
    const lineItemsText =
      lineItems.length > 0
        ? lineItems
            .map((li) => {
              const name = li.attributes.name ?? li.attributes.description ?? '—';
              const qty = li.attributes.quantity ?? '';
              const unit = li.attributes.unit_price ?? '';
              const total = li.attributes.total ?? '';
              return `  - ${name} | qty: ${qty} | unit: ${unit} | total: ${total} (ID: ${li.id})`;
            })
            .join('\n')
        : '  (none)';

    const exportUrl = a.export_invoice_url ? `\nExport URL:     ${a.export_invoice_url}` : '';

    const text = [
      `Invoice (ID: ${inv.id})`,
      `Number:         ${a.number ?? 'N/A'}`,
      `Subject:        ${a.subject ?? 'N/A'}`,
      `Company:        ${company}`,
      `State:          ${formatInvoiceState(a.invoice_state)}`,
      `Payment Status: ${formatPaymentStatus(a.payment_status)}`,
      `Invoiced on:    ${a.invoiced_on ?? 'N/A'}`,
      `Pay on:         ${a.pay_on ?? 'N/A'}`,
      `Delivery on:    ${a.delivery_on ?? 'N/A'}`,
      `Paid on:        ${a.paid_on ?? 'N/A'}`,
      `Currency:       ${a.currency ?? 'N/A'}`,
      `Amount:         ${a.amount ?? 'N/A'}`,
      `Amount w/ tax:  ${a.amount_with_tax ?? 'N/A'}`,
      `Amount tax:     ${a.amount_tax ?? 'N/A'}`,
      `Amount paid:    ${a.amount_paid ?? 'N/A'}`,
      `Amount unpaid:  ${a.amount_unpaid ?? 'N/A'}`,
      `Note:           ${a.note ?? 'N/A'}${exportUrl}`,
      ``,
      `Line Items (${lineItems.length}):`,
      lineItemsText,
    ].join('\n');

    return { content: [{ type: 'text', text }] };
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

export const getInvoiceDefinition = {
  name: 'get_invoice',
  description:
    'Get full details of a single invoice including line items. Use list_invoices to find the invoice_id.',
  inputSchema: {
    type: 'object',
    required: ['invoice_id'],
    properties: {
      invoice_id: {
        type: 'string',
        description: 'The ID of the invoice to retrieve',
      },
    },
  },
};

// ---------------------------------------------------------------------------
// Tool 3: create_invoice
// ---------------------------------------------------------------------------

const createInvoiceSchema = z.object({
  company_id: z.string(),
  document_type_id: z.string(),
  invoiced_on: z.string().optional(),
  currency: z.string().default('EUR').optional(),
  pay_on: z.string().optional(),
  delivery_on: z.string().optional(),
  subject: z.string().optional(),
  note: z.string().optional(),
  footer: z.string().optional(),
  payment_terms: z.number().optional(),
  subsidiary_id: z.string().optional(),
});

/**
 * Creates a new invoice in Productive.io.
 *
 * @param client - The Productive API client instance
 * @param args - Invoice creation parameters matching createInvoiceSchema
 * @returns Confirmation with the new invoice ID and next steps
 */
export async function createInvoiceTool(
  client: ProductiveAPIClient,
  args: unknown,
): Promise<{ content: Array<{ type: string; text: string }> }> {
  try {
    const params = createInvoiceSchema.parse(args || {});
    const today = new Date().toISOString().slice(0, 10);

    const data: ProductiveInvoiceCreate = {
      data: {
        type: 'invoices',
        attributes: {
          invoiced_on: params.invoiced_on ?? today,
          currency: params.currency ?? 'EUR',
          ...(params.pay_on !== undefined && { pay_on: params.pay_on }),
          ...(params.delivery_on !== undefined && {
            delivery_on: params.delivery_on,
          }),
          ...(params.subject !== undefined && { subject: params.subject }),
          ...(params.note !== undefined && { note: params.note }),
          ...(params.footer !== undefined && { footer: params.footer }),
          ...(params.payment_terms !== undefined && {
            payment_terms: params.payment_terms,
          }),
        },
        relationships: {
          company: { data: { id: params.company_id, type: 'companies' } },
          document_type: {
            data: { id: params.document_type_id, type: 'document_types' },
          },
          ...(params.subsidiary_id !== undefined && {
            subsidiary: {
              data: { id: params.subsidiary_id, type: 'subsidiaries' },
            },
          }),
        },
      },
    };

    const response = await client.createInvoice(data);
    const id = response.data.id;
    const number = response.data.attributes.number ?? 'N/A';

    return {
      content: [
        {
          type: 'text',
          text: `Invoice created! Invoice ID: ${id} (Number: ${number})\n\nNext step: use generate_line_items with invoice_id="${id}" and your budget_ids to add line items.`,
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

export const createInvoiceDefinition = {
  name: 'create_invoice',
  description:
    'Create a new invoice in Productive.io. Use list_companies to get company_id, list_document_types to get document_type_id. After creation, use generate_line_items to add line items.',
  inputSchema: {
    type: 'object',
    required: ['company_id', 'document_type_id'],
    properties: {
      company_id: {
        type: 'string',
        description: 'Company ID (use list_companies to find)',
      },
      document_type_id: {
        type: 'string',
        description: 'Document type ID (use list_document_types to find)',
      },
      invoiced_on: {
        type: 'string',
        description: 'Invoice date (YYYY-MM-DD, defaults to today)',
      },
      currency: {
        type: 'string',
        description: 'Currency code (default: "EUR")',
      },
      pay_on: {
        type: 'string',
        description: 'Payment due date (YYYY-MM-DD)',
      },
      delivery_on: {
        type: 'string',
        description: 'Delivery date (YYYY-MM-DD)',
      },
      subject: { type: 'string', description: 'Invoice subject/title' },
      note: { type: 'string', description: 'Internal note' },
      footer: { type: 'string', description: 'Invoice footer text' },
      payment_terms: {
        type: 'number',
        description: 'Payment terms in days',
      },
      subsidiary_id: {
        type: 'string',
        description: 'Subsidiary ID if applicable',
      },
    },
  },
};

// ---------------------------------------------------------------------------
// Tool 4: generate_line_items
// ---------------------------------------------------------------------------

const generateLineItemsSchema = z.object({
  invoice_id: z.string(),
  budget_ids: z.array(z.string()),
  tax_rate_id: z.string(),
  display_format: z.string().default('{service}').optional(),
  date_from: z.string().optional(),
  date_to: z.string().optional(),
  invoicing_by: z.enum(['service', 'budget']).default('service').optional(),
});

/**
 * Generates line items for an invoice from uninvoiced time and expenses.
 *
 * @param client - The Productive API client instance
 * @param args - Parameters matching generateLineItemsSchema
 * @returns Summary of generated line items and next steps
 */
export async function generateLineItemsTool(
  client: ProductiveAPIClient,
  args: unknown,
): Promise<{ content: Array<{ type: string; text: string }> }> {
  try {
    const params = generateLineItemsSchema.parse(args || {});
    const defaultRange = getLastMonthRange();

    const dateFrom = params.date_from ?? defaultRange.date_from;
    const dateTo = params.date_to ?? defaultRange.date_to;

    const data: ProductiveLineItemGenerate = {
      data: {
        type: 'line_items',
        attributes: {
          invoicing_method: 'uninvoiced_time_and_expenses',
          display_format: params.display_format ?? '{service}',
          date_from: dateFrom,
          date_to: dateTo,
          invoicing_by: params.invoicing_by ?? 'service',
        },
        relationships: {
          invoice: { data: { id: params.invoice_id, type: 'invoices' } },
          deals: {
            data: params.budget_ids.map((id) => ({ id, type: 'deals' as const })),
          },
          tax_rate: { data: { id: params.tax_rate_id, type: 'tax_rates' } },
        },
      },
    };

    const response = await client.generateLineItems(data);
    const count = Array.isArray(response.data) ? response.data.length : 0;

    return {
      content: [
        {
          type: 'text',
          text: `Generated ${count} line item(s) for invoice ${params.invoice_id}. Period: ${dateFrom} to ${dateTo}\n\nNext step: use get_invoice with invoice_id="${params.invoice_id}" to review the invoice, or finalize_invoice to finalize it.`,
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

export const generateLineItemsDefinition = {
  name: 'generate_line_items',
  description:
    'Generate line items for an invoice from uninvoiced time and expenses. Use create_invoice to get invoice_id, list_tax_rates to get tax_rate_id. Budget IDs come from list_services or deals.',
  inputSchema: {
    type: 'object',
    required: ['invoice_id', 'budget_ids', 'tax_rate_id'],
    properties: {
      invoice_id: {
        type: 'string',
        description: 'Invoice ID to add line items to (use create_invoice first)',
      },
      budget_ids: {
        type: 'array',
        items: { type: 'string' },
        description: 'Array of budget/deal IDs to pull time from',
      },
      tax_rate_id: {
        type: 'string',
        description: 'Tax rate ID to apply (use list_tax_rates to find)',
      },
      display_format: {
        type: 'string',
        description: 'Display format template (default: "{service}")',
      },
      date_from: {
        type: 'string',
        description: 'Start date for time period (YYYY-MM-DD, defaults to first day of last month)',
      },
      date_to: {
        type: 'string',
        description: 'End date for time period (YYYY-MM-DD, defaults to last day of last month)',
      },
      invoicing_by: {
        type: 'string',
        enum: ['service', 'budget'],
        description: 'Group line items by "service" or "budget" (default: "service")',
      },
    },
  },
};
