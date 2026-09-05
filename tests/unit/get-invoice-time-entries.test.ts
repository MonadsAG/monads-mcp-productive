import { describe, it, expect, vi } from 'vitest';
import { McpError } from '@modelcontextprotocol/sdk/types.js';
import type { ProductiveAPIClient } from '../../src/api/client.js';
import { ProductiveApiError } from '../../src/api/errors.js';
import type {
  ProductiveIncludedResource,
  ProductiveInvoice,
  ProductiveTimeEntry,
} from '../../src/api/types.js';
import { MAX_PAGE_SIZE } from '../../src/api/invoice-time-entries.js';
import { getInvoiceTimeEntriesTool } from '../../src/tools/invoice-time-entries.js';

const INVOICE_ID = '1476811';
const INVOICE_NUMBER = '20260035';

function invoice(id = INVOICE_ID, number = INVOICE_NUMBER): ProductiveInvoice {
  return {
    id,
    type: 'invoices',
    attributes: {
      number,
      invoiced_on: '2026-08-10',
      currency: 'CHF',
      amount_with_tax: '5042325',
      finalized_at: '2026-08-10T09:00:00Z',
      created_at: '2026-08-01T00:00:00Z',
      updated_at: '2026-08-10T09:00:00Z',
    },
    relationships: { company: { data: { id: '7', type: 'companies' } } },
  };
}

const COMPANY: ProductiveIncludedResource = {
  id: '7',
  type: 'companies',
  attributes: { name: 'Denner AG' },
};

const PEOPLE: ProductiveIncludedResource[] = [
  { id: '890553', type: 'people', attributes: { first_name: 'Fabian', last_name: 'Diehl' } },
];

function entry(
  id: string,
  date: string,
  time: number,
  billableTime: number,
  note?: string,
): ProductiveTimeEntry {
  return {
    id,
    type: 'time_entries',
    attributes: {
      date,
      time,
      billable_time: billableTime,
      note,
      created_at: `${date}T00:00:00Z`,
      updated_at: `${date}T00:00:00Z`,
    },
    relationships: {
      person: { data: { id: '890553', type: 'people' } },
      service: { data: { id: '15187717', type: 'services' } },
    },
  };
}

interface ClientOverrides {
  listInvoices?: ReturnType<typeof vi.fn>;
  getInvoice?: ReturnType<typeof vi.fn>;
  listTimeEntries?: ReturnType<typeof vi.fn>;
  listLineItems?: ReturnType<typeof vi.fn>;
}

function mockClient(overrides: ClientOverrides = {}): ProductiveAPIClient {
  return {
    listInvoices: vi.fn().mockResolvedValue({ data: [invoice()], included: [COMPANY] }),
    getInvoice: vi.fn().mockResolvedValue({ data: invoice(), included: [COMPANY] }),
    listTimeEntries: vi.fn().mockResolvedValue({
      data: [entry('1', '2026-07-30', 336, 360, '<ul><li><p>Werbeauslobung</p></li></ul>')],
      included: PEOPLE,
      meta: { total_count: 1, total_pages: 1 },
    }),
    listLineItems: vi.fn().mockResolvedValue({ data: [] }),
    ...overrides,
  } as unknown as ProductiveAPIClient;
}

async function run(client: ProductiveAPIClient, args: Record<string, unknown> = {}) {
  const result = await getInvoiceTimeEntriesTool(client, { invoice: INVOICE_NUMBER, ...args });
  return JSON.parse(result.content[0].text);
}

