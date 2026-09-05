/**
 * Arithmetic and paging for the invoice time-entry audit, kept free of the API
 * client so it is unit-testable without mocks -- the same split as
 * `src/api/capacity.ts` against `src/tools/capacity.ts`.
 *
 * The one number that matters here is that tracked and billable time are not
 * the same figure. In a 200-entry live sample, 9 entries billed MORE than was
 * tracked (rounding up: 336 -> 360 minutes) and one billed nothing against 450
 * tracked minutes. Both directions are normal, so every total is reported twice
 * and neither is derived from the other.
 */

import {
  ProductiveIncludedResource,
  ProductiveLineItem,
  ProductiveResponse,
  ProductiveTimeEntry,
} from './types.js';

/** Largest page the time-entries endpoint is asked for (the API's own maximum). */
export const MAX_PAGE_SIZE = 200;

/**
 * Hard ceiling on pages fetched for one invoice.
 *
 * 5 x 200 = 1000 entries against a live worst case of 79 on the busiest invoice
 * in the sandbox -- twelve times headroom, while still bounding the Worker's
 * subrequest budget and Productive's 100-requests-per-10s limit.
 */
export const MAX_TIME_ENTRY_PAGES = 5;

/** `unit_id` on a line item that makes `quantity` a number of hours. */
export const HOUR_UNIT_ID = 1;

/** Two line-item quantities closer than this count as equal (they are decimals). */
export const RECONCILE_TOLERANCE_HOURS = 0.01;

/** A span of time in the three shapes a caller might want it. */
export interface Duration {
  /** Source of truth. Everything else is derived from this. */
  minutes: number;
  /** Decimal hours -- the unit invoice line items are quantified in. */
  hours: number;
  /** Human form, e.g. `5h 36m`. */
  display: string;
}

export function durationOf(minutes: number): Duration {
  return {
    minutes,
    hours: Math.round((minutes / 60) * 100) / 100,
    display: formatDuration(minutes),
  };
}

/**
 * Render minutes as `5h 36m`.
 *
 * The twin of `formatMinutesDisplay` in `src/tools/time-entries.ts`, which this
 * cannot import without inverting the api/tools layering. It differs in one way
 * that matters: the sign is pulled out first, so a negative span (billable minus
 * tracked, when less was billed than tracked) reads `-5h 30m` rather than the
 * `-6h -30m` that flooring a negative quotient produces.
 */
function formatDuration(totalMinutes: number): string {
  const sign = totalMinutes < 0 ? '-' : '';
  const absolute = Math.abs(totalMinutes);
  const hours = Math.floor(absolute / 60);
  const minutes = absolute % 60;

  if (hours > 0) {
    return minutes > 0 ? `${sign}${hours}h ${minutes}m` : `${sign}${hours}h`;
  }
  return `${sign}${minutes}m`;
}

/**
 * `2026-09-05` -> `05.09.2026`.
 *
 * Deliberately a string split and not `new Date()`: `new Date('2026-09-05')` is
 * parsed as UTC midnight, so `.getDate()` in any negative-offset timezone yields
 * the 4th. The Worker's timezone is not the reader's, and an audit document that
 * shifts dates by one day depending on where it runs is worse than useless.
 * Anything that is not an ISO date comes back untouched.
 */
export function formatDateDe(isoDate: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!match) return isoDate;
  return `${match[3]}.${match[2]}.${match[1]}`;
}

/**
 * Tracked and billable time for one entry.
 *
 * `billable_time ?? time` and never `||`: zero is a real, live value (an entry
 * with 450 tracked minutes and 0 billable ones), and `||` would silently promote
 * it to 450 -- shifting the invoice reconciliation by 7.5 hours with no error.
 */
export function entryDurations(entry: ProductiveTimeEntry): {
  tracked: Duration;
  billable: Duration;
} {
  const tracked = entry.attributes.time ?? 0;
  const billable = entry.attributes.billable_time ?? tracked;
  return { tracked: durationOf(tracked), billable: durationOf(billable) };
}

/** One row of a per-person or per-service breakdown. */
export interface Subtotal {
  id: string | null;
  name: string;
  entry_count: number;
  tracked: Duration;
  billable: Duration;
}

