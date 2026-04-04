import { ProductiveAPIClient } from '../api/client.js';
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';

export interface InvoiceDefaults {
  document_type_id: string;
  tax_rate_id: string;
  subsidiary_id: string | null;
  note_template: string | null;
  footer_template: string | null;
  locale: string | null;
}

export async function resolveInvoiceDefaults(
  client: ProductiveAPIClient,
): Promise<InvoiceDefaults> {
  const [docTypes, taxRates, subsidiaries] = await Promise.all([
    client.listDocumentTypes({ limit: 200 }),
    client.listTaxRates({ limit: 200 }),
    client.listSubsidiaries(),
  ]);

  // Document Type: filter for invoices (exportable_type_id === 1) that are not archived
  const activeInvoiceTypes = (docTypes.data ?? []).filter(
    (dt) => dt.attributes.exportable_type_id === 1 && !dt.attributes.archived_at,
  );

  let document_type_id: string;
  let note_template: string | null = null;
  let footer_template: string | null = null;
  let locale: string | null = null;

  if (activeInvoiceTypes.length === 0) {
    throw new McpError(ErrorCode.InternalError, 'No active invoice document type found.');
  } else if (activeInvoiceTypes.length === 1) {
    const dt = activeInvoiceTypes[0];
    document_type_id = dt.id;
    note_template = (dt.attributes.note as string) ?? null;
    footer_template = (dt.attributes.footer as string) ?? null;
    locale = (dt.attributes.locale as string) ?? null;
  } else {
    const list = activeInvoiceTypes
      .map((dt, i) => `${i + 1}. ${dt.attributes.name} (ID: ${dt.id})`)
      .join('\n');
    throw new McpError(
      ErrorCode.InvalidParams,
      `Multiple invoice templates found. Please choose:\n${list}\n\nCall again with document_type_id.`,
    );
  }

  // Tax Rate: filter for not archived
  const activeTaxRates = (taxRates.data ?? []).filter((tr) => !tr.attributes.archived_at);

  let tax_rate_id: string;

  if (activeTaxRates.length === 0) {
    throw new McpError(ErrorCode.InternalError, 'No active tax rate found.');
  } else if (activeTaxRates.length === 1) {
    tax_rate_id = activeTaxRates[0].id;
  } else {
    const list = activeTaxRates
      .map(
        (tr, i) =>
          `${i + 1}. ${tr.attributes.name} — ${tr.attributes.primary_component_value}% (ID: ${tr.id})`,
      )
      .join('\n');
    throw new McpError(
      ErrorCode.InvalidParams,
      `Multiple tax rates found. Please choose:\n${list}\n\nCall again with tax_rate_id.`,
    );
  }

  // Subsidiary: filter for not archived
  const activeSubsidiaries = (subsidiaries.data ?? []).filter((s) => !s.attributes.archived_at);

  let subsidiary_id: string | null = null;

  if (activeSubsidiaries.length === 1) {
    subsidiary_id = activeSubsidiaries[0].id;
  } else if (activeSubsidiaries.length > 1) {
    const list = activeSubsidiaries
      .map((s, i) => `${i + 1}. ${s.attributes.name} (ID: ${s.id})`)
      .join('\n');
    throw new McpError(
      ErrorCode.InvalidParams,
      `Multiple subsidiaries found. Please choose:\n${list}\n\nCall again with subsidiary_id.`,
    );
  }

  return {
    document_type_id,
    tax_rate_id,
    subsidiary_id,
    note_template,
    footer_template,
    locale,
  };
}
