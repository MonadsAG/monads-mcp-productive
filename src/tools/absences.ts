/**
 * Absence tools: discover the org's absence types, book an absence, read them back.
 *
 * Absence categories are never hardcoded here -- `GET /events` is the single
 * source of truth, resolved at call time. See docs/resource-management-spec.md.
 */
import { z } from 'zod';
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import { ProductiveAPIClient } from '../api/client.js';
import type { ProductiveBookingCreate, ProductiveEvent } from '../api/types.js';
import {
  BOOKING_METHOD,
  buildQuantity,
  countWorkingDays,
  defaultBookingMethod,
  describeApprovalState,
  formatMinutes,
  isAbsenceBooking,
  resolveAbsenceType,
  type BookingMethodId,
} from '../api/bookings-client.js';
import { hoursOnDate, parseAvailabilities, sliceForDate } from '../api/capacity.js';
import { parseDate } from './time-entries.js';
import { buildIncludeMap, resolveName } from './include-resolver.js';
import {
  coerceBoolean,
  describePerson,
  resolvePersonId,
  rethrowToolError,
  type ToolResult,
} from './tool-helpers.js';

/**
 * Contracted hours on the first working day of the range.
 *
 * Booking a full-time day for a part-timer would overstate their absence, so
 * the person's own pattern decides. Falls back to 8h when nothing is known.
 */
async function defaultHoursPerDay(
  client: ProductiveAPIClient,
  personId: string,
  fromIso: string,
): Promise<number> {
  try {
    const person = await client.getPerson(personId);
    const slices = parseAvailabilities(person.data.attributes.availabilities);
    const slice = sliceForDate(slices, fromIso);
    if (!slice) return 8;
    const hours = hoursOnDate(slice, fromIso);
    return hours > 0 ? hours : 8;
  } catch {
    return 8;
  }
}

/** Load the absence types and match the caller's input against them. */
async function findEvent(
  client: ProductiveAPIClient,
  opts: { absence_type?: string; event_id?: string },
): Promise<ProductiveEvent> {
  const response = await client.listEvents();
  const events = response.data ?? [];

  if (opts.event_id) {
    const byId = events.find((e) => e.id === opts.event_id);
    if (!byId) {
      throw new McpError(
        ErrorCode.InvalidParams,
        `No absence type with ID ${opts.event_id}. Call list_absence_types to see the available ones.`,
      );
    }
    return byId;
  }

  const needle = opts.absence_type ?? '';
  let match: ProductiveEvent | null;
  try {
    match = resolveAbsenceType(events, needle);
  } catch (error) {
    throw new McpError(
      ErrorCode.InvalidParams,
      error instanceof Error ? error.message : 'Ambiguous absence type',
    );
  }

  if (!match) {
    const available = events
      .filter((e) => !e.attributes.archived_at)
      .map((e) => e.attributes.name)
      .join(', ');
    throw new McpError(
      ErrorCode.InvalidParams,
      `Unknown absence type "${needle}". Available in this organisation: ${available || 'none'}.`,
    );
  }
  return match;
}

// --- list_absence_types ------------------------------------------------------

const listAbsenceTypesSchema = z.object({
  include_archived: coerceBoolean.optional().default(false),
});

export async function listAbsenceTypesTool(
  client: ProductiveAPIClient,
  args: unknown,
): Promise<ToolResult> {
  try {
    const params = listAbsenceTypesSchema.parse(args);
    const response = await client.listEvents();
    const events = (response.data ?? []).filter(
      (e) => params.include_archived || !e.attributes.archived_at,
    );

    if (events.length === 0) {
      return { content: [{ type: 'text', text: 'No absence types are configured.' }] };
    }

    const lines = events.map((event) => {
      const a = event.attributes;
      const paid = a.event_type_id === 1 ? 'Paid' : a.event_type_id === 2 ? 'Unpaid' : 'Unknown';
      const capped = a.limitation_type_id === 4 ? 'no allowance needed' : 'allowance required';
      const method = defaultBookingMethod(event);
      return `• ${a.name} (ID: ${event.id})
  ${paid} · ${capped} · half days: ${a.half_day_bookings ? 'yes' : 'no'}
  Default booking method: ${method === BOOKING_METHOD.HOURS_PER_DAY ? '1 (hours per day)' : '3 (total hours)'}${
    a.archived_at ? '\n  ARCHIVED' : ''
  }`;
    });

    return {
      content: [
        {
          type: 'text',
          text: `${events.length} absence type${events.length !== 1 ? 's' : ''} configured:\n\n${lines.join('\n\n')}\n\nPass the name (or ID) to create_absence.`,
        },
      ],
    };
  } catch (error) {
    rethrowToolError(error);
  }
}

// --- create_absence ----------------------------------------------------------

