/**
 * Capacity overview: contracted hours vs. planned bookings per person.
 *
 * The arithmetic lives in api/capacity.ts as pure functions; this file only
 * gathers data and renders it. See docs/resource-management-spec.md.
 */
import { z } from 'zod';
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import { ProductiveAPIClient } from '../api/client.js';
import type { ProductivePerson } from '../api/types.js';
import { PERSON_TYPE, formatMinutes } from '../api/bookings-client.js';
import {
  bookedMinutes,
  parseAvailabilities,
  summariseCapacity,
  type CapacitySummary,
} from '../api/capacity.js';
import { parseDate } from './time-entries.js';
import { coerceBoolean, resolvePersonId, type ToolResult } from './tool-helpers.js';

/**
 * Fetch in small batches.
 *
 * One request per person against a 100-per-10s rate limit would trip on a
 * large organisation, and Workers caps concurrent subrequests as well.
 */
async function inBatches<T, R>(
  items: T[],
  size: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = [];
  for (let i = 0; i < items.length; i += size) {
    results.push(...(await Promise.all(items.slice(i, i + size).map(fn))));
  }
  return results;
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
      client.listBookings({ person_id: personId, after: from, before: to, limit: 200 }),
    ]);

    const slices = parseAvailabilities(person.data.attributes.availabilities);
    const summary = summariseCapacity(existing.data ?? [], slices, from, to);
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

function personLabel(person: ProductivePerson): string {
  const first =
    typeof person.attributes.first_name === 'string' ? person.attributes.first_name : '';
  const last = typeof person.attributes.last_name === 'string' ? person.attributes.last_name : '';
  return `${first} ${last}`.trim() || `Person ${person.id}`;
}

/** One line per person, ordered so the busiest show up first. */
function renderRow(person: ProductivePerson, summary: CapacitySummary): string {
  const label = personLabel(person);

  if (summary.contractedMinutes === null) {
    return `• ${label} (ID: ${person.id})
  Contracted hours unknown — no working pattern set on this person
  Planned: ${formatMinutes(summary.plannedMinutes)} (${formatMinutes(summary.projectMinutes)} projects, ${formatMinutes(summary.absenceMinutes)} absence)`;
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
  Projects: ${formatMinutes(summary.projectMinutes)} (${pct(summary.utilisationPercent)}) · Absence: ${formatMinutes(summary.absenceMinutes)}
  Free: ${free}`;
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

    // Who to report on: one person, or everyone the token can see.
    let people: ProductivePerson[];
    if (personId) {
      people = [(await client.getPerson(personId)).data];
    } else {
      const listed = await client.listPeople({ limit: params.limit });
      people = (listed.data ?? []).filter((p) => {
        const attrs = p.attributes;
        if (attrs.deactivated_at) return false;
        // Contacts and agents have no working pattern and would only add noise.
        if (attrs.is_user === false && attrs.placeholder !== true) return false;
        if (!params.include_placeholders && attrs.placeholder === true) return false;
        return true;
      });
    }

    if (people.length === 0) {
      return { content: [{ type: 'text', text: 'No people to report on for these filters.' }] };
    }

    // One bookings call per person keeps each person's window independent.
    const rows = await inBatches(people, 5, async (person) => {
      const bookings = await client.listBookings({
        person_id: person.id,
        after: from,
        before: to,
        limit: 200,
        ...(params.include_placeholders ? {} : { person_type: PERSON_TYPE.USER }),
      });
      const slices = parseAvailabilities(person.attributes.availabilities);
      const summary = summariseCapacity(bookings.data ?? [], slices, from, to);
      return { person, summary };
    });

    rows.sort(
      (a, b) => (b.summary.utilisationPercent ?? -1) - (a.summary.utilisationPercent ?? -1),
    );

    const overbooked = rows.filter((r) => r.summary.overbooked);
    const body = rows.map((r) => renderRow(r.person, r.summary)).join('\n\n');

    const header = `Capacity ${from} to ${to} — ${rows.length} person${rows.length !== 1 ? 's' : ''}`;
    const warning = overbooked.length
      ? `\n\n⚠️ ${overbooked.length} person${overbooked.length !== 1 ? 's are' : ' is'} overbooked: ${overbooked
          .map((r) => personLabel(r.person))
          .join(', ')}`
      : '';
    const scope = personId
      ? ''
      : '\n\nOnly people and bookings visible to the calling token are included — a regular token sees only its own resource planning.';

    return { content: [{ type: 'text', text: `${header}\n\n${body}${warning}${scope}` }] };
  } catch (error) {
    if (error instanceof McpError) throw error;
    if (error instanceof z.ZodError) {
      throw new McpError(
        ErrorCode.InvalidParams,
        `Invalid parameters: ${error.errors.map((e) => e.message).join(', ')}`,
      );
    }
    throw new McpError(
      ErrorCode.InternalError,
      error instanceof Error ? error.message : 'Unknown error occurred',
    );
  }
}

export const getCapacityOverviewDefinition = {
  name: 'get_capacity_overview',
  description:
    'Show planned utilisation per person for a date range: contracted hours (from the person\'s working pattern), how much is taken by project bookings and absences, what is left, and who is overbooked. Answers "do we have capacity for project X next month?". Contracted hours come from each person\'s own working pattern, so part-time contracts are handled correctly. Note that a regular API token only sees its own resource planning — with such a token this reports on the caller alone.',
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
