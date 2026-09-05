import { z } from 'zod';
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import { ProductiveAPIClient } from '../api/client.js';
import { ProductiveApiError } from '../api/errors.js';
import {
  ProductiveIncludedResource,
  ProductiveInvoice,
  ProductiveTimeEntry,
} from '../api/types.js';
import {
  collectPages,
  durationOf,
  entryDurations,
  formatDateDe,
  reconcile,
  reconcileByService,
  subtotalsBy,
  MAX_PAGE_SIZE,
  MAX_TIME_ENTRY_PAGES,
  type Duration,
} from '../api/invoice-time-entries.js';
import { noteToBullets } from '../api/time-entry-notes.js';
import { buildIncludeMap, resolveName } from './include-resolver.js';
import { formatAmount, resolveCompanyName } from './invoices.js';
import { toMcpError } from '../utils/errors.js';

/**
 * Above this many entries the per-entry list is dropped and only the summary is
 * returned. The busiest invoice in the live org holds 79, but the page ceiling
 * allows 1000, and 1000 entries of JSON is not a usable tool response.
 */
const MAX_FULL_DETAIL_ENTRIES = 300;

/** One page is plenty: the busiest live invoice carries two line items. */
const LINE_ITEM_PAGE_SIZE = 200;

const getInvoiceTimeEntriesSchema = z.object({
  invoice: z.preprocess(
    (value) => (typeof value === 'number' ? String(value) : value),
    z.string().trim().min(1, 'Invoice number or ID is required'),
  ),
  detail: z.enum(['full', 'summary']).default('full'),
});

interface Warning {
  code: string;
  message: string;
}

interface ResolvedInvoice {
  invoice: ProductiveInvoice;
  included?: ProductiveIncludedResource[];
  matchedBy: 'id' | 'number';
  warnings: Warning[];
}

/**
 * A 404 is the only answer that means "this is not an invoice ID".
 *
 * Catching everything would reinterpret an expired token (401) or a rate limit
 * (429) as "invoice not found" and send the caller hunting for the wrong bug.
 */
async function getInvoiceOrNull(client: ProductiveAPIClient, id: string) {
  try {
    return await client.getInvoice(id);
  } catch (error) {
    if (error instanceof ProductiveApiError && error.httpStatus === 404) return null;
    throw error;
  }
}

/**
 * Accept either the number a human reads off the invoice or the internal ID.
 *
 * Both are digit strings, so both lookups run and the number wins: `20260035`
 * is a plausible ID too, and silently auditing the wrong invoice is the failure
 * this is built to avoid. When the two resolve to different invoices the caller
 * is told rather than blocked.
 */
async function resolveInvoice(
  client: ProductiveAPIClient,
  selector: string,
): Promise<ResolvedInvoice> {
  const [byNumber, byId] = await Promise.all([
    client.listInvoices({ number: selector, limit: 2 }),
    /^\d+$/.test(selector) ? getInvoiceOrNull(client, selector) : Promise.resolve(null),
  ]);

  // filter[number] documents a `contains` operator, so a returned row is not
  // proof of an exact match: without this, "2026003" would audit "20260035".
  const exact = (byNumber.data ?? []).filter((row) => row.attributes.number === selector);

  if (exact.length > 1) {
    throw new McpError(
      ErrorCode.InvalidParams,
      `Invoice number "${selector}" matches ${exact.length} invoices (IDs ${exact
        .map((row) => row.id)
        .join(', ')}). Pass the invoice ID instead.`,
    );
  }

  if (exact.length === 1) {
    const warnings: Warning[] = [];
    if (byId && byId.data.id !== exact[0].id) {
      warnings.push({
        code: 'ambiguous_selector',
        message:
          `"${selector}" is both an invoice number (ID ${exact[0].id}) and the ID of a ` +
          `different invoice (${byId.data.id}). Matched by number; pass the ID to force the other.`,
      });
    }
    return { invoice: exact[0], included: byNumber.included, matchedBy: 'number', warnings };
  }

  if (byId) {
    return { invoice: byId.data, included: byId.included, matchedBy: 'id', warnings: [] };
  }

  throw new McpError(
    ErrorCode.InvalidParams,
    `No invoice found with number or ID "${selector}". Use list_invoices to find it.`,
  );
}

/** A related record, or null when the entry carries no such relationship. */
function relationshipRef(
  names: Map<string, string>,
  type: string,
  id: string | undefined,
  label: string,
): { id: string; name: string } | null {
  if (!id) return null;
  // Falling back to `${label} #${id}` and not "Unknown": a sideload can be
  // missing for a deactivated person, and "Unknown" would merge several
  // distinct people into one subtotal row that silently reports the wrong hours.
  return { id, name: resolveName(names, type, id) ?? `${label} #${id}` };
}