const createAbsenceSchema = z
  .object({
    person_id: z.string().min(1).default('me'),
    absence_type: z.string().min(1).optional(),
    event_id: z.string().min(1).optional(),
    date_from: z.string().min(1, 'date_from is required'),
    date_to: z.string().min(1, 'date_to is required'),
    hours_per_day: z.coerce.number().positive().max(24).optional(),
    booking_method_id: z.coerce
      .number()
      .int()
      .refine((v) => v === 1 || v === 3, {
        message: 'booking_method_id must be 1 (hours per day) or 3 (total hours) for absences',
      })
      .optional(),
    note: z.string().optional(),
    confirm: coerceBoolean.optional().default(false),
  })
  .refine((v) => v.absence_type || v.event_id, {
    message: 'Provide either absence_type (name) or event_id',
  });

export async function createAbsenceTool(
  client: ProductiveAPIClient,
  args: unknown,
  config?: { PRODUCTIVE_USER_ID?: string },
): Promise<ToolResult> {
  try {
    const params = createAbsenceSchema.parse(args);
    const personId = resolvePersonId(params.person_id, config);

    const from = parseDate(params.date_from);
    const to = parseDate(params.date_to);
    if (to < from) {
      throw new McpError(ErrorCode.InvalidParams, `date_to (${to}) is before date_from (${from}).`);
    }

    const event = await findEvent(client, {
      absence_type: params.absence_type,
      event_id: params.event_id,
    });

    const method = (params.booking_method_id ?? defaultBookingMethod(event)) as BookingMethodId;
    const workingDays = countWorkingDays(from, to);
    if (workingDays === 0) {
      throw new McpError(
        ErrorCode.InvalidParams,
        `${from} to ${to} contains no working days (weekends only).`,
      );
    }

    const hoursPerDay = params.hours_per_day ?? (await defaultHoursPerDay(client, personId, from));
    let quantity;
    try {
      quantity = buildQuantity(method, { hoursPerDay, workingDays });
    } catch (error) {
      throw new McpError(
        ErrorCode.InvalidParams,
        error instanceof Error ? error.message : 'Invalid booking amount',
      );
    }

    if (!params.confirm) {
      const who = await describePerson(client, personId);
      return {
        content: [
          {
            type: 'text',
            text: `Absence ready to book:

Person: ${who}${params.person_id === 'me' ? ' (me)' : ''}
Type: ${event.attributes.name} (event ID ${event.id})
Period: ${from} to ${to}
Working days: ${workingDays}
Hours per day: ${hoursPerDay}
Booking method: ${method}
${params.note ? `Note: ${params.note}` : 'No note'}

Whether this needs approval depends on the person's approval policy — the result will say.

Call again with "confirm": true to book it.`,
          },
        ],
      };
    }

    const payload: ProductiveBookingCreate = {
      data: {
        type: 'bookings',
        attributes: {
          person_id: Number(personId),
          event_id: Number(event.id),
          started_on: from,
          ended_on: to,
          booking_method_id: method,
          ...quantity,
          ...(params.note ? { note: params.note } : {}),
        },
      },
    };

    const created = await client.createBooking(payload);
    const state = describeApprovalState(created.data);

    return {
      content: [
        {
          type: 'text',
          text: `Absence booked (ID: ${created.data.id})

Type: ${event.attributes.name}
Period: ${created.data.attributes.started_on} to ${created.data.attributes.ended_on}
Working days: ${created.data.attributes.total_working_days ?? workingDays}
Status: ${state}

${created.data.attributes.approved ? 'No approval was required for this person.' : 'This is waiting for approval — it is not confirmed time off yet.'}`,
        },
      ],
    };
  } catch (error) {
    rethrowToolError(error);
  }
}

// --- list_absences -----------------------------------------------------------

const listAbsencesSchema = z.object({
  person_id: z.string().optional(),
  date_from: z.string().optional(),
  date_to: z.string().optional(),
  absence_type: z.string().optional(),
  approval_status: z.enum(['approved', 'pending', 'rejected', 'canceled']).optional(),
  include_notes: coerceBoolean.optional().default(false),
  limit: z.coerce.number().min(1).max(200).default(50),
});

export async function listAbsencesTool(
  client: ProductiveAPIClient,
  args: unknown,
  config?: { PRODUCTIVE_USER_ID?: string },
): Promise<ToolResult> {
  try {
    const params = listAbsencesSchema.parse(args);
    const personId = params.person_id ? resolvePersonId(params.person_id, config) : undefined;

    const response = await client.listBookings({
      after: params.date_from ? parseDate(params.date_from) : undefined,
      before: params.date_to ? parseDate(params.date_to) : undefined,
      person_id: personId,
      approval_status: params.approval_status,
      limit: params.limit,
    });

    // Bookings carry both absences and project capacity; keep only absences.
    let absences = (response.data ?? []).filter(isAbsenceBooking);

    if (params.absence_type) {
      const event = await findEvent(client, { absence_type: params.absence_type });
      absences = absences.filter((b) => b.relationships?.event?.data?.id === event.id);
    }

    if (absences.length === 0) {
      return {
        content: [
          {
            type: 'text',
            text: 'No absences found for these filters.\n\nNote: a regular API token only sees its own resource planning, so an empty result does not prove none exist for other people.',
          },
        ],
      };
    }

    const names = buildIncludeMap(response.included);
    const lines = absences.map((booking) => {
      const a = booking.attributes;
      const pid = booking.relationships?.person?.data?.id;
      const eid = booking.relationships?.event?.data?.id;
      const person = resolveName(names, 'people', pid) ?? pid ?? 'Unknown';
      const type = resolveName(names, 'events', eid) ?? `event ${eid ?? '?'}`;
      const total = typeof a.total_time === 'number' ? ` · ${formatMinutes(a.total_time)}` : '';

      return `• ${person} — ${type} (ID: ${booking.id})
  ${a.started_on} to ${a.ended_on} · ${a.total_working_days ?? '?'} working day(s)${total}
  Status: ${describeApprovalState(booking)}${params.include_notes && a.note ? `\n  Note: ${a.note}` : ''}`;
    });

    return {
      content: [
        {
          type: 'text',
          text: `${absences.length} absence${absences.length !== 1 ? 's' : ''} found:\n\n${lines.join('\n\n')}\n\nOnly bookings visible to the calling token are listed.`,
        },
      ],
    };
  } catch (error) {
    rethrowToolError(error);
  }
}