/**
 * Group entries and total both time figures per group.
 *
 * `key` returns `id: null` for an entry whose relationship is missing; those
 * collect in one bucket rather than being dropped, so the subtotals always add
 * up to the report total.
 */
export function subtotalsBy(
  entries: ProductiveTimeEntry[],
  key: (entry: ProductiveTimeEntry) => { id: string | null; name: string },
): Subtotal[] {
  const groups = new Map<
    string,
    { id: string | null; name: string; count: number; tracked: number; billable: number }
  >();

  for (const entry of entries) {
    const { id, name } = key(entry);
    const bucket = groups.get(id ?? name) ?? { id, name, count: 0, tracked: 0, billable: 0 };
    const durations = entryDurations(entry);
    bucket.count += 1;
    bucket.tracked += durations.tracked.minutes;
    bucket.billable += durations.billable.minutes;
    groups.set(id ?? name, bucket);
  }

  return [...groups.values()]
    .map((bucket) => ({
      id: bucket.id,
      name: bucket.name,
      entry_count: bucket.count,
      tracked: durationOf(bucket.tracked),
      billable: durationOf(bucket.billable),
    }))
    .sort((a, b) => b.billable.minutes - a.billable.minutes);
}

export type ReconciliationStatus = 'ok' | 'mismatch' | 'not_comparable';

export interface ReconciledLineItem {
  id: string;
  description: string;
  quantity: number | null;
  unit_id: number | null;
  hours: number | null;
  reason?: string;
}

export interface Reconciliation {
  status: ReconciliationStatus;
  line_item_hours: number;
  billable_hours: number;
  difference_hours: number;
  line_items: ReconciledLineItem[];
  excluded: ReconciledLineItem[];
}

/**
 * Compare what the invoice bills against what the time entries hold.
 *
 * Only `unit_id === 1` items are summed. A piece or a day is not an hour, and a
 * live invoice (1439185) mixes both kinds -- adding a quantity of `1 piece` into
 * an hour total is the silent error this guards against. Excluded items are
 * returned with a reason rather than dropped, so the output never hides part of
 * the invoice.
 *
 * Residual limitation, deliberately not guessed at: for a percentage billing
 * type the spec says `quantity` is a percentage, but a line item carries no
 * billing-type field to detect that with. Such a row would have to pass through
 * `unit_id === 1` to be miscounted, which no observed invoice does.
 */
export function reconcile(
  lineItems: ProductiveLineItem[],
  billableMinutes: number,
  describe: (raw: string | undefined) => string,
): Reconciliation {
  const comparable: ReconciledLineItem[] = [];
  const excluded: ReconciledLineItem[] = [];

  for (const item of lineItems) {
    const unitId = item.attributes.unit_id ?? null;
    const quantity = parseQuantity(item.attributes.quantity);
    const row: ReconciledLineItem = {
      id: item.id,
      description: describe(item.attributes.description),
      quantity,
      unit_id: unitId,
      hours: null,
    };

    if (unitId !== HOUR_UNIT_ID) {
      excluded.push({ ...row, reason: `unit_id ${unitId ?? 'missing'} is not hours` });
    } else if (quantity === null) {
      excluded.push({ ...row, reason: 'quantity is missing or not numeric' });
    } else {
      comparable.push({ ...row, hours: quantity });
    }
  }

  const lineItemHours = round2(comparable.reduce((sum, row) => sum + (row.hours ?? 0), 0));
  const billableHours = durationOf(billableMinutes).hours;
  const difference = round2(lineItemHours - billableHours);

  return {
    status: statusFor(comparable.length, difference),
    line_item_hours: lineItemHours,
    billable_hours: billableHours,
    difference_hours: difference,
    line_items: comparable,
    excluded,
  };
}

/**
 * A line item quantity arrives as a decimal string (`"191.25"`), not a number.
 *
 * Reading it as a number is what made a perfectly reconcilable invoice report
 * `not_comparable` with both of its line items excluded -- caught only because
 * the tool was run against the live API. Numbers are accepted too, so a mocked
 * or future numeric payload behaves the same.
 */