function toEntryJson(entry: ProductiveTimeEntry, names: Map<string, string>) {
  const { tracked, billable } = entryDurations(entry);
  const date = entry.attributes.date;

  return {
    id: entry.id,
    date,
    date_formatted: formatDateDe(date),
    person: relationshipRef(names, 'people', entry.relationships?.person?.data?.id, 'Person'),
    service: relationshipRef(names, 'services', entry.relationships?.service?.data?.id, 'Service'),
    task: relationshipRef(names, 'tasks', entry.relationships?.task?.data?.id, 'Task'),
    tracked,
    billable,
    billable_differs: tracked.minutes !== billable.minutes,
    notes: noteToBullets(entry.attributes.note),
  };
}

type GroupKey = (entry: ProductiveTimeEntry) => { id: string | null; name: string };

/**
 * Group key for the per-person and per-service breakdowns.
 *
 * An entry whose relationship is missing lands in one `Unattributed` bucket
 * rather than being skipped, so the breakdowns always add back up to the total.
 */
function groupKey(
  names: Map<string, string>,
  type: string,
  label: string,
  idOf: (entry: ProductiveTimeEntry) => string | undefined,
): GroupKey {
  return (entry) => {
    const id = idOf(entry);
    if (!id) return { id: null, name: 'Unattributed' };
    return { id, name: resolveName(names, type, id) ?? `${label} #${id}` };
  };
}

const personIdOf = (entry: ProductiveTimeEntry): string | undefined =>
  entry.relationships?.person?.data?.id;

const serviceIdOf = (entry: ProductiveTimeEntry): string | undefined =>
  entry.relationships?.service?.data?.id;

function periodOf(entries: ProductiveTimeEntry[]): { from: string; to: string } | null {
  if (entries.length === 0) return null;
  const dates = entries.map((entry) => entry.attributes.date).sort();
  return { from: dates[0], to: dates[dates.length - 1] };
}

function totalsOf(entries: ProductiveTimeEntry[]): {
  tracked: Duration;
  billable: Duration;
  difference: Duration;
} {
  let tracked = 0;
  let billable = 0;
  for (const entry of entries) {
    const durations = entryDurations(entry);
    tracked += durations.tracked.minutes;
    billable += durations.billable.minutes;
  }
  return {
    tracked: durationOf(tracked),
    billable: durationOf(billable),
    difference: durationOf(billable - tracked),
  };
}

/** Line item descriptions are rich text too, so they get the same treatment. */
function describeLineItem(raw: string | undefined): string {
  return noteToBullets(raw).join(' ') || '(no description)';
}

function invoiceJson(resolved: ResolvedInvoice) {
  const attributes = resolved.invoice.attributes;
  const invoicedOn = attributes.invoiced_on;

  return {
    id: resolved.invoice.id,
    number: attributes.number ?? null,
    company: resolveCompanyName(resolved.invoice, resolved.included),
    invoiced_on: invoicedOn ?? null,
    invoiced_on_formatted: invoicedOn ? formatDateDe(invoicedOn) : null,
    amount: formatAmount(attributes.amount_with_tax),
    currency: attributes.currency ?? null,
    state: attributes.finalized_at ? 'finalized' : 'draft',
    matched_by: resolved.matchedBy,
  };
}

export async function getInvoiceTimeEntriesTool(
  client: ProductiveAPIClient,
  args: unknown,
): Promise<{ content: Array<{ type: string; text: string }> }> {
  try {
    const params = getInvoiceTimeEntriesSchema.parse(args);
    const resolved = await resolveInvoice(client, params.invoice);
    const warnings = [...resolved.warnings];

    const collected = await collectPages<ProductiveTimeEntry>((page) =>
      client.listTimeEntries({
        invoice_id: resolved.invoice.id,
        // The only sort this endpoint accepts that is also the order the report
        // wants. It is not unique, which is what `expected` below guards.
        sort: 'date',
        limit: MAX_PAGE_SIZE,
        page,
      }),
    );

    const lineItemsResponse = await client.listLineItems({
      invoice_id: resolved.invoice.id,
      limit: LINE_ITEM_PAGE_SIZE,
    });
    const lineItems = lineItemsResponse.data ?? [];

    const names = buildIncludeMap(collected.included);
    const personKey = groupKey(names, 'people', 'Person', personIdOf);
    const serviceKey = groupKey(names, 'services', 'Service', serviceIdOf);

    const entries = [...collected.rows].sort(byDateThenPerson(personKey));
    const totals = totalsOf(entries);

    const reconciliation = reconcile(lineItems, totals.billable.minutes, describeLineItem);
    const byPerson = subtotalsBy(entries, personKey);
    const byService = subtotalsBy(entries, serviceKey);

    warnings.push(
      ...collectWarnings({ collected, entries, lineItems, reconciliation, detail: params.detail }),
    );

    const includeEntries = params.detail === 'full' && entries.length <= MAX_FULL_DETAIL_ENTRIES;

    const payload = {
      invoice: invoiceJson(resolved),
      complete: !collected.truncated && !hasCountMismatch(collected, entries),
      warnings,
      totals: {
        entry_count: entries.length,
        period: periodOf(entries),
        tracked: totals.tracked,
        billable: totals.billable,
        difference: totals.difference,
      },
      ...(includeEntries ? { entries: entries.map((entry) => toEntryJson(entry, names)) } : {}),
      by_person: byPerson,
      by_service: byService,
      reconciliation: {
        ...reconciliation,
        by_service: reconcileByService(reconciliation.line_items, byService),
      },
    };

    return { content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }] };
  } catch (error) {
    throw toMcpError(error);
  }
}

