/**
 * Project capacity tools: plan a person onto a service, adjust it, read it back.
 *
 * Same `bookings` resource as absences -- the difference is that these carry a
 * service_id instead of an event_id. See docs/resource-management-spec.md.
 */
import { z } from 'zod';
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import { ProductiveAPIClient } from '../api/client.js';
import type { ProductiveBookingCreate, ProductiveBookingUpdate } from '../api/types.js';
import {
  BOOKING_METHOD,
  buildQuantity,
  countWorkingDays,
  describeApprovalState,
  formatMinutes,
  isCapacityBooking,
  MAX_PAGE_SIZE,
  type BookingMethodId,
} from '../api/bookings-client.js';
import { projectUtilisation } from './capacity.js';
import { parseDate } from './time-entries.js';
import { buildIncludeMap, resolveName } from './include-resolver.js';
import {
  coerceBoolean,
  describePerson,
  personWorkingDays,
  resolvePersonId,
  rethrowToolError,
  toNumericId,
  type ToolResult,
} from './tool-helpers.js';

// --- create_booking ----------------------------------------------------------

const createBookingSchema = z
  .object({
    person_id: z.string().min(1).default('me'),
    service_id: z.string().min(1, 'service_id is required'),
    date_from: z.string().min(1, 'date_from is required'),
    date_to: z.string().min(1, 'date_to is required'),
    percentage: z.coerce.number().min(1).max(100).optional(),
    hours_per_day: z.coerce.number().positive().max(24).optional(),
    booking_method_id: z.coerce.number().int().min(1).max(3).optional(),
    note: z.string().optional(),
    confirm: coerceBoolean.optional().default(false),
  })
  .refine((v) => v.percentage !== undefined || v.hours_per_day !== undefined, {
    message: 'Provide either percentage or hours_per_day',
  });

export async function createBookingTool(
  client: ProductiveAPIClient,
  args: unknown,
  config?: { PRODUCTIVE_USER_ID?: string },
): Promise<ToolResult> {
  try {
    const params = createBookingSchema.parse(args);
    const personId = resolvePersonId(params.person_id, config);

    const from = parseDate(params.date_from);
    const to = parseDate(params.date_to);
    if (to < from) {
      throw new McpError(ErrorCode.InvalidParams, `date_to (${to}) is before date_from (${from}).`);
    }

    const method = (params.booking_method_id ??
      (params.percentage !== undefined
        ? BOOKING_METHOD.PERCENTAGE
        : BOOKING_METHOD.HOURS_PER_DAY)) as BookingMethodId;

    const workingDays =
      method === BOOKING_METHOD.TOTAL_HOURS
        ? await personWorkingDays(client, personId, from, to)
        : countWorkingDays(from, to);
    if (workingDays === 0) {
      throw new McpError(
        ErrorCode.InvalidParams,
        `${from} to ${to} contains no working days (weekends only).`,
      );
    }

    let quantity;
    try {
      quantity = buildQuantity(method, {
        hoursPerDay: params.hours_per_day,
        percentage: params.percentage,
        workingDays,
      });
    } catch (error) {
      throw new McpError(
        ErrorCode.InvalidParams,
        error instanceof Error ? error.message : 'Invalid booking amount',
      );
    }

    if (!params.confirm) {
      const [who, hint] = await Promise.all([
        describePerson(client, personId),
        projectUtilisation(client, personId, from, to, quantity),
      ]);
      return {
        content: [
          {
            type: 'text',
            text: `Project booking ready to create:

Person: ${who}${params.person_id === 'me' ? ' (me)' : ''}
Service ID: ${params.service_id}
Period: ${from} to ${to} (${workingDays} working day(s))
Amount: ${params.percentage !== undefined ? `${params.percentage}%` : `${params.hours_per_day}h per day`}
Booking method: ${method}
${params.note ? `Note: ${params.note}` : 'No note'}
${hint ? `\n${hint}` : ''}

Call again with "confirm": true to create it.`,
          },
        ],
      };
    }

    const payload: ProductiveBookingCreate = {
      data: {
        type: 'bookings',
        attributes: {
          person_id: toNumericId(personId, 'person_id'),
          service_id: toNumericId(params.service_id, 'service_id'),
          started_on: from,
          ended_on: to,
          booking_method_id: method,
          ...quantity,
          ...(params.note ? { note: params.note } : {}),
        },
      },
    };

    const created = await client.createBooking(payload);
    const a = created.data.attributes;

    return {
      content: [
        {
          type: 'text',
          text: `Project booking created (ID: ${created.data.id})

Service ID: ${params.service_id}
Period: ${a.started_on} to ${a.ended_on} · ${a.total_working_days ?? workingDays} working day(s)
${typeof a.total_time === 'number' ? `Planned: ${formatMinutes(a.total_time)}` : ''}${typeof a.percentage === 'number' && a.percentage ? `\nAllocation: ${a.percentage}%` : ''}
Status: ${describeApprovalState(created.data)}`,
        },
      ],
    };
  } catch (error) {
    rethrowToolError(error);
  }
}