function parseQuantity(raw: string | number | undefined): number | null {
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
  if (typeof raw !== 'string' || raw.trim() === '') return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

function statusFor(comparableCount: number, difference: number): ReconciliationStatus {
  if (comparableCount === 0) return 'not_comparable';
  return Math.abs(difference) < RECONCILE_TOLERANCE_HOURS ? 'ok' : 'mismatch';
}

/** One line item lined up against the service whose entries should back it. */
export interface ReconciledService {
  name: string;
  line_item_hours: number;
  billable_hours: number;
  difference_hours: number;
  status: 'ok' | 'mismatch';
}

/**
 * Best-effort per-service breakdown of the reconciliation.
 *
 * Returns `null` when the two sides cannot be lined up, which is the common
 * case and not an error: `/line_items` accepts no `include`, so a line item's
 * service cannot be sideloaded and the only available join is its description.
 * That description is whatever `generate_line_items` wrote -- service names on
 * one live invoice (`AP1 - ...`), task names on another (`#940 - ...`). When no
 * line item matches a service name, only the total is trustworthy and the caller
 * says so instead of inventing rows.
 */
export function reconcileByService(
  comparable: ReconciledLineItem[],
  serviceSubtotals: Subtotal[],
): ReconciledService[] | null {
  const rows: ReconciledService[] = [];
  const claimed = new Set<string>();

  for (const service of serviceSubtotals) {
    const match = comparable.find((item) => item.description.startsWith(service.name));
    // A prefix match is not exclusive: with services "Beratung" and "Beratung
    // Zusatz", the one line item "Beratung Zusatz - Mai" starts with both names
    // and each row would then claim its full hours, reporting the invoice twice.
    // The mapping is ambiguous in that case, which is the same situation as no
    // match at all -- say so instead of inventing a breakdown that double-counts.
    if (!match || claimed.has(match.id)) return null;
    claimed.add(match.id);

    const lineItemHours = match.hours ?? 0;
    const difference = round2(lineItemHours - service.billable.hours);
    rows.push({
      name: service.name,
      line_item_hours: lineItemHours,
      billable_hours: service.billable.hours,
      difference_hours: difference,
      status: Math.abs(difference) < RECONCILE_TOLERANCE_HOURS ? 'ok' : 'mismatch',
    });
  }

  return rows.length > 0 ? rows : null;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export interface CollectedPages<T> {
  rows: T[];
  included: ProductiveIncludedResource[];
  /** True when the page ceiling cut the fetch short. */
  truncated: boolean;
  /** `meta.total_count` as page 1 reported it, when the API sent one. */
  expected?: number;
}

/**
 * Page through a list endpoint until it runs out.
 *
 * Takes a callback rather than a client so it can be tested without any HTTP
 * mock. Two stop conditions, both needed: `meta.total_pages` when the API sends
 * it, and a short page regardless of what meta said.
 *
 * Rows are deduplicated by id, and `expected` is carried out so the caller can
 * notice a mismatch. That matters more here than for bookings: `/time_entries`
 * rejects every sort key but `date`, which is not unique, so rows sharing a date
 * can in principle be ordered differently between two page requests and one
 * could slip across a boundary. Deduplication cannot see that happen; comparing
 * the final count against `expected` can.
 */
export async function collectPages<T extends { id: string }>(
  fetchPage: (page: number) => Promise<ProductiveResponse<T>>,
  maxPages: number = MAX_TIME_ENTRY_PAGES,
  // The size `fetchPage` actually asks for. The short-page stop compares
  // against this, so a caller requesting smaller pages must say so or every
  // full page looks short and the sweep stops after the first one.
  pageSize: number = MAX_PAGE_SIZE,
): Promise<CollectedPages<T>> {
  const byId = new Map<string, T>();
  const included: ProductiveIncludedResource[] = [];
  let expected: number | undefined;

  for (let page = 1; page <= maxPages; page += 1) {
    const response = await fetchPage(page);
    const rows = response.data ?? [];

    for (const row of rows) byId.set(row.id, row);
    included.push(...(response.included ?? []));
    if (page === 1) expected = response.meta?.total_count;

    const totalPages = response.meta?.total_pages;
    if (typeof totalPages === 'number' && page >= totalPages) break;
    if (rows.length < pageSize) break;
    if (page === maxPages) {
      return { rows: [...byId.values()], included, truncated: true, expected };
    }
  }

  return { rows: [...byId.values()], included, truncated: false, expected };
}
