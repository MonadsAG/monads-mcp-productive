/**
 * Capacity overview: contracted hours vs. planned bookings per person.
 *
 * The arithmetic lives in api/capacity.ts as pure functions; this file only
 * gathers data and renders it. See docs/resource-management-spec.md.
 */
import { z } from 'zod';
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import { ProductiveAPIClient } from '../api/client.js';
import type {
  ProductiveBooking,
  ProductiveIncludedResource,
  ProductivePerson,
} from '../api/types.js';
import {
  MAX_BOOKING_PAGES,
  MAX_PAGE_SIZE,
  PERSON_TYPE,
  formatMinutes,
  remoteWorkEventIds,
  type BookingFilterParams,
} from '../api/bookings-client.js';
import {
  bookedMinutes,
  hasUnreadableAvailabilities,
  parseAvailabilities,
  summariseCapacity,
  type CapacitySummary,
} from '../api/capacity.js';
import { parseDate } from './time-entries.js';
import {
  coerceBoolean,
  resolvePersonId,
  rethrowToolError,
  type ToolResult,
} from './tool-helpers.js';

/** Everything one overview needs out of the bookings endpoint. */
interface CollectedBookings {
  bookings: ProductiveBooking[];
  /** Sideloaded resources across all pages -- events, for the remote-work check. */
  included: ProductiveIncludedResource[];
  /** True when the page ceiling cut the fetch short, so the numbers are partial. */
  truncated: boolean;
}

/**
 * Fetch every booking in the window, page by page.
 *
 * One sweep for the whole team rather than one call per person: Productive
 * allows 100 requests per 10s and Workers caps subrequests per request, so a
 * 200-person overview used to sit right on both limits. Sequential on purpose
 * -- whether page n+1 exists is only known after page n, and serialising keeps
 * the request rate flat.
 */
async function collectBookings(
  client: ProductiveAPIClient,
  filters: BookingFilterParams,
  maxPages: number = MAX_BOOKING_PAGES,
): Promise<CollectedBookings> {
  const bookings: ProductiveBooking[] = [];
  const included: ProductiveIncludedResource[] = [];

  for (let page = 1; page <= maxPages; page += 1) {
    // A fixed sort is what makes paging safe: without one the order across
    // pages is not guaranteed and rows duplicate or vanish at the boundaries.
    const response = await client.listBookings({
      ...filters,
      limit: MAX_PAGE_SIZE,
      page,
      sort: 'started_on',
    });

    const rows = response.data ?? [];
    bookings.push(...rows);
    included.push(...(response.included ?? []));

    const totalPages = response.meta?.total_pages;
    if (typeof totalPages === 'number' && page >= totalPages) break;
    // A short page is the last one, whether or not meta said so.
    if (rows.length < MAX_PAGE_SIZE) break;
    if (page === maxPages) return { bookings, included, truncated: true };
  }

  return { bookings, included, truncated: false };
}

/** Bookings keyed by person; ones with no person attached cannot be attributed. */
function groupByPerson(bookings: ProductiveBooking[]): Map<string, ProductiveBooking[]> {
  const byPerson = new Map<string, ProductiveBooking[]>();
  for (const booking of bookings) {
    const personId = booking.relationships?.person?.data?.id;
    if (!personId) continue;
    const existing = byPerson.get(personId);
    if (existing) existing.push(booking);
    else byPerson.set(personId, [booking]);
  }
  return byPerson;
}

/**
 * Look ahead at what this booking would do to the person's load.
 *
 * Returns null when the load cannot be established (no availabilities pattern),
 * so callers can stay silent rather than guess.
 */