/**
 * Chronological, then stable.
 *
 * The API is asked for `sort=date` but that is its only accepted sort key and it
 * is not unique, so the order within one day is whatever came back. Sorting
 * again here means two runs of this tool produce byte-identical output, which is
 * what makes the result diffable as an audit document.
 */
function byDateThenPerson(
  person: GroupKey,
): (a: ProductiveTimeEntry, b: ProductiveTimeEntry) => number {
  return (a, b) => {
    const byDate = a.attributes.date.localeCompare(b.attributes.date);
    if (byDate !== 0) return byDate;
    const byPerson = person(a).name.localeCompare(person(b).name);
    if (byPerson !== 0) return byPerson;
    return Number(a.id) - Number(b.id);
  };
}

function hasCountMismatch(
  collected: { expected?: number; truncated: boolean },
  entries: ProductiveTimeEntry[],
): boolean {
  if (collected.truncated || collected.expected === undefined) return false;
  return collected.expected !== entries.length;
}

function collectWarnings(input: {
  collected: { expected?: number; truncated: boolean };
  entries: ProductiveTimeEntry[];
  lineItems: unknown[];
  reconciliation: { status: string; line_item_hours: number };
  detail: 'full' | 'summary';
}): Warning[] {
  const warnings: Warning[] = [];
  const { collected, entries, lineItems, reconciliation, detail } = input;

  if (collected.truncated) {
    warnings.push({
      code: 'truncated',
      message:
        `Only the first ${MAX_TIME_ENTRY_PAGES * MAX_PAGE_SIZE} time entries were read and there ` +
        `are more. Every total below is missing time and the reconciliation cannot be trusted.`,
    });
  }

  if (hasCountMismatch(collected, entries)) {
    warnings.push({
      code: 'count_mismatch',
      message:
        `Productive reports ${collected.expected} entries for this invoice but ${entries.length} ` +
        `were read — rows moved between page requests. The totals below are incomplete.`,
    });
  }

  if (entries.length === 0 && reconciliation.line_item_hours > 0) {
    warnings.push({
      code: 'no_entries_but_billed_hours',
      message:
        `The invoice bills ${reconciliation.line_item_hours} h but no time entry is attributed to ` +
        `it. Either the line items were written by hand rather than generated from tracked time, ` +
        `or the invoice is still a draft — attribution is written when generate_line_items runs.`,
    });
  }

  // Suppressed when there are no entries at all: the warning above already
  // explains that case, and "entries were edited after finalization" is the
  // wrong story to tell about an invoice that has no entries to edit.
  if (reconciliation.status === 'mismatch' && entries.length > 0) {
    warnings.push({
      code: 'reconciliation_mismatch',
      message:
        'Line items and billable time disagree. On a finalized invoice this usually means entries ' +
        'were edited after finalization: line items freeze, the time behind them does not.',
    });
  }

  if (lineItems.length >= LINE_ITEM_PAGE_SIZE) {
    warnings.push({
      code: 'line_items_truncated',
      message: `Only the first ${LINE_ITEM_PAGE_SIZE} line items were compared.`,
    });
  }

  if (detail === 'full' && entries.length > MAX_FULL_DETAIL_ENTRIES) {
    warnings.push({
      code: 'degraded_to_summary',
      message:
        `${entries.length} entries is too many for the per-entry list, so it was omitted. ` +
        `The totals and breakdowns below cover all of them.`,
    });
  }

  return warnings;
}

export const getInvoiceTimeEntriesDefinition = {
  name: 'get_invoice_time_entries',
  description:
    'Audit which time entries an invoice bills, as structured JSON. Returns tracked AND billable ' +
    'time per entry and in total — the two differ in practice (rounding up, non-billable work) — ' +
    'plus per-person and per-service breakdowns and a reconciliation against the invoice line ' +
    'items. Accepts the invoice number (e.g. "20260035") or the internal ID. Note that this ' +
    'returns every time entry note on the invoice, so the response can be large; pass ' +
    'detail: "summary" for totals only.',
  inputSchema: {
    type: 'object',
    required: ['invoice'],
    properties: {
      invoice: {
        type: 'string',
        description:
          'Invoice number as printed on the document (e.g. "20260035") or the internal invoice ID. ' +
          'The number wins if a value is both.',
      },
      detail: {
        type: 'string',
        enum: ['full', 'summary'],
        description:
          '"full" (default) includes every time entry with its notes; "summary" returns only ' +
          'totals, breakdowns and the reconciliation.',
      },
    },
  },
  annotations: {
    title: 'Get invoice time entries',
    readOnlyHint: true,
    openWorldHint: true,
  },
};
