import { describe, it, expect, vi } from 'vitest';
import type {
  ProductiveLineItem,
  ProductiveResponse,
  ProductiveTimeEntry,
} from '../../src/api/types.js';
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
} from '../../src/api/invoice-time-entries.js';

function entry(
  id: string,
  time: number,
  billableTime?: number,
  relationships?: ProductiveTimeEntry['relationships'],
): ProductiveTimeEntry {
  return {
    id,
    type: 'time_entries',
    attributes: {
      date: '2026-07-01',
      time,
      ...(billableTime === undefined ? {} : { billable_time: billableTime }),
      created_at: '2026-07-01T00:00:00Z',
      updated_at: '2026-07-01T00:00:00Z',
    },
    relationships,
  };
}

function lineItem(
  id: string,
  quantity: string | number | undefined,
  unitId?: number,
): ProductiveLineItem {
  return {
    id,
    type: 'line_items',
    attributes: { description: `Item ${id}`, quantity, unit_id: unitId },
  };
}

const plainDescription = (raw: string | undefined) => raw ?? '(no description)';

describe('formatDateDe', () => {
  it('reorders an ISO date into DD.MM.YYYY', () => {
    expect(formatDateDe('2026-09-05')).toBe('05.09.2026');
  });

  // The point of not using `new Date()`: it parses an ISO date as UTC midnight,
  // so getDate() in any negative-offset timezone returns the previous day. This
  // test would fail for a Date-based implementation when TZ is west of UTC.
  it('does not shift the day (no Date parsing)', () => {
    expect(formatDateDe('2026-01-01')).toBe('01.01.2026');
    expect(formatDateDe('2026-12-31')).toBe('31.12.2026');
  });

  it('passes anything that is not an ISO date straight through', () => {
    expect(formatDateDe('')).toBe('');
    expect(formatDateDe('05.09.2026')).toBe('05.09.2026');
  });
});

describe('durationOf', () => {
  it('reports minutes, decimal hours and a display string', () => {
    expect(durationOf(336)).toEqual({ minutes: 336, hours: 5.6, display: '5h 36m' });
    expect(durationOf(360)).toEqual({ minutes: 360, hours: 6, display: '6h' });
    expect(durationOf(45)).toEqual({ minutes: 45, hours: 0.75, display: '45m' });
    expect(durationOf(0)).toEqual({ minutes: 0, hours: 0, display: '0m' });
  });

  // A difference can be negative (less billed than tracked). Flooring a negative
  // quotient without pulling the sign out first yields "-6h -30m".
  it('renders a negative span with one leading sign', () => {
    expect(durationOf(-330).display).toBe('-5h 30m');
    expect(durationOf(-300).display).toBe('-5h');
    expect(durationOf(-20).display).toBe('-20m');
  });
});

describe('entryDurations', () => {
  it('falls back to tracked time when billable_time is absent', () => {
    expect(entryDurations(entry('1', 480)).billable.minutes).toBe(480);
  });

  // The `??` vs `||` regression. Zero billable minutes against 450 tracked ones
  // is a live, non-billable entry; `||` would report 450 and move an invoice
  // reconciliation by 7.5 hours without any error.
  it('keeps a billable_time of zero instead of falling back', () => {
    const durations = entryDurations(entry('1', 450, 0));

    expect(durations.tracked.minutes).toBe(450);
    expect(durations.billable.minutes).toBe(0);
  });

  it('handles billable time above tracked time (live: rounding up)', () => {
    const durations = entryDurations(entry('1', 336, 360));

    expect(durations.tracked.display).toBe('5h 36m');
    expect(durations.billable.display).toBe('6h');
  });
});

describe('subtotalsBy', () => {
  const person = (id: string) => ({ person: { data: { id, type: 'people' as const } } });

  it('totals both figures per group, busiest first', () => {
    const rows = subtotalsBy(
      [
        entry('1', 60, 60, person('a')),
        entry('2', 120, 180, person('b')),
        entry('3', 60, 60, person('a')),
      ],
      (row) => ({
        id: row.relationships?.person?.data?.id ?? null,
        name: `P${row.relationships?.person?.data?.id}`,
      }),
    );

    expect(rows.map((row) => [row.name, row.entry_count, row.billable.minutes])).toEqual([
      ['Pb', 1, 180],
      ['Pa', 2, 120],
    ]);
  });

  // Dropping these would make the breakdowns disagree with the report total.
  it('collects entries with no relationship into one bucket rather than dropping them', () => {
    const rows = subtotalsBy([entry('1', 60), entry('2', 30)], () => ({
      id: null,
      name: 'Unattributed',
    }));

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: null, name: 'Unattributed', entry_count: 2 });
    expect(rows[0].tracked.minutes).toBe(90);
  });
});