// --- update_booking ----------------------------------------------------------

const updateBookingSchema = z
  .object({
    booking_id: z.string().min(1, 'booking_id is required'),
    date_from: z.string().optional(),
    date_to: z.string().optional(),
    percentage: z.coerce.number().min(1).max(100).optional(),
    hours_per_day: z.coerce.number().positive().max(24).optional(),
    note: z.string().optional(),
    confirm: coerceBoolean.optional().default(false),
  })
  .refine(
    (v) =>
      v.date_from !== undefined ||
      v.date_to !== undefined ||
      v.percentage !== undefined ||
      v.hours_per_day !== undefined ||
      v.note !== undefined,
    { message: 'Provide at least one field to change' },
  );

export async function updateBookingTool(
  client: ProductiveAPIClient,
  args: unknown,
): Promise<ToolResult> {
  try {
    const params = updateBookingSchema.parse(args);
    const current = await client.getBooking(params.booking_id);
    const a = current.data.attributes;

    // create_absence caps absences at booking method 1 or 3 on purpose; without
    // this check the percentage method reaches them through the back door and
    // sizes somebody's time off against a share of their contract instead of
    // real hours.
    if (params.percentage !== undefined && current.data.relationships?.event?.data?.id) {
      throw new McpError(
        ErrorCode.InvalidParams,
        'booking_method_id must be 1 (hours per day) or 3 (total hours) for absences. ' +
          'Use hours_per_day instead of percentage to change an absence.',
      );
    }

    const from = params.date_from ? parseDate(params.date_from) : a.started_on;
    const to = params.date_to ? parseDate(params.date_to) : a.ended_on;
    if (to < from) {
      throw new McpError(ErrorCode.InvalidParams, `date_to (${to}) is before date_from (${from}).`);
    }

    const attributes: ProductiveBookingUpdate['data']['attributes'] = {};
    if (params.date_from) attributes.started_on = from;
    if (params.date_to) attributes.ended_on = to;
    if (params.note !== undefined) attributes.note = params.note;

    if (params.percentage !== undefined) {
      attributes.booking_method_id = BOOKING_METHOD.PERCENTAGE;
      attributes.percentage = params.percentage;
      // Clear the amounts of the previous method; a stale total_time would win
      // when the booking is read back.
      attributes.total_time = 0;
      attributes.hours = 0;
      attributes.time = 0;
    } else if (params.hours_per_day !== undefined) {
      const method = (a.booking_method_id ?? BOOKING_METHOD.HOURS_PER_DAY) as BookingMethodId;
      const effective =
        method === BOOKING_METHOD.PERCENTAGE ? BOOKING_METHOD.HOURS_PER_DAY : method;
      attributes.booking_method_id = effective;
      // The mirror of the branch above: a left-over percentage wins when the
      // booking is read back (list_bookings prefers it over total_time), so a
      // booking switched from 50% to 8h/day would keep reporting "50%".
      attributes.percentage = 0;
      Object.assign(
        attributes,
        buildQuantity(effective, {
          hoursPerDay: params.hours_per_day,
          workingDays:
            effective === BOOKING_METHOD.TOTAL_HOURS
              ? await personWorkingDays(
                  client,
                  current.data.relationships?.person?.data?.id,
                  from,
                  to,
                )
              : countWorkingDays(from, to),
        }),
      );
    } else if (
      (params.date_from !== undefined || params.date_to !== undefined) &&
      a.booking_method_id === BOOKING_METHOD.TOTAL_HOURS &&
      typeof a.total_time === 'number' &&
      a.total_time > 0
    ) {
      // Moving the dates of a total-hours booking without resizing it silently
      // changes the daily load: a 5-day, 40h holiday stretched over two weeks
      // reads back as 4h of leave per day. Keep the hours per working day and
      // rescale the total, which is what the caller asking for a longer period
      // means -- and it shows up in the confirmation, so it is never silent.
      const personId = current.data.relationships?.person?.data?.id;
      const [oldDays, newDays] = await Promise.all([
        personWorkingDays(client, personId, a.started_on, a.ended_on),
        personWorkingDays(client, personId, from, to),
      ]);
      if (oldDays > 0 && newDays > 0 && newDays !== oldDays) {
        attributes.total_time = Math.round((a.total_time * newDays) / oldDays);
      }
    }

    if (!params.confirm) {
      const changes = Object.entries(attributes)
        .map(([k, v]) => `  ${k}: ${String(v)}`)
        .join('\n');

      // Naming the person and the kind of booking makes a mistyped ID obvious
      // before it silently overwrites somebody else's entry.
      const personId = current.data.relationships?.person?.data?.id;
      const who = personId ? await describePerson(client, personId) : 'unknown person';
      const kind = current.data.relationships?.event?.data?.id
        ? 'ABSENCE'
        : 'project capacity booking';

      return {
        content: [
          {
            type: 'text',
            text: `Booking ${params.booking_id} — ${kind}
Person: ${who}
Current period: ${a.started_on} to ${a.ended_on}
Status: ${describeApprovalState(current.data)}

Will be changed to:

${changes}

Check the person and type above before confirming. Call again with "confirm": true to apply.`,
          },
        ],
      };
    }

    const updated = await client.updateBooking(params.booking_id, {
      data: { type: 'bookings', id: params.booking_id, attributes },
    });
    const u = updated.data.attributes;

    return {
      content: [
        {
          type: 'text',
          text: `Booking ${updated.data.id} updated.

Period: ${u.started_on} to ${u.ended_on} · ${u.total_working_days ?? '?'} working day(s)
${typeof u.total_time === 'number' ? `Planned: ${formatMinutes(u.total_time)}` : ''}${typeof u.percentage === 'number' && u.percentage ? `\nAllocation: ${u.percentage}%` : ''}
Status: ${describeApprovalState(updated.data)}`,
        },
      ],
    };
  } catch (error) {
    rethrowToolError(error);
  }
}