describe('get_invoice_time_entries', () => {
  it('returns parseable JSON carrying the invoice, totals and breakdowns', async () => {
    const payload = await run(mockClient());

    expect(payload.invoice).toMatchObject({
      id: INVOICE_ID,
      number: INVOICE_NUMBER,
      company: 'Denner AG',
      invoiced_on_formatted: '10.08.2026',
      amount: '50423.25',
      currency: 'CHF',
      state: 'finalized',
      matched_by: 'number',
    });
    expect(payload.complete).toBe(true);
    expect(payload.totals.entry_count).toBe(1);
    expect(payload.by_person[0].name).toBe('Fabian Diehl');
  });

  // The shape the tool exists for: both figures on every entry, the date in the
  // form a Swiss reader expects, and the note as a real list.
  it('reports tracked and billable time separately per entry', async () => {
    const payload = await run(mockClient());

    expect(payload.entries[0]).toMatchObject({
      date: '2026-07-30',
      date_formatted: '30.07.2026',
      person: { id: '890553', name: 'Fabian Diehl' },
      tracked: { minutes: 336, hours: 5.6, display: '5h 36m' },
      billable: { minutes: 360, hours: 6, display: '6h' },
      billable_differs: true,
      notes: ['Werbeauslobung'],
    });
  });

  it('totals both figures and their difference', async () => {
    const client = mockClient({
      listTimeEntries: vi.fn().mockResolvedValue({
        data: [entry('1', '2026-07-01', 480, 480), entry('2', '2026-07-02', 240, 360)],
        included: PEOPLE,
        meta: { total_count: 2, total_pages: 1 },
      }),
    });

    const payload = await run(client);

    expect(payload.totals.tracked.display).toBe('12h');
    expect(payload.totals.billable.display).toBe('14h');
    expect(payload.totals.difference.display).toBe('2h');
    expect(payload.totals.period).toEqual({ from: '2026-07-01', to: '2026-07-02' });
  });

  it('omits the entry list entirely in summary mode', async () => {
    const payload = await run(mockClient(), { detail: 'summary' });

    expect(payload).not.toHaveProperty('entries');
    expect(payload.totals.entry_count).toBe(1);
    expect(payload.by_service).toHaveLength(1);
  });

  it('asks the API for the invoice with a stable sort and full pages', async () => {
    const client = mockClient();

    await run(client);

    expect(client.listTimeEntries).toHaveBeenCalledWith(
      expect.objectContaining({ invoice_id: INVOICE_ID, sort: 'date', limit: MAX_PAGE_SIZE }),
    );
  });

  describe('invoice selector', () => {
    it('prefers a number match over an id match and says so', async () => {
      const client = mockClient({
        getInvoice: vi.fn().mockResolvedValue({ data: invoice('99999', '20250001') }),
      });

      const payload = await run(client);

      expect(payload.invoice.matched_by).toBe('number');
      expect(payload.invoice.id).toBe(INVOICE_ID);
      expect(payload.warnings.map((w: { code: string }) => w.code)).toContain('ambiguous_selector');
    });

    // filter[number] documents a `contains` operator, so a returned row is not
    // proof of an exact match.
    it('rejects a partial number match and falls back to the id lookup', async () => {
      const client = mockClient({
        listInvoices: vi.fn().mockResolvedValue({ data: [invoice(INVOICE_ID, '20260035')] }),
        getInvoice: vi.fn().mockResolvedValue({ data: invoice('2026003', '20259999') }),
      });

      const payload = await getInvoiceTimeEntriesTool(client, { invoice: '2026003' }).then((r) =>
        JSON.parse(r.content[0].text),
      );

      expect(payload.invoice.matched_by).toBe('id');
      expect(payload.invoice.id).toBe('2026003');
    });

    it('falls back to the id when no invoice carries that number', async () => {
      const client = mockClient({ listInvoices: vi.fn().mockResolvedValue({ data: [] }) });

      const payload = await run(client, { invoice: INVOICE_ID });

      expect(payload.invoice.matched_by).toBe('id');
    });

    it('refuses an ambiguous number rather than auditing one of them', async () => {
      const client = mockClient({
        listInvoices: vi.fn().mockResolvedValue({
          data: [invoice('1', INVOICE_NUMBER), invoice('2', INVOICE_NUMBER)],
        }),
      });

      await expect(run(client)).rejects.toThrow(/matches 2 invoices/);
    });

    it('reports a selector that matches nothing', async () => {
      const client = mockClient({
        listInvoices: vi.fn().mockResolvedValue({ data: [] }),
        getInvoice: vi.fn().mockRejectedValue(new ProductiveApiError('Not found', 404)),
      });

      await expect(run(client, { invoice: '404404' })).rejects.toThrow(/No invoice found/);
    });

    // Swallowing every error from getInvoice would turn an expired token into
    // "invoice not found" and send the caller after the wrong bug.
    it('propagates a non-404 failure instead of calling it "not found"', async () => {
      const client = mockClient({
        listInvoices: vi.fn().mockResolvedValue({ data: [] }),
        getInvoice: vi.fn().mockRejectedValue(new ProductiveApiError('Rate limited', 429)),
      });

      await expect(run(client, { invoice: '123' })).rejects.toThrow(/Rate limit/i);
      await expect(run(client, { invoice: '123' })).rejects.toBeInstanceOf(McpError);
    });
  });

  describe('reconciliation', () => {
    it('matches billable time against the line items', async () => {
      const client = mockClient({
        listLineItems: vi.fn().mockResolvedValue({
          data: [
            {
              id: '4143127',
              type: 'line_items',
              attributes: { description: 'AP1', quantity: '6', unit_id: 1 },
            },
          ],
        }),
      });

      const payload = await run(client);

      expect(payload.reconciliation).toMatchObject({
        status: 'ok',
        line_item_hours: 6,
        billable_hours: 6,
        difference_hours: 0,
      });
    });

    it('warns when line items and billable time disagree', async () => {
      const client = mockClient({
        listLineItems: vi.fn().mockResolvedValue({
          data: [{ id: '1', type: 'line_items', attributes: { quantity: '10', unit_id: 1 } }],
        }),
      });

      const payload = await run(client);

      expect(payload.reconciliation.status).toBe('mismatch');
      expect(payload.warnings.map((w: { code: string }) => w.code)).toContain(
        'reconciliation_mismatch',
      );
    });
  });

  describe('an invoice with no attributed entries', () => {
    const emptyClient = (lineItems: unknown[] = []) =>
      mockClient({
        listTimeEntries: vi
          .fn()
          .mockResolvedValue({ data: [], meta: { total_count: 0, total_pages: 1 } }),
        listLineItems: vi.fn().mockResolvedValue({ data: lineItems }),
      });

    it('reports zero rather than failing', async () => {
      const payload = await run(emptyClient());

      expect(payload.totals.entry_count).toBe(0);
      expect(payload.entries).toEqual([]);
      expect(payload.totals.period).toBeNull();
      expect(payload.by_person).toEqual([]);
    });

    it('explains an invoice that bills hours nobody tracked', async () => {
      const payload = await run(
        emptyClient([{ id: '1', type: 'line_items', attributes: { quantity: '31', unit_id: 1 } }]),
      );

      const codes = payload.warnings.map((w: { code: string }) => w.code);
      expect(codes).toContain('no_entries_but_billed_hours');
      // The generic mismatch story ("edited after finalization") is wrong when
      // there are no entries to edit, so it must not also fire.
      expect(codes).not.toContain('reconciliation_mismatch');
    });
  });

  describe('incomplete results', () => {
    function fullPage(offset: number) {
      return Array.from({ length: MAX_PAGE_SIZE }, (_, index) =>
        entry(String(offset + index), '2026-07-01', 60, 60),
      );
    }

    it('flags complete:false and warns when the page ceiling cuts the fetch short', async () => {
      const client = mockClient({
        listTimeEntries: vi.fn().mockImplementation((params: { page?: number }) =>
          Promise.resolve({
            data: fullPage(((params.page ?? 1) - 1) * MAX_PAGE_SIZE),
            included: PEOPLE,
            meta: { total_pages: 99 },
          }),
        ),
      });

      const payload = await run(client, { detail: 'summary' });

      expect(payload.complete).toBe(false);
      expect(payload.warnings.map((w: { code: string }) => w.code)).toContain('truncated');
    });

    it('flags complete:false when fewer rows came back than the API counted', async () => {
      const client = mockClient({
        listTimeEntries: vi.fn().mockResolvedValue({
          data: [entry('1', '2026-07-01', 60, 60)],
          included: PEOPLE,
          meta: { total_count: 5, total_pages: 1 },
        }),
      });

      const payload = await run(client);

      expect(payload.complete).toBe(false);
      expect(payload.warnings.map((w: { code: string }) => w.code)).toContain('count_mismatch');
    });

    it('drops the per-entry list when there are too many entries to render', async () => {
      const client = mockClient({
        listTimeEntries: vi.fn().mockResolvedValue({
          data: fullPage(0).concat(fullPage(MAX_PAGE_SIZE)).slice(0, 301),
          included: PEOPLE,
          meta: { total_count: 301, total_pages: 1 },
        }),
      });

      const payload = await run(client);

      expect(payload).not.toHaveProperty('entries');
      expect(payload.totals.entry_count).toBe(301);
      expect(payload.warnings.map((w: { code: string }) => w.code)).toContain(
        'degraded_to_summary',
      );
    });
  });
});