describe('reconcile', () => {
  // Live shape: the API sends quantity as a decimal string, not a number.
  // Reading it as a number reported a perfectly matching invoice as
  // "not_comparable" with both line items excluded.
  it('parses a decimal-string quantity', () => {
    const result = reconcile(
      [lineItem('1', '191.25', 1), lineItem('2', '54.25', 1)],
      14730,
      plainDescription,
    );

    expect(result.status).toBe('ok');
    expect(result.line_item_hours).toBe(245.5);
    expect(result.billable_hours).toBe(245.5);
    expect(result.difference_hours).toBe(0);
    expect(result.excluded).toEqual([]);
  });

  it('accepts a numeric quantity too', () => {
    expect(reconcile([lineItem('1', 3, 1)], 180, plainDescription).status).toBe('ok');
  });

  // Live: invoice 1439185 mixes an hour line item with a "piece" one. Summing
  // the piece as an hour is the silent error this guards.
  it('excludes a line item whose unit is not hours', () => {
    const result = reconcile(
      [lineItem('1', '31', 1), lineItem('2', '1', 2)],
      1860,
      plainDescription,
    );

    expect(result.status).toBe('ok');
    expect(result.line_item_hours).toBe(31);
    expect(result.excluded).toHaveLength(1);
    expect(result.excluded[0].reason).toContain('not hours');
  });

  it('excludes a line item with an unreadable quantity', () => {
    const result = reconcile([lineItem('1', undefined, 1)], 0, plainDescription);

    expect(result.status).toBe('not_comparable');
    expect(result.excluded[0].reason).toContain('not numeric');
  });

  it('reports a mismatch with the signed difference', () => {
    const result = reconcile([lineItem('1', '188', 1)], 11475, plainDescription);

    expect(result.status).toBe('mismatch');
    expect(result.difference_hours).toBe(-3.25);
  });

  it('is not_comparable when nothing can be compared', () => {
    expect(reconcile([], 600, plainDescription).status).toBe('not_comparable');
  });

  // Quantities are decimals; an exact float comparison would call these unequal.
  it('treats a sub-cent rounding difference as equal', () => {
    expect(reconcile([lineItem('1', '0.33', 1)], 20, plainDescription).status).toBe('ok');
  });
});

describe('reconcileByService', () => {
  const subtotal = (name: string, billableMinutes: number) => ({
    id: name,
    name,
    entry_count: 1,
    tracked: durationOf(billableMinutes),
    billable: durationOf(billableMinutes),
  });

  it('lines up line items with the services whose entries back them', () => {
    const { line_items } = reconcile([lineItem('1', '191.25', 1)], 11475, () => 'AP1 - Konzeption');

    const rows = reconcileByService(line_items, [subtotal('AP1 - Konzeption', 11475)]);

    expect(rows).toEqual([
      {
        name: 'AP1 - Konzeption',
        line_item_hours: 191.25,
        billable_hours: 191.25,
        difference_hours: 0,
        status: 'ok',
      },
    ]);
  });

  // `/line_items` accepts no `include`, so the only join is the description --
  // and on an invoice generated per task it reads "#940 - ...", not a service
  // name. Inventing rows there would be worse than saying nothing.
  it('returns null when descriptions do not map to service names', () => {
    const { line_items } = reconcile([lineItem('1', '3', 1)], 180, () => '#940 - Versandanweisung');

    expect(reconcileByService(line_items, [subtotal('Development', 180)])).toBeNull();
  });
});

describe('collectPages', () => {
  function page(rows: number, meta?: { total_pages?: number; total_count?: number }, offset = 0) {
    return {
      data: Array.from({ length: rows }, (_, index) => ({ id: String(offset + index) })),
      meta,
    } as ProductiveResponse<{ id: string }>;
  }

  it('stops after a short page', async () => {
    const fetchPage = vi.fn().mockResolvedValue(page(3, { total_count: 3 }));

    const result = await collectPages(fetchPage);

    expect(fetchPage).toHaveBeenCalledTimes(1);
    expect(result.rows).toHaveLength(3);
    expect(result.truncated).toBe(false);
    expect(result.expected).toBe(3);
  });

  it('follows meta.total_pages to the last page', async () => {
    const fetchPage = vi
      .fn()
      .mockImplementation((pageNumber: number) =>
        Promise.resolve(
          pageNumber === 1
            ? page(MAX_PAGE_SIZE, { total_pages: 2, total_count: MAX_PAGE_SIZE + 5 })
            : page(5, undefined, MAX_PAGE_SIZE),
        ),
      );

    const result = await collectPages(fetchPage);

    expect(fetchPage).toHaveBeenCalledTimes(2);
    expect(result.rows).toHaveLength(MAX_PAGE_SIZE + 5);
    expect(result.expected).toBe(MAX_PAGE_SIZE + 5);
  });

  // `sort=date` is the only sort this endpoint takes and it is not unique, so a
  // row can in principle be served twice across a page boundary.
  it('deduplicates rows that appear on two pages', async () => {
    const fetchPage = vi
      .fn()
      .mockImplementation((pageNumber: number) =>
        Promise.resolve(
          pageNumber === 1
            ? page(MAX_PAGE_SIZE, { total_pages: 2 })
            : page(5, undefined, MAX_PAGE_SIZE - 2),
        ),
      );

    const result = await collectPages(fetchPage);

    expect(result.rows).toHaveLength(MAX_PAGE_SIZE + 3);
    expect(new Set(result.rows.map((row) => row.id)).size).toBe(result.rows.length);
  });

  it('stops at the page ceiling and says the result is truncated', async () => {
    const fetchPage = vi
      .fn()
      .mockImplementation((pageNumber: number) =>
        Promise.resolve(page(MAX_PAGE_SIZE, { total_pages: 99 }, (pageNumber - 1) * MAX_PAGE_SIZE)),
      );

    const result = await collectPages(fetchPage);

    expect(fetchPage).toHaveBeenCalledTimes(MAX_TIME_ENTRY_PAGES);
    expect(result.truncated).toBe(true);
  });
});