// --- delete_booking ----------------------------------------------------------

const deleteBookingSchema = z.object({
  booking_id: z.string().min(1, 'booking_id is required'),
  confirm: coerceBoolean.optional().default(false),
});

export async function deleteBookingTool(
  client: ProductiveAPIClient,
  args: unknown,
): Promise<ToolResult> {
  try {
    const params = deleteBookingSchema.parse(args);

    // Read it first, so the preview can name whose entry is about to go and
    // what kind it is. A booking id carries none of that on its face, and this
    // is the one call in the set that cannot be undone.
    const current = await client.getBooking(params.booking_id);
    const a = current.data.attributes;
    const personId = current.data.relationships?.person?.data?.id;
    const who = personId ? await describePerson(client, personId) : 'unknown person';
    const kind = current.data.relationships?.event?.data?.id
      ? 'ABSENCE'
      : 'project capacity booking';

    if (!params.confirm) {
      return {
        content: [
          {
            type: 'text',
            text: `Booking ${params.booking_id} — ${kind}
Person: ${who}
Period: ${a.started_on} to ${a.ended_on}${typeof a.total_time === 'number' ? ` · ${formatMinutes(a.total_time)}` : ''}
Status: ${describeApprovalState(current.data)}

Deleting removes it outright — there is no undo, and an approved absence
disappears from the person's records with it. To take it back without losing
the entry, cancel it in Productive instead.

Call again with "confirm": true to delete it.`,
          },
        ],
      };
    }

    await client.deleteBooking(params.booking_id);

    return {
      content: [
        {
          type: 'text',
          text: `Booking ${params.booking_id} (${kind}, ${who}, ${a.started_on} to ${a.ended_on}) has been deleted.`,
        },
      ],
    };
  } catch (error) {
    rethrowToolError(error);
  }
}

// --- list_bookings -----------------------------------------------------------

const listBookingsSchema = z.object({
  person_id: z.string().optional(),
  project_id: z.string().optional(),
  date_from: z.string().optional(),
  date_to: z.string().optional(),
  include_absences: coerceBoolean.optional().default(false),
  limit: z.coerce.number().min(1).max(200).default(50),
});