// --- definitions -------------------------------------------------------------

export const listAbsenceTypesDefinition = {
  name: 'list_absence_types',
  description:
    'List the absence types configured in this Productive organisation (vacation, sick leave, and so on) with their IDs. Call this first when booking an absence: the types are organisation-specific and must be read at runtime rather than assumed. Feed the name or ID into create_absence.',
  inputSchema: {
    type: 'object',
    properties: {
      include_archived: {
        type: 'boolean',
        description: 'Include archived absence types (default false)',
        default: false,
      },
    },
    required: [],
  },
  annotations: { title: 'List absence types', readOnlyHint: true, openWorldHint: true },
};

export const createAbsenceDefinition = {
  name: 'create_absence',
  description:
    'Book an absence (vacation, sick leave, unpaid leave, ...) for a person over a date range. Requires confirmation: the first call returns a summary, then repeat with "confirm": true to write it. Identify the type with absence_type (name, matched against list_absence_types) or event_id. A booked absence is NOT automatically approved — whether it needs approval depends on the person\'s approval policy, and the result reports the actual status.',
  inputSchema: {
    type: 'object',
    properties: {
      person_id: {
        type: 'string',
        description: 'Person the absence is for. "me" uses PRODUCTIVE_USER_ID. Default "me".',
        default: 'me',
      },
      absence_type: {
        type: 'string',
        description:
          'Absence type by name, matched case-insensitively against list_absence_types. Either this or event_id is required.',
      },
      event_id: {
        type: 'string',
        description: 'Absence type by ID, as returned by list_absence_types.',
      },
      date_from: {
        type: 'string',
        description: 'First day. Accepts "today", "yesterday" or YYYY-MM-DD (required)',
      },
      date_to: {
        type: 'string',
        description: 'Last day, inclusive. Same formats as date_from (required)',
      },
      hours_per_day: {
        type: 'number',
        description:
          "Hours absent per working day. Defaults to the person's own contracted hours for that day, so part-time contracts are not overstated.",
      },
      booking_method_id: {
        type: 'number',
        description:
          'Override the booking method: 1 = hours per day, 3 = total hours. Derived from the absence type when omitted.',
        enum: [1, 3],
      },
      note: { type: 'string', description: 'Optional note' },
      confirm: {
        type: 'boolean',
        description: 'Set true to actually book. Call without it first to preview.',
        default: false,
      },
    },
    required: ['date_from', 'date_to'],
  },
  annotations: {
    title: 'Create absence',
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: true,
  },
};

export const listAbsencesDefinition = {
  name: 'list_absences',
  description:
    'Read booked absences, filtered by person, date range, type or approval status — for questions like "who is off next week?" or "am I already booked?". Returns person, period, type and approval status. Note that a regular API token only sees its own resource planning, so an empty result does not prove nothing exists for other people.',
  inputSchema: {
    type: 'object',
    properties: {
      person_id: {
        type: 'string',
        description: 'Filter by person. "me" uses PRODUCTIVE_USER_ID. Omit for everything visible.',
      },
      date_from: { type: 'string', description: 'Only absences after this date (YYYY-MM-DD)' },
      date_to: { type: 'string', description: 'Only absences before this date (YYYY-MM-DD)' },
      absence_type: {
        type: 'string',
        description: 'Filter by absence type name, matched against list_absence_types',
      },
      approval_status: {
        type: 'string',
        description: 'Filter by approval status',
        enum: ['approved', 'pending', 'rejected', 'canceled'],
      },
      include_notes: {
        type: 'boolean',
        description:
          'Include the free-text note of each absence. Off by default: notes can carry sensitive personal detail.',
        default: false,
      },
      limit: {
        type: 'number',
        description: 'Number of absences to return (1-200)',
        minimum: 1,
        maximum: 200,
        default: 50,
      },
    },
    required: [],
  },
  annotations: { title: 'List absences', readOnlyHint: true, openWorldHint: true },
};