export async function projectUtilisation(
  client: ProductiveAPIClient,
  personId: string,
  from: string,
  to: string,
  planned: { percentage?: number; time?: number; hours?: number; total_time?: number },
): Promise<string | null> {
  try {
    const [person, existing] = await Promise.all([
      client.getPerson(personId),
      client.listBookings({ person_id: personId, after: from, before: to, limit: MAX_PAGE_SIZE }),
    ]);

    const slices = parseAvailabilities(person.data.attributes.availabilities);
    // The response already sideloads its events, so telling working-from-home
    // apart from real time off costs no extra call -- and without it every
    // home-office day would read as absence and the warning would fire early.
    const summary = summariseCapacity(
      existing.data ?? [],
      slices,
      from,
      to,
      remoteWorkEventIds(existing.included),
    );
    if (summary.contractedMinutes === null || summary.contractedMinutes === 0) return null;

    // Size the pending booking the same way an existing one would be counted,
    // so a percentage booking is scaled against contracted time rather than
    // silently contributing nothing.
    const addedMinutes = bookedMinutes(
      {
        id: 'pending',
        type: 'bookings',
        attributes: { started_on: from, ended_on: to, ...planned },
      },
      slices,
      from,
      to,
    );

    const plannedTotal = summary.plannedMinutes + addedMinutes;
    const percent = Math.round((plannedTotal / summary.contractedMinutes) * 1000) / 10;

    const headline = `Projected load for ${from}..${to}: ${percent}% of ${formatMinutes(summary.contractedMinutes)} contracted`;
    if (plannedTotal > summary.contractedMinutes) {
      return `⚠️ ${headline} — this overbooks the person by ${formatMinutes(plannedTotal - summary.contractedMinutes)}. Bookings are still allowed; this is a warning, not a block.`;
    }
    return headline;
  } catch {
    // A capacity hint must never prevent the actual booking.
    return null;
  }
}

const getCapacityOverviewSchema = z.object({
  person_id: z.string().optional(),
  date_from: z.string().min(1, 'date_from is required'),
  date_to: z.string().min(1, 'date_to is required'),
  include_placeholders: coerceBoolean.optional().default(false),
  limit: z.coerce.number().min(1).max(200).default(50),
});

type CapacityParams = z.infer<typeof getCapacityOverviewSchema>;

function personLabel(person: ProductivePerson): string {
  const first =
    typeof person.attributes.first_name === 'string' ? person.attributes.first_name : '';
  const last = typeof person.attributes.last_name === 'string' ? person.attributes.last_name : '';
  return `${first} ${last}`.trim() || `Person ${person.id}`;
}

/** One line per person, ordered so the busiest show up first. */
function renderRow(person: ProductivePerson, summary: CapacitySummary): string {
  const label = personLabel(person);
  // Only rendered when there is something to render -- a "Remote: 0h" segment
  // on every single row would be pure noise.
  const remote =
    summary.remoteMinutes > 0 ? ` · Remote: ${formatMinutes(summary.remoteMinutes)}` : '';

  if (summary.contractedMinutes === null) {
    // "Nothing on file" and "on file but unreadable" call for different
    // reactions: the first is a gap in Productive, the second is a bug in this
    // tool. Reporting both the same way hides the bug behind a plausible result.
    const reason = hasUnreadableAvailabilities(person.attributes.availabilities)
      ? 'a working pattern is set on this person but could not be read'
      : 'no working pattern set on this person';
    return `• ${label} (ID: ${person.id})
  Contracted hours unknown — ${reason}
  Planned: ${formatMinutes(summary.plannedMinutes)} (${formatMinutes(summary.projectMinutes)} projects, ${formatMinutes(summary.absenceMinutes)} absence)${remote}`;
  }

  const pct = (value: number | null): string => (value === null ? '—' : `${value}%`);
  const free =
    summary.freeMinutes === null
      ? '—'
      : summary.freeMinutes >= 0
        ? formatMinutes(summary.freeMinutes)
        : `overbooked by ${formatMinutes(-summary.freeMinutes)}`;

  // Project share and total claimed share are reported separately: somebody on
  // leave all week is fully claimed while doing 0% project work, and showing
  // only the project figure next to an OVERBOOKED flag reads as a contradiction.
  return `• ${label} (ID: ${person.id})${summary.overbooked ? '  ⚠️ OVERBOOKED' : ''}
  Contracted: ${formatMinutes(summary.contractedMinutes)} · Claimed: ${formatMinutes(summary.plannedMinutes)} (${pct(summary.plannedPercent)})
  Projects: ${formatMinutes(summary.projectMinutes)} (${pct(summary.utilisationPercent)}) · Absence: ${formatMinutes(summary.absenceMinutes)}${remote}
  Free: ${free}`;
}