export async function listBookingsTool(
  client: ProductiveAPIClient,
  args: unknown,
  config?: { PRODUCTIVE_USER_ID?: string },
): Promise<ToolResult> {
  try {
    const params = listBookingsSchema.parse(args);
    const personId = params.person_id ? resolvePersonId(params.person_id, config) : undefined;

    // Absences are dropped here, not by the API, so `limit` has to be applied
    // after the split -- otherwise a page full of absences reports no bookings.
    //
    // Except with project_id: an absence has no project, so the filter already
    // excludes them server-side, nothing is dropped, and the limit can go
    // straight through.
    //
    // The inverse ("project bookings only") has no server-side filter at all,
    // which is why the over-fetch has to stay. Both candidates were checked
    // live: the documented filter[booking_type] is accepted and then ignored
    // (every value, plain or [eq], returns the unfiltered set), and
    // filter[event_id][not_eq] over every event id answers 0 rows, because it
    // only ever matches inside the bookings that have an event.
    //
    // When it does have to split, it asks for a whole page rather than a
    // multiple of `limit`: a date range can hold nothing but absences for far
    // longer than three rows (verified live -- a full year in the test org holds
    // 25 bookings, every one of them an absence), and a short over-fetch then
    // reports "no project bookings" for a window that has plenty just below the
    // cut. One request either way.
    const splitClientSide = !params.include_absences && !params.project_id;
    const fetchLimit = splitClientSide ? MAX_PAGE_SIZE : params.limit;
    const response = await client.listBookings({
      person_id: personId,
      project_id: params.project_id,
      after: params.date_from ? parseDate(params.date_from) : undefined,
      before: params.date_to ? parseDate(params.date_to) : undefined,
      limit: fetchLimit,
    });

    const all = response.data ?? [];
    const pageWasFull = all.length >= fetchLimit;
    const matching = params.include_absences ? all : all.filter(isCapacityBooking);

    const moreAvailable = pageWasFull || matching.length > params.limit;
    const bookings = matching.slice(0, params.limit);

    if (bookings.length === 0) {
      const crowdedOut = pageWasFull
        ? ' The page came back full of absences, so raising limit or narrowing the date range may still turn some up.'
        : '';
      return {
        content: [
          {
            type: 'text',
            text: `No project bookings found for these filters.${crowdedOut}\n\nNote: a regular API token only sees its own resource planning, so an empty result does not prove none exist for other people.`,
          },
        ],
      };
    }

    const names = buildIncludeMap(response.included);
    const lines = bookings.map((booking) => {
      const a = booking.attributes;
      const pid = booking.relationships?.person?.data?.id;
      const sid = booking.relationships?.service?.data?.id;
      const eid = booking.relationships?.event?.data?.id;
      const person = resolveName(names, 'people', pid) ?? pid ?? 'Unknown';
      const what = sid
        ? `Service: ${resolveName(names, 'services', sid) ?? sid}`
        : `Absence: ${resolveName(names, 'events', eid) ?? eid ?? '?'}`;
      const amount =
        typeof a.percentage === 'number' && a.percentage
          ? `${a.percentage}%`
          : typeof a.total_time === 'number'
            ? formatMinutes(a.total_time)
            : '?';

      return `• ${person} (ID: ${booking.id})
  ${what}
  ${a.started_on} to ${a.ended_on} · ${a.total_working_days ?? '?'} working day(s) · ${amount}
  Status: ${describeApprovalState(booking)}`;
    });

    return {
      content: [
        {
          type: 'text',
          text: `${bookings.length} booking${bookings.length !== 1 ? 's' : ''} found:\n\n${lines.join('\n\n')}${moreAvailable ? '\n\nThere may be more -- raise limit or narrow the date range.' : ''}`,
        },
      ],
    };
  } catch (error) {
    rethrowToolError(error);
  }
}

// --- definitions -------------------------------------------------------------

