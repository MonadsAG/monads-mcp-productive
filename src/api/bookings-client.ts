/**
 * Shared building blocks for every bookings-based tool (absences and project
 * capacity alike). Deliberately free of API calls so the logic is unit-testable
 * on its own -- the HTTP methods live on ProductiveAPIClient and consume these.
 *
 * Background and evidence: docs/resource-management-spec.md
 */
import type { ProductiveBooking, ProductiveEvent, ProductiveIncludedResource } from './types.js';

/**
 * `absence_type` on an event: an absence category is either real time off or
 * remote work (working from home). Documented in
 * docs/api-spec/resources/events.yaml.
 *
 * Deliberately not a literal union on ProductiveEvent -- responses are not
 * validated, so a third value the API adds later would become a type lie.
 */
export const ABSENCE_TYPE = {
  TIME_OFF: 'time_off',
  REMOTE_WORK: 'remote_work',
} as const;

/** Which bucket a booking falls into for the capacity arithmetic. */
export type BookingKind = 'project' | 'time_off' | 'remote_work';

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

/** Largest page the bookings endpoint is asked for. */
export const MAX_PAGE_SIZE = 200;

/**
 * Hard ceiling on bookings pages fetched for one capacity overview.
 *
 * 10 x 200 = 2000 bookings. Productive allows 100 requests per 10s
 * (docs/api-spec/guides/rate-limits.md) and Workers caps subrequests per
 * request, so an unbounded loop would eventually break both.
 */
export const MAX_BOOKING_PAGES = 10;

export interface BookingFilterParams {
  after?: string;
  before?: string;
  /** One id, or several comma-separated (verified live: 28 + 69 rows = 97). */
  person_id?: string;
  /**
   * Absence category, one id or a comma-separated list.
   *
   * Set it to every event id and the endpoint returns exactly the absences --
   * the only server-side way to separate the two kinds of booking. Note the
   * asymmetry: the filter matches within bookings that *have* an event, so
   * `not_eq` cannot produce the project bookings (verified live: `not_eq` over
   * all event ids answers 0 rows, not "everything else").
   */
  event_id?: string;
  project_id?: string;
  budget_id?: string;
  approval_status?: ApprovalStatusFilter;
  person_type?: number;
  with_draft?: boolean;
  canceled?: boolean;
  limit?: number;
  page?: number;
  sort?: string;
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
  if (params.event_id) q.append('filter[event_id]', params.event_id);
  if (params.project_id) q.append('filter[project_id]', params.project_id);
  if (params.budget_id) q.append('filter[budget_id]', params.budget_id);
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
  // Without a fixed sort the order across pages is not guaranteed, which makes
  // rows duplicate or go missing at the page boundaries. Documented sort keys
  // for this endpoint: docs/api-spec/resources/bookings.yaml (sort_booking).
  if (params.sort) q.append('sort', params.sort);

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

/** True only for events the API explicitly marks as remote work. */
export function isRemoteWorkEvent(event: Pick<ProductiveEvent, 'attributes'>): boolean {
  return event.attributes.absence_type === ABSENCE_TYPE.REMOTE_WORK;
}

/**
 * IDs of the sideloaded events that stand for remote work.
 *
 * Every bookings request sideloads `event` (see buildBookingQuery), so the
 * `absence_type` needed to tell working from home apart from real time off is
 * already in the response -- no extra call.
 */
export function remoteWorkEventIds(included?: ProductiveIncludedResource[]): Set<string> {
  const ids = new Set<string>();
  for (const resource of included ?? []) {
    if (resource.type !== 'events') continue;
    const absenceType: unknown = resource.attributes?.absence_type;
    if (absenceType === ABSENCE_TYPE.REMOTE_WORK) ids.add(resource.id);
  }
  return ids;
}

/**
 * Which bucket a booking belongs to.
 *
 * Only an event positively identified as remote work counts as such: without
 * the set, or with the event not sideloaded, an absence stays an absence. The
 * error therefore always points the same way -- capacity is reported too low
 * rather than too high. Guessing the other way would turn somebody's sick leave
 * into free capacity.
 */
export function classifyBooking(
  booking: ProductiveBooking,
  remoteEventIds?: ReadonlySet<string>,
): BookingKind {
  const eventId = booking.relationships?.event?.data?.id;
  if (!eventId) return 'project';
  return remoteEventIds?.has(eventId) ? 'remote_work' : 'time_off';
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
    // `hours` can arrive as an average over an uneven week; `time` (minutes) is
    // the field the API actually settles on, so only the display value rounds.
    return {
      hours: Math.round(opts.hoursPerDay * 100) / 100,
      time: Math.round(opts.hoursPerDay * 60),
    };
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

/**
 * Human-readable approval state derived from the response fields.
 *
 * `rejected_reason` is free text written about a specific person's absence and
 * can carry the same health detail as `note` -- "still signed off sick" -- so it
 * stays behind the same opt-in rather than riding along in every listing.
 */
export function describeApprovalState(
  booking: ProductiveBooking,
  opts: { includeReason?: boolean } = {},
): string {
  const a = booking.attributes;
  if (a.canceled) return 'Canceled';
  if (a.rejected) {
    return opts.includeReason && a.rejected_reason ? `Rejected (${a.rejected_reason})` : 'Rejected';
  }
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
  opts: { includeArchived?: boolean } = {},
): ProductiveEvent | null {
  const wanted = needle.trim().toLowerCase();
  if (!wanted) return null;

  // Archived types cannot be booked, but they still have history: a read that
  // refuses to name last year's "Sabbatical" reports "unknown type" for
  // bookings the same tool lists happily when unfiltered.
  const active = opts.includeArchived ? events : events.filter((e) => !e.attributes.archived_at);

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