interface CapacityRow {
  person: ProductivePerson;
  summary: CapacitySummary;
}

function renderOverview(
  rows: CapacityRow[],
  opts: { from: string; to: string; truncated: boolean; singlePerson: boolean },
): string {
  const header = `Capacity ${opts.from} to ${opts.to} — ${rows.length} person${rows.length !== 1 ? 's' : ''}`;

  // Ahead of the rows, not after them: a reader who stops at the first
  // interesting name must not walk away with a partial figure believed whole.
  const truncation = opts.truncated
    ? `\n\n⚠️ Incomplete: only the first ${MAX_BOOKING_PAGES * MAX_PAGE_SIZE} bookings in this range were counted and there are more. Every figure below is missing some load, so "Free" is an upper bound rather than what is actually left. Narrow the date range, or pass person_id for exact numbers.`
    : '';

  const body = rows.map((r) => renderRow(r.person, r.summary)).join('\n\n');

  const overbooked = rows.filter((r) => r.summary.overbooked);
  const warning = overbooked.length
    ? `\n\n⚠️ ${overbooked.length} person${overbooked.length !== 1 ? 's are' : ' is'} overbooked: ${overbooked
        .map((r) => personLabel(r.person))
        .join(', ')}`
    : '';

  const remote = rows.some((r) => r.summary.remoteMinutes > 0)
    ? '\n\nRemote work is reported separately and not deducted — those people are working, just not on site.'
    : '';

  const scope = opts.singlePerson
    ? ''
    : '\n\nOnly people and bookings visible to the calling token are included — a regular token sees only its own resource planning.';

  return `${header}${truncation}\n\n${body}${warning}${remote}${scope}`;
}

interface Gathered {
  people: ProductivePerson[];
  collected: CollectedBookings;
}

const NO_BOOKINGS: CollectedBookings = { bookings: [], included: [], truncated: false };

/** One named person: their record plus their own bookings, in one call each. */
async function gatherOne(
  client: ProductiveAPIClient,
  personId: string,
  window: { after: string; before: string },
): Promise<Gathered> {
  // No person_type filter here: the caller named this person, so filtering on
  // what kind of resource they are could only ever answer "nothing" for a
  // placeholder that was asked about explicitly.
  const [person, bookings] = await Promise.all([
    client.getPerson(personId),
    client.listBookings({ ...window, person_id: personId, limit: MAX_PAGE_SIZE }),
  ]);

  return {
    people: [person.data],
    collected: {
      bookings: bookings.data ?? [],
      included: bookings.included ?? [],
      truncated: false,
    },
  };
}

