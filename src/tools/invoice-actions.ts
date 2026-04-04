import { z } from 'zod';
import { ProductiveAPIClient } from '../api/client.js';
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