export const createBookingDefinition = {
  name: 'create_booking',
  description:
    'Plan a person onto a project service for a date range (capacity planning, not absences — use create_absence for those). Give the load either as percentage or as hours_per_day. Requires confirmation: the first call previews the booking and warns if it would overbook the person, then repeat with "confirm": true to write it. Overbooking is reported, never blocked.',
  inputSchema: {
    type: 'object',
    properties: {
      person_id: {
        type: 'string',
        description: 'Person to plan. "me" uses PRODUCTIVE_USER_ID. Default "me".',
        default: 'me',
      },
      service_id: {
        type: 'string',
        description:
          'Service to book onto (required). Find it via list_project_deals then list_deal_services.',
      },
      date_from: { type: 'string', description: 'First day, YYYY-MM-DD or "today" (required)' },
      date_to: { type: 'string', description: 'Last day, inclusive (required)' },
      percentage: {
        type: 'number',
        description: 'Allocation as a percentage of contracted time (1-100)',
        minimum: 1,
        maximum: 100,
      },
      hours_per_day: { type: 'number', description: 'Allocation as hours per working day' },
      booking_method_id: {
        type: 'number',
        description: 'Override booking method: 1 = hours per day, 2 = percentage, 3 = total hours',
        minimum: 1,
        maximum: 3,
      },
      note: { type: 'string', description: 'Optional note' },
      confirm: {
        type: 'boolean',
        description: 'Set true to actually create. Call without it first to preview.',
        default: false,
      },
    },
    required: ['service_id', 'date_from', 'date_to'],
  },
  annotations: {
    title: 'Create project booking',
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: true,
  },
};

export const updateBookingDefinition = {
  name: 'update_booking',
  description:
    'Change an existing booking: move its dates, adjust the allocation, or edit the note. Requires confirmation — the first call shows what would change, then repeat with "confirm": true. Works for both project bookings and absences.',
  inputSchema: {
    type: 'object',
    properties: {
      booking_id: { type: 'string', description: 'ID of the booking to change (required)' },
      date_from: { type: 'string', description: 'New first day (YYYY-MM-DD)' },
      date_to: { type: 'string', description: 'New last day, inclusive' },
      percentage: {
        type: 'number',
        description:
          'New allocation percentage (1-100). Project bookings only — absences take hours_per_day instead.',
        minimum: 1,
        maximum: 100,
      },
      hours_per_day: { type: 'number', description: 'New allocation in hours per working day' },
      note: { type: 'string', description: 'New note' },
      confirm: {
        type: 'boolean',
        description: 'Set true to apply. Call without it first to preview.',
        default: false,
      },
    },
    required: ['booking_id'],
  },
  annotations: {
    title: 'Update booking',
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  },
};

export const deleteBookingDefinition = {
  name: 'delete_booking',
  description:
    'Delete a booking outright — a project booking or an absence. Requires confirmation: the first call names the person, the kind of booking and the period, then repeat with "confirm": true. This cannot be undone; to withdraw an absence while keeping the record, cancel it in Productive instead of deleting it. Use update_booking to correct dates or amounts.',
  inputSchema: {
    type: 'object',
    properties: {
      booking_id: { type: 'string', description: 'ID of the booking to delete (required)' },
      confirm: {
        type: 'boolean',
        description: 'Set true to actually delete. Call without it first to see what would go.',
        default: false,
      },
    },
    required: ['booking_id'],
  },
  annotations: {
    title: 'Delete booking',
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: true,
    openWorldHint: true,
  },
};

export const listBookingsDefinition = {
  name: 'list_bookings',
  description:
    'Read project capacity bookings — who is planned onto which service, when, and at what load. Pass project_id to answer "who is planned on project X?". Absences are excluded unless include_absences is set (use list_absences for those). Note that a regular API token only sees its own resource planning, so an empty result does not prove none exist for other people.',
  inputSchema: {
    type: 'object',
    properties: {
      person_id: {
        type: 'string',
        description: 'Filter by person. "me" uses PRODUCTIVE_USER_ID.',
      },
      project_id: {
        type: 'string',
        description:
          'Filter by project, for "who is planned on this project?". Absences never carry a project, so this also excludes them.',
      },
      date_from: { type: 'string', description: 'Only bookings after this date (YYYY-MM-DD)' },
      date_to: { type: 'string', description: 'Only bookings before this date (YYYY-MM-DD)' },
      include_absences: {
        type: 'boolean',
        description: 'Also include absence bookings (default false)',
        default: false,
      },
      limit: {
        type: 'number',
        description: 'Number of bookings to return (1-200)',
        minimum: 1,
        maximum: 200,
        default: 50,
      },
    },
    required: [],
  },
  annotations: { title: 'List project bookings', readOnlyHint: true, openWorldHint: true },
};