/** Everyone the token can see, plus every booking in the window in one sweep. */
async function gatherMany(
  client: ProductiveAPIClient,
  params: CapacityParams,
  window: { after: string; before: string },
): Promise<Gathered> {
  // `is_active` becomes filter[status]=1 server-side, so deactivated people no
  // longer eat into `limit`. The client-side filter below is still needed: it
  // is what keeps contacts, agents and placeholders out.
  const listed = await client.listPeople({ limit: params.limit, is_active: true });
  const people = (listed.data ?? []).filter((p) => {
    const attrs = p.attributes;
    if (attrs.deactivated_at) return false;
    // Contacts and agents have no working pattern and would only add noise.
    if (attrs.is_user === false && attrs.placeholder !== true) return false;
    if (!params.include_placeholders && attrs.placeholder === true) return false;
    return true;
  });

  if (people.length === 0) return { people, collected: NO_BOOKINGS };

  // Scoped to exactly the people being reported on (the filter takes a
  // comma-separated list, verified live). Without it the sweep drags in
  // bookings for everyone the token can see, which spends the page budget on
  // rows that are then discarded -- and triggers the truncation warning on an
  // overview that would otherwise have been complete.
  const collected = await collectBookings(client, {
    ...window,
    person_id: people.map((p) => p.id).join(','),
    ...(params.include_placeholders ? {} : { person_type: PERSON_TYPE.USER }),
  });
  return { people, collected };
}

export async function getCapacityOverviewTool(
  client: ProductiveAPIClient,
  args: unknown,
  config?: { PRODUCTIVE_USER_ID?: string },
): Promise<ToolResult> {
  try {
    const params = getCapacityOverviewSchema.parse(args);

    const from = parseDate(params.date_from);
    const to = parseDate(params.date_to);
    if (to < from) {
      throw new McpError(ErrorCode.InvalidParams, `date_to (${to}) is before date_from (${from}).`);
    }

    const personId = params.person_id ? resolvePersonId(params.person_id, config) : undefined;
    const window = { after: from, before: to };

    const { people, collected } = personId
      ? await gatherOne(client, personId, window)
      : await gatherMany(client, params, window);

    if (people.length === 0) {
      return { content: [{ type: 'text', text: 'No people to report on for these filters.' }] };
    }

    // Every booking is already in hand, so each person is a lookup rather than
    // a request.
    const remoteIds = remoteWorkEventIds(collected.included);
    const byPerson = groupByPerson(collected.bookings);
    const rows: CapacityRow[] = people.map((person) => ({
      person,
      summary: summariseCapacity(
        byPerson.get(person.id) ?? [],
        parseAvailabilities(person.attributes.availabilities),
        from,
        to,
        remoteIds,
      ),
    }));

    rows.sort(
      (a, b) => (b.summary.utilisationPercent ?? -1) - (a.summary.utilisationPercent ?? -1),
    );

    const text = renderOverview(rows, {
      from,
      to,
      truncated: collected.truncated,
      singlePerson: Boolean(personId),
    });
    return { content: [{ type: 'text', text }] };
  } catch (error) {
    rethrowToolError(error);
  }
}

export const getCapacityOverviewDefinition = {
  name: 'get_capacity_overview',
  description:
    'Show planned utilisation per person for a date range: contracted hours (from the person\'s working pattern), how much is taken by project bookings and absences, what is left, and who is overbooked. Answers "do we have capacity for project X next month?". Contracted hours come from each person\'s own working pattern, so part-time contracts are handled correctly. Remote work (working from home) is reported separately and never deducted — those people are available, just not on site. Note that a regular API token only sees its own resource planning — with such a token this reports on the caller alone.',
  inputSchema: {
    type: 'object',
    properties: {
      person_id: {
        type: 'string',
        description:
          'Report on a single person. "me" uses PRODUCTIVE_USER_ID. Omit to cover everyone visible.',
      },
      date_from: { type: 'string', description: 'Start of the range (YYYY-MM-DD) (required)' },
      date_to: { type: 'string', description: 'End of the range, inclusive (required)' },
      include_placeholders: {
        type: 'boolean',
        description:
          'Include placeholder resources (unfilled roles) alongside real people (default false)',
        default: false,
      },
      limit: {
        type: 'number',
        description: 'Maximum number of people to report on (1-200)',
        minimum: 1,
        maximum: 200,
        default: 50,
      },
    },
    required: ['date_from', 'date_to'],
  },
  annotations: { title: 'Capacity overview', readOnlyHint: true, openWorldHint: true },
};
