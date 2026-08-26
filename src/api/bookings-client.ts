/**
 * Shared building blocks for every bookings-based tool (absences and project
 * capacity alike). Deliberately free of API calls so the logic is unit-testable
 * on its own -- the HTTP methods live on ProductiveAPIClient and consume these.
 *
 * Background and evidence: docs/resource-management-spec.md
 */
import type { ProductiveBooking, ProductiveEvent } from './types.js';

/** booking_method_id values as documented by the API. */
export const BOOKING_METHOD = {
  HOURS_PER_DAY: 1,
  PERCENTAGE: 2,
  TOTAL_HOURS: 3,
} as const;

export type BookingMethodId = (typeof BOOKING_METHOD)[keyof typeof BOOKING_METHOD];

/** approval_status is a *filter* parameter only -- it is not a response field. */
export const APPROVAL_STATUS_FILTER = {
  approved: 1,
  pending: 2,
  rejected: 3,
  canceled: 5,
} as const;

export type ApprovalStatusFilter = keyof typeof APPROVAL_STATUS_FILTER;

/** person_type filter: 3 selects placeholder resources rather than real users. */
export const PERSON_TYPE = {
  USER: 1,
  CONTACT: 2,
  PLACEHOLDER: 3,
  AGENT: 4,
} as const;

export interface BookingFilterParams {
  after?: string;
  before?: string;
  person_id?: string;
  approval_status?: ApprovalStatusFilter;
  person_type?: number;
  with_draft?: boolean;
  canceled?: boolean;
  limit?: number;
  page?: number;
}

/**
 * Build the query string shared by every bookings list call.
 *
 * `include` is always requested: absence and capacity bookings can only be told
 * apart by which relationship carries data, and without `approval_statuses` the
 * API returns that relationship as a stub, which would make every booking look
 * like it has no approvers.
 */
export function buildBookingQuery(params: BookingFilterParams = {}): string {
  const q = new URLSearchParams();
  q.append('include', 'person,event,service,approval_statuses');

  if (params.after) q.append('filter[after]', params.after);
  if (params.before) q.append('filter[before]', params.before);
  if (params.person_id) q.append('filter[person_id]', params.person_id);
  if (params.approval_status) {
    q.append('filter[approval_status]', String(APPROVAL_STATUS_FILTER[params.approval_status]));
  }
  if (params.person_type !== undefined) {
    q.append('filter[person_type]', String(params.person_type));
  }
  if (params.with_draft) q.append('filter[with_draft]', 'true');
  if (params.canceled) q.append('filter[canceled]', 'true');
  if (params.limit) q.append('page[size]', String(params.limit));
  if (params.page) q.append('page[number]', String(params.page));

  return q.toString();
}

/** True when the booking represents an absence (event set, service empty). */
export function isAbsenceBooking(booking: ProductiveBooking): boolean {
  return Boolean(booking.relationships?.event?.data?.id);
}

/** True when the booking represents planned project capacity (service set). */
export function isCapacityBooking(booking: ProductiveBooking): boolean {
  return Boolean(booking.relationships?.service?.data?.id);
}

/**
 * Pick a sensible booking_method_id for an absence type.
 *
 * Types that allow half days need per-day granularity; the rest are booked as
 * one total block. Both branches are verified against the live API, but callers
 * may always override -- this is a default, not an API-enforced rule.
 */
export function defaultBookingMethod(event: ProductiveEvent): BookingMethodId {
  return event.attributes.half_day_bookings
    ? BOOKING_METHOD.HOURS_PER_DAY
    : BOOKING_METHOD.TOTAL_HOURS;
}

/** Quantity attributes that belong to a given booking method. */
export interface BookingQuantity {
  hours?: number;
  time?: number;
  percentage?: number;
  total_time?: number;
}

/**
 * Map a requested amount onto the attribute(s) the chosen method expects.
 *
 * @param method  booking_method_id
 * @param hoursPerDay  hours per working day (methods 1 and 3)
 * @param percentage   allocation percentage (method 2)
 * @param workingDays  number of working days, needed to total up method 3
 */
export function buildQuantity(
  method: BookingMethodId,
  opts: { hoursPerDay?: number; percentage?: number; workingDays?: number },
): BookingQuantity {
  if (method === BOOKING_METHOD.PERCENTAGE) {
    if (opts.percentage === undefined) {
      throw new Error('booking_method_id 2 (percentage) requires a percentage value');
    }
    return { percentage: opts.percentage };
  }

  if (opts.hoursPerDay === undefined) {
    throw new Error(`booking_method_id ${method} requires hours_per_day`);
  }

  if (method === BOOKING_METHOD.HOURS_PER_DAY) {
    return { hours: opts.hoursPerDay, time: Math.round(opts.hoursPerDay * 60) };
  }

  const days = opts.workingDays ?? 1;
  return { total_time: Math.round(opts.hoursPerDay * 60 * days) };
}

/**
 * Count working days (Mon-Fri) inclusive between two ISO dates.
 *
 * Public holidays are not subtracted -- the API recomputes total_working_days
 * itself, so this only needs to be good enough to size a method-3 request.
 */
export function countWorkingDays(startIso: string, endIso: string): number {
  const start = new Date(`${startIso}T00:00:00Z`);
  const end = new Date(`${endIso}T00:00:00Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) return 0;

  let days = 0;
  for (const d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    const weekday = d.getUTCDay();
    if (weekday !== 0 && weekday !== 6) days += 1;
  }
  return days;
}

/** Human-readable approval state derived from the response fields. */
export function describeApprovalState(booking: ProductiveBooking): string {
  const a = booking.attributes;
  if (a.canceled) return 'Canceled';
  if (a.rejected) return a.rejected_reason ? `Rejected (${a.rejected_reason})` : 'Rejected';
  if (a.approved) return 'Approved';

  const pending = booking.relationships?.approval_statuses?.data?.length ?? 0;
  return pending > 0 ? `Pending approval (${pending} approver(s))` : 'Pending approval';
}

/** Minutes rendered as "7h 30m" / "8h" / "45m". */
export function formatMinutes(totalMinutes: number): string {
  const rounded = Math.round(totalMinutes);
  const hours = Math.floor(rounded / 60);
  const minutes = rounded % 60;
  if (hours > 0) return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  return `${minutes}m`;
}

/**
 * Resolve a user-supplied absence type name against the live event list.
 *
 * Matching is case-insensitive and accepts a unique partial match, so callers
 * never need a hardcoded mapping table. Returns null when nothing matches;
 * throws only when the input is genuinely ambiguous.
 */
export function resolveAbsenceType(
  events: ProductiveEvent[],
  needle: string,
): ProductiveEvent | null {
  const wanted = needle.trim().toLowerCase();
  if (!wanted) return null;

  const active = events.filter((e) => !e.attributes.archived_at);

  const exact = active.filter((e) => e.attributes.name?.toLowerCase() === wanted);
  if (exact.length === 1) return exact[0];
  if (exact.length > 1) {
    throw new Error(`Absence type "${needle}" is ambiguous -- use the event ID instead.`);
  }

  const partial = active.filter((e) => e.attributes.name?.toLowerCase().includes(wanted));
  if (partial.length === 1) return partial[0];
  if (partial.length > 1) {
    const names = partial.map((e) => e.attributes.name).join(', ');
    throw new Error(`Absence type "${needle}" matches several types: ${names}. Be more specific.`);
  }

  return null;
}
