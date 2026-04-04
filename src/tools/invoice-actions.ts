import { z } from 'zod';
import { ProductiveAPIClient } from '../api/client.js';
import { Config } from '../config/index.js';
import { ProductivePaymentCreate } from '../api/types.js';
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';

// ─── finalize_invoice ────────────────────────────────────────────────────────

const finalizeInvoiceSchema = z.object({
  invoice_id: z.string().min(1),
  confirm: z.boolean().optional(),
});

/**
 * Finalize an invoice (irreversible action).
 *
 * Requires explicit confirmation before executing because finalizing cannot be undone.
 *
 * @param client - Productive API client
 * @param args - Tool arguments matching finalizeInvoiceSchema
 * @returns MCP content response
 */
export async function finalizeInvoiceTool(
  client: ProductiveAPIClient,
  args: unknown,
): Promise<{ content: Array<{ type: string; text: string }> }> {
  try {
    const params = finalizeInvoiceSchema.parse(args);

    if (!params.confirm) {
      return {
        content: [
          {
            type: 'text',
            text: `⚠️  Finalizing invoice ${params.invoice_id} is IRREVERSIBLE.\n\nOnce finalized, the invoice cannot be edited or deleted. Call this tool again with confirm: true to proceed.`,
          },
        ],
      };
    }

    const response = await client.finalizeInvoice(params.invoice_id);
    const invoice = response.data;
    const attrs = invoice.attributes;

    return {
      content: [
        {
          type: 'text',
          text: [
            `Invoice finalized!`,
            `Number: ${attrs.number ?? 'N/A'}`,
            `Total: ${(parseInt(attrs.amount_with_tax ?? '0', 10) / 100).toFixed(2)} ${attrs.currency ?? ''}`,
            ``,
            `Next step: Use mark_invoice_paid once payment is received.`,
          ].join('\n'),
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

export const finalizeInvoiceDefinition = {
  name: 'finalize_invoice',
  description:
    'Finalize an invoice, making it ready to send to the client. This action is IRREVERSIBLE — the invoice can no longer be edited after finalization. Requires confirm: true.',
  inputSchema: {
    type: 'object',
    properties: {
      invoice_id: {
        type: 'string',
        description: 'ID of the invoice to finalize',
      },
      confirm: {
        type: 'boolean',
        description: 'Must be true to execute the irreversible finalization',
      },
    },
    required: ['invoice_id'],
  },
};

// ─── get_invoice_pdf_url ─────────────────────────────────────────────────────

const getInvoicePdfUrlSchema = z.object({
  invoice_id: z.string().min(1),
});

function buildPdfUrl(invoiceId: string, invoiceNumber: string, config: Config): string {
  const baseUrl = config.PRODUCTIVE_API_BASE_URL;
  const isSandbox = baseUrl.includes('sandbox');
  const exporterHost = isSandbox ? 'exporter-sandbox.productive.io' : 'exporter.productive.io';
  const appHost = isSandbox ? 'sandbox.productive.io' : 'app.productive.io';
  const orgId = config.PRODUCTIVE_ORG_ID;

  const payload = {
    name: `invoice_${invoiceNumber}`,
    url: `https://${appHost}/${orgId}/export/document/invoice/${invoiceId}`,
  };

  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64');
  return `https://${exporterHost}/export/document?payload=${encodeURIComponent(encoded)}&download=true`;
}

export async function getInvoicePdfUrlTool(
  client: ProductiveAPIClient,
  args: unknown,
  config: Config,
): Promise<{ content: Array<{ type: string; text: string }> }> {
  try {
    const { invoice_id } = getInvoicePdfUrlSchema.parse(args);
    const response = await client.getInvoice(invoice_id);
    const number = response.data.attributes.number ?? invoice_id;

    const url = buildPdfUrl(invoice_id, number, config);

    return {
      content: [
        {
          type: 'text',
          text: `PDF download URL for invoice #${number}:\n\n${url}`,
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

export const getInvoicePdfUrlDefinition = {
  name: 'get_invoice_pdf_url',
  description:
    'Generate a PDF download URL for an invoice. The URL must be opened in a browser where the user is logged into Productive — it does not work via API or curl. Use list_invoices or get_invoice to find the invoice_id.',
  inputSchema: {
    type: 'object',
    properties: {
      invoice_id: {
        type: 'string',
        description: 'ID of the invoice',
      },
    },
    required: ['invoice_id'],
  },
  annotations: { readOnlyHint: true },
};

// ─── delete_invoice ──────────────────────────────────────────────────────────

const deleteInvoiceSchema = z.object({
  invoice_id: z.string().min(1),
  confirm: z.boolean().optional(),
});

/**
 * Delete a draft invoice.
 *
 * Fetches the invoice first to verify it is a draft (not yet finalized).
 * Finalized invoices cannot be deleted. Requires explicit confirmation
 * before executing because deletion is irreversible.
 *
 * @param client - Productive API client
 * @param args - Tool arguments matching deleteInvoiceSchema
 * @returns MCP content response
 */
export async function deleteInvoiceTool(
  client: ProductiveAPIClient,
  args: unknown,
): Promise<{ content: Array<{ type: string; text: string }> }> {
  try {
    const params = deleteInvoiceSchema.parse(args);

    const invoiceResponse = await client.getInvoice(params.invoice_id);
    const attrs = invoiceResponse.data.attributes;

    if (attrs.finalized_at) {
      return {
        content: [
          {
            type: 'text',
            text: `Cannot delete finalized invoice ${params.invoice_id}. Only draft invoices can be deleted.`,
          },
        ],
      };
    }

    if (!params.confirm) {
      return {
        content: [
          {
            type: 'text',
            text: [
              `Delete preview for invoice ${params.invoice_id}:`,
              `  Number: ${attrs.number ?? 'N/A'}`,
              `  Status: Draft`,
              ``,
              `This action is IRREVERSIBLE. Call again with confirm: true to delete.`,
            ].join('\n'),
          },
        ],
      };
    }

    await client.deleteInvoice(params.invoice_id);

    return {
      content: [
        {
          type: 'text',
          text: `Invoice ${params.invoice_id} deleted.`,
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

export const deleteInvoiceDefinition = {
  name: 'delete_invoice',
  description:
    'Delete a draft invoice. Only draft invoices (not yet finalized) can be deleted. This action is irreversible. Requires confirm: true to execute.',
  inputSchema: {
    type: 'object',
    properties: {
      invoice_id: {
        type: 'string',
        description: 'ID of the invoice to delete',
      },
      confirm: {
        type: 'boolean',
        description: 'Must be true to execute the irreversible deletion',
      },
    },
    required: ['invoice_id'],
  },
  annotations: { destructiveHint: true },
};

// ─── get_timesheet_report_url ────────────────────────────────────────────────

const getTimesheetReportUrlSchema = z.object({
  budget_id: z.string().describe('Budget/Deal ID'),
  date_from: z.string().describe('Start date YYYY-MM-DD'),
  date_to: z.string().describe('End date YYYY-MM-DD'),
  columns: z.string().describe('Comma-separated columns, e.g. "day,person,note,billable-time"'),
  name: z.string().describe('PDF filename, e.g. "Zeitnachweis_20260011"'),
  title: z.string().describe('Title shown in PDF header'),
  group_by: z
    .string()
    .default('time-entry')
    .optional()
    .describe('Grouping: "time-entry", "task", "person", "service"'),
  sort_by: z.string().default('day').optional().describe('Sort field'),
  orientation: z.string().default('portrait').optional().describe('"portrait" or "landscape"'),
  page_size: z.string().default('A4').optional().describe('Page size'),
});

function buildTimesheetReportUrl(
  params: z.infer<typeof getTimesheetReportUrlSchema>,
  config: Config,
): string {
  const baseUrl = config.PRODUCTIVE_API_BASE_URL;
  const isSandbox = baseUrl.includes('sandbox');
  const exporterHost = isSandbox ? 'exporter-sandbox.productive.io' : 'exporter.productive.io';
  const appHost = isSandbox ? 'sandbox.productive.io' : 'app.productive.io';
  const orgId = config.PRODUCTIVE_ORG_ID;

  const dateFrom = params.date_from;
  const dateTo = params.date_to;
  const startD = new Date(dateFrom);
  startD.setUTCDate(startD.getUTCDate() - 1);
  const startDateISO = `${startD.toISOString().slice(0, 10)}T23:00:00.000Z`;
  const endDateISO = `${dateTo}T22:00:00.000Z`;

  const exportData = {
    name: params.name,
    format: '1',
    pageSize: params.page_size ?? 'A4',
    isAttachmentsEnabled: false,
    orientation: params.orientation ?? 'portrait',
    exportAs: 'manager',
    isTimeExport: false,
    isTimeEntryReportExport: true,
    itemTypeColumnId: 'day',
    extraApiParams: null,
    apiFilterParams: {
      '0': { date: { gtEq: dateFrom, ltEq: dateTo } },
      '1': { budgetId: { eq: [params.budget_id] } },
      '2': { 'service.billable': { eq: true } },
      '3': { billableTime: { gt: 0 } },
      '4': { billingTypeId: { eq: '2' } },
      $op: 'and',
    },
    description: null,
    dateFilters: [
      {
        label: 'Date',
        value: [{ intervalId: '4', startDate: startDateISO, endDate: endDateISO }],
      },
    ],
  };

  const filterData = {
    name: params.title,
    default: false,
    filterableCollection: 'time_entry_reports',
    public: false,
    columns: params.columns,
    params: {
      '0': {
        '0': { date: { eq: '4' } },
        '1': { budget_id: { eq: [params.budget_id] } },
        '2': { 'service.billable': { eq: true } },
        '3': { billable_time: { gt: 0 } },
        '4': { billing_type_id: { eq: '2' } },
        $op: 'and',
      },
      $op: 'and',
    },
    sortBy: params.sort_by ?? 'day',
    groupBy: params.group_by ?? 'time-entry',
    layoutId: 103,
    chartTypeId: '3',
    reportLayoutId: '2',
    transposeBy: null,
    report: true,
    columnSettings: { person: { avatar: false } },
    formulas: {},
    exchangeCurrency: null,
    exchangeDate: { intervalId: '12', startDate: null, endDate: null, date: null },
    typeId: '2',
  };

  const exportB64 = Buffer.from(JSON.stringify(exportData)).toString('base64');
  const filterB64 = Buffer.from(JSON.stringify(filterData)).toString('base64');

  const innerUrl = `https://${appHost}/${orgId}/export/report/time_entry_reports?exportData=${exportB64}&filter=${filterB64}&download=true`;
  const outerB64 = Buffer.from(innerUrl).toString('base64');

  return `https://${exporterHost}/export?timezone=Bern&url=${encodeURIComponent(outerB64)}`;
}

export async function getTimesheetReportUrlTool(
  _client: ProductiveAPIClient,
  args: unknown,
  config: Config,
): Promise<{ content: Array<{ type: string; text: string }> }> {
  try {
    const params = getTimesheetReportUrlSchema.parse(args);
    const url = buildTimesheetReportUrl(params, config);

    return {
      content: [
        {
          type: 'text',
          text: `Timesheet report URL for "${params.title}":\n\n${url}\n\nOpen in browser (must be logged into Productive).`,
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

export const getTimesheetReportUrlDefinition = {
  name: 'get_timesheet_report_url',
  description:
    'Generate a PDF timesheet/time-entry report URL for a specific budget. Shows billable time entries with configurable columns, grouping, and sorting. NOT for invoice PDFs — use get_invoice_pdf_url for that. Use list_company_budgets to get budget_id. URL must be opened in a browser where the user is logged into Productive.',
  inputSchema: {
    type: 'object',
    required: ['budget_id', 'date_from', 'date_to', 'columns', 'name', 'title'],
    properties: {
      budget_id: { type: 'string', description: 'Budget/Deal ID' },
      date_from: { type: 'string', description: 'Start date YYYY-MM-DD' },
      date_to: { type: 'string', description: 'End date YYYY-MM-DD' },
      columns: {
        type: 'string',
        description:
          'Comma-separated columns. Available: "day", "person", "note", "billable-time", "task", "service"',
      },
      name: { type: 'string', description: 'PDF filename (e.g. "Zeitnachweis_20260011")' },
      title: { type: 'string', description: 'Title shown in PDF header' },
      group_by: {
        type: 'string',
        description: 'Grouping: "time-entry" (default), "task", "person", "service"',
      },
      sort_by: { type: 'string', description: 'Sort field (default: "day")' },
      orientation: { type: 'string', description: '"portrait" (default) or "landscape"' },
      page_size: { type: 'string', description: 'Page size (default: "A4")' },
    },
  },
  annotations: { readOnlyHint: true },
};

// ─── mark_invoice_paid ───────────────────────────────────────────────────────

const markInvoicePaidSchema = z.object({
  invoice_id: z.string().min(1),
  paid_on: z.string().optional(),
  note: z.string().optional(),
  confirm: z.boolean().optional(),
});

/**
 * Record a payment against an invoice, marking it as paid.
 *
 * Fetches the invoice first to calculate the remaining amount. Requires
 * explicit confirmation before creating the payment record.
 *
 * @param client - Productive API client
 * @param args - Tool arguments matching markInvoicePaidSchema
 * @returns MCP content response
 */
export async function markInvoicePaidTool(
  client: ProductiveAPIClient,
  args: unknown,
): Promise<{ content: Array<{ type: string; text: string }> }> {
  try {
    const params = markInvoicePaidSchema.parse(args);

    const invoiceResponse = await client.getInvoice(params.invoice_id);
    const attrs = invoiceResponse.data.attributes;

    // Amounts from API are in cents (integer strings)
    const amountWithTaxCents = parseInt(attrs.amount_with_tax ?? '0', 10);
    const remainingCents = parseInt(attrs.amount_unpaid ?? '0', 10);
    const currency = attrs.currency ?? '';

    const fmtAmount = (cents: number): string => (cents / 100).toFixed(2);

    if (remainingCents <= 0) {
      return {
        content: [
          {
            type: 'text',
            text: `Invoice ${params.invoice_id} is already fully paid (total: ${fmtAmount(amountWithTaxCents)} ${currency}).`,
          },
        ],
      };
    }

    const paidOn = params.paid_on ?? new Date().toISOString().slice(0, 10);

    if (!params.confirm) {
      return {
        content: [
          {
            type: 'text',
            text: [
              `Payment preview for invoice ${params.invoice_id}:`,
              `  Will pay: ${fmtAmount(remainingCents)} ${currency} (of total ${fmtAmount(amountWithTaxCents)} ${currency})`,
              `  Date: ${paidOn}`,
              params.note ? `  Note: ${params.note}` : null,
              ``,
              `Call again with confirm: true to record the payment.`,
            ]
              .filter(Boolean)
              .join('\n'),
          },
        ],
      };
    }

    const paymentData: ProductivePaymentCreate = {
      data: {
        type: 'payments',
        attributes: {
          amount: remainingCents.toString(),
          paid_on: paidOn,
          ...(params.note !== undefined && { note: params.note }),
        },
        relationships: {
          invoice: { data: { id: params.invoice_id, type: 'invoices' } },
        },
      },
    };

    await client.createPayment(paymentData);

    return {
      content: [
        {
          type: 'text',
          text: [
            `Payment recorded successfully!`,
            `  Invoice: ${params.invoice_id}`,
            `  Amount paid: ${fmtAmount(remainingCents)} ${currency}`,
            `  Date: ${paidOn}`,
            params.note ? `  Note: ${params.note}` : null,
          ]
            .filter(Boolean)
            .join('\n'),
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

export const markInvoicePaidDefinition = {
  name: 'mark_invoice_paid',
  description:
    'Mark an invoice as fully paid. Automatically calculates the remaining unpaid amount and creates a payment for that exact amount. Requires confirm: true to execute.',
  inputSchema: {
    type: 'object',
    properties: {
      invoice_id: {
        type: 'string',
        description: 'ID of the invoice to mark as paid',
      },
      paid_on: {
        type: 'string',
        description: 'Payment date in YYYY-MM-DD format (defaults to today)',
      },
      note: {
        type: 'string',
        description: 'Optional note to attach to the payment record',
      },
      confirm: {
        type: 'boolean',
        description: 'Must be true to record the payment',
      },
    },
    required: ['invoice_id'],
  },
};
