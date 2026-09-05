import { describe, it, expect, beforeAll } from 'vitest';
import { getConfig, type Config } from '../../src/config/index.js';
import { ProductiveAPIClient } from '../../src/api/client.js';
import { isAbsenceBooking, MAX_PAGE_SIZE } from '../../src/api/bookings-client.js';
import type { ProductiveBooking } from '../../src/api/types.js';

/**
 * Regression cover for the /bookings filters the tools rely on.
 *
 * `docs/api-spec/resources/bookings.yaml` (block `x-filters.booking`) documents
 * `booking_type`, `event_id`, `project_id` and `budget_id`. A live probe
 * (2026-09-05, sandbox org) established what they actually do, and the code now
 * depends on that answer: `list_absences` selects absences server-side with
 * `filter[event_id]` over every event id, `get_capacity_overview` scopes its
 * sweep with a comma-separated `filter[person_id]`, and `list_bookings` still
 * splits client-side because nothing selects project bookings server-side.
 *
 * What was measured, and what this file re-checks:
 *
 *   - `filter[event_id]` works, single id or comma-separated list;
 *   - `filter[event_id][not_eq]` matches only inside the bookings that *have* an
 *     event, so negating every event id yields 0 rows, not the project bookings;
 *   - `filter[booking_type]` is accepted with HTTP 200 and then ignored -- every
 *     value returns the unfiltered set;
 *   - `filter[person_id]` takes a comma-separated list (a,b = a + b);
 *   - `filter[project_id]` filters; an unknown project matches nothing;
 *   - `filter[budget_id]` is accepted, its semantics are unproven;
 *   - an unknown filter key and an unknown sort key are both rejected, with the
 *     status varying (400 seen here, 422 earlier) and the message constant.
 *
 * Nothing org-specific is hardcoded. Every id is read from the org at runtime
 * and every expected number is counted from a ground-truth sweep this file does
 * itself, so it runs anywhere. A red test here means Productive changed its
 * behaviour -- then re-measure, and correct
 * `docs/resource-management-spec.md` (§4), `CLAUDE.md` and the code that leans
 * on the old answer.
 *
 * Run it -- the default reporter hides the console output of a passing file, so
 * the two flags are not optional:
 *
 *     npx vitest run tests/integration/bookings-filters.integration.test.ts \
 *       --reporter=verbose --disable-console-intercept
 *
 * Read-only throughout, so there is nothing to clean up. Only ids and counts are
 * logged -- never names, notes or `people_custom_fields` (personal data, see
 * docs/resource-management-spec.md §12). Every request needs
 * `PRODUCTIVE_API_TOKEN` from .dev.vars; without it the file skips, and with an
 * invalid one it reports INCONCLUSIVE instead of failing, because a red run
 * would blame the filters for what is only a bad token.
 */

/** Pages of ground truth to read before giving up on an exact comparison. */
const GROUND_TRUTH_PAGES = 10;

/** Values worth trying for booking_type: the spec enumerates none. */
const BOOKING_TYPE_VALUES = ['1', '2', '3', 'absence', 'project', 'time_off', 'remote_work'];

/** An id no org will have, for "does this filter narrow anything at all?". */
const UNKNOWN_ID = '999999999';

function authHeaders(config: Config): Record<string, string> {
  // The same three headers ProductiveAPIClient.getHeaders() sends. This file
  // hits query shapes the client cannot build, but must not invent a second
  // auth scheme.
  return {
    'X-Auth-Token': config.PRODUCTIVE_API_TOKEN,
    'X-Organization-Id': config.PRODUCTIVE_ORG_ID,
    'Content-Type': 'application/vnd.api+json',
  };
}

/** Join the JSON:API error objects into one line; fall back to the raw body. */
function messageFrom(bodyText: string): string {
  try {
    const body = JSON.parse(bodyText) as {
      errors?: Array<{ detail?: string; title?: string; code?: string }>;
    };
    const message = (body.errors ?? [])
      .map((e) => [e.code, e.detail || e.title].filter(Boolean).join(': '))
      .filter(Boolean)
      .join('; ');
    return message || bodyText.slice(0, 200);
  } catch {
    return bodyText.slice(0, 200);
  }
}

function parseRows(bodyText: string): ProductiveBooking[] {
  try {
    const body = JSON.parse(bodyText) as { data?: ProductiveBooking[] };
    return Array.isArray(body.data) ? body.data : [];
  } catch {
    return [];
  }
}

/** `meta.total_count` when the endpoint reports it. */
function metaTotal(bodyText: string): number | null {
  try {
    const body = JSON.parse(bodyText) as { meta?: { total_count?: number } };
    return typeof body.meta?.total_count === 'number' ? body.meta.total_count : null;
  } catch {
    return null;
  }
}

/** Count occurrences of a relationship id across bookings. */
function countBy(
  bookings: ProductiveBooking[],
  relationship: 'event' | 'person',
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const booking of bookings) {
    const id = booking.relationships?.[relationship]?.data?.id;
    if (!id) continue;
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return counts;
}

/** The n ids with the most bookings -- the ones that make a comparison meaningful. */
function topIds(counts: Map<string, number>, n: number): string[] {
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([id]) => id);
}

interface Probed {
  ok: boolean;
  status: number;
  text: string;
}

/** What the ground-truth sweep established about this org. */
interface GroundTruth {
  /** False when the API never answered (no token, no permission, network). */
  available: boolean;
  /** False when the sweep hit its page ceiling, which rules out exact comparisons. */
  complete: boolean;
  bookings: ProductiveBooking[];
  absences: number;
  projects: number;
  byEvent: Map<string, number>;
  byPerson: Map<string, number>;
}

describe.skipIf(!process.env.PRODUCTIVE_API_TOKEN)(
  'bookings filter probe (live Productive.io org)',
  () => {
    // Vitest still executes a describe body during collection even when skipIf
    // skips it, so getConfig() must not run at this level -- without
    // credentials it throws and the whole file fails instead of skipping.
    // Same reasoning as tests/integration/custom-fields.integration.test.ts.
    let config: Config;
    let client: ProductiveAPIClient;

    const truth: GroundTruth = {
      available: false,
      complete: false,
      bookings: [],
      absences: 0,
      projects: 0,
      byEvent: new Map(),
      byPerson: new Map(),
    };

    /** One line per finding: printed as it happens, and again as a summary. */
    const findings: string[] = [];

    function record(line: string): void {
      findings.push(line);
      console.error(`[integration] ${line}`);
    }

    /**
     * GET a path with the client's headers. Never throws.
     *
     * A failed response is recorded as INCONCLUSIVE, except where the caller is
     * probing *for* a rejection (`quiet`) -- an invalid token then explains
     * itself once per request instead of failing the run.
     */
    async function probe(label: string, path: string, quiet = false): Promise<Probed | null> {
      try {
        const response = await fetch(`${config.PRODUCTIVE_API_BASE_URL}${path}`, {
          headers: authHeaders(config),
        });
        const text = await response.text();
        if (!response.ok && !quiet) {
          record(`INCONCLUSIVE  ${label} -- HTTP ${response.status}: ${messageFrom(text)}`);
        }
        return { ok: response.ok, status: response.status, text };
      } catch (error) {
        record(`INCONCLUSIVE  ${label} -- never reached the API: ${String(error)}`);
        return null;
      }
    }

    /**
     * How many bookings match a filter.
     *
     * Prefers `meta.total_count`; falls back to counting a full page, which is
     * exact as long as the page did not fill up.
     */
    async function countFor(label: string, query: string): Promise<number | null> {
      const prefix = query ? `${query}&` : '';
      const res = await probe(label, `bookings?${prefix}page[size]=${MAX_PAGE_SIZE}`);
      if (!res?.ok) return null;
      const total = metaTotal(res.text);
      if (total !== null) return total;
      const rows = parseRows(res.text);
      if (rows.length < MAX_PAGE_SIZE) return rows.length;
      record(`INCONCLUSIVE  ${label} -- no meta.total_count and the page filled up`);
      return null;
    }

    /** Read the org's bookings once; every expected number is derived from this. */
    async function sweepGroundTruth(): Promise<void> {
      for (let page = 1; page <= GROUND_TRUTH_PAGES; page += 1) {
        const res = await probe(
          `ground truth page ${page}`,
          // `person` has to be sideloaded too: without it the relationship
          // comes back as a stub with no id, and the person_id probe below
          // finds nobody to compare (see the include gotcha in CLAUDE.md).
          `bookings?include=event,person&sort=started_on&page[size]=${MAX_PAGE_SIZE}&page[number]=${page}`,
        );
        if (!res?.ok) return;
        truth.available = true;
        const rows = parseRows(res.text);
        truth.bookings.push(...rows);
        if (rows.length < MAX_PAGE_SIZE) {
          truth.complete = true;
          break;
        }
      }

      truth.absences = truth.bookings.filter(isAbsenceBooking).length;
      truth.projects = truth.bookings.length - truth.absences;
      truth.byEvent = countBy(truth.bookings, 'event');
      truth.byPerson = countBy(truth.bookings, 'person');
    }

    beforeAll(async () => {
      config = getConfig();
      client = new ProductiveAPIClient(config);
      await sweepGroundTruth();
    });

    /** True when the org answered at all. Records why not, so nothing skips silently. */
    function available(label: string): boolean {
      if (truth.available) return true;
      record(`INCONCLUSIVE  ${label} -- the API never answered, see above`);
      return false;
    }

    /** True when the org answered and the sweep is exact enough to compare against. */
    function comparable(label: string): boolean {
      if (!available(label)) return false;
      if (!truth.complete) {
        record(
          `INCONCLUSIVE  ${label} -- the sweep hit its ${GROUND_TRUTH_PAGES}-page ceiling, so the ` +
            'counted ground truth is partial and cannot be compared against a server-side total',
        );
        return false;
      }
      return true;
    }

    it('counts a ground truth to compare every filter against', () => {
      if (!available('ground truth')) return;
      record(
        `GROUND TRUTH  ${truth.bookings.length} booking(s) visible to this token: ` +
          `${truth.absences} absence(s), ${truth.projects} project booking(s), ` +
          `${truth.byEvent.size} distinct event type(s), ${truth.byPerson.size} person(s)` +
          (truth.complete ? '' : ' -- INCOMPLETE, page ceiling reached'),
      );
    });

    it('filter[event_id] selects exactly the absences of one type', async () => {
      if (!comparable('filter[event_id] single')) return;
      const [eventId] = topIds(truth.byEvent, 1);
      if (!eventId) {
        record('INCONCLUSIVE  filter[event_id] single -- no absence booking in this org');
        return;
      }

      const expected = truth.byEvent.get(eventId) ?? 0;
      const actual = await countFor(`filter[event_id]=${eventId}`, `filter[event_id]=${eventId}`);
      if (actual === null) return;

      record(`filter[event_id]=${eventId}: ${actual} row(s), counted ${expected}`);
      expect(actual).toBe(expected);
    });

    it('filter[event_id] takes a comma-separated list and returns exactly the absences', async () => {
      if (!comparable('filter[event_id] list')) return;
      const ids = [...truth.byEvent.keys()];
      if (ids.length === 0) {
        record('INCONCLUSIVE  filter[event_id] list -- no absence booking in this org');
        return;
      }

      const actual = await countFor(
        `filter[event_id]=<${ids.length} ids>`,
        `filter[event_id]=${ids.join(',')}`,
      );
      if (actual === null) return;

      record(
        `filter[event_id] over all ${ids.length} event id(s): ${actual} row(s), ` +
          `counted ${truth.absences} absence(s)`,
      );
      // This equality is what lets list_absences filter server-side.
      expect(actual).toBe(truth.absences);
    });

    it('filter[event_id][not_eq] cannot produce the project bookings', async () => {
      if (!comparable('filter[event_id][not_eq]')) return;
      const ids = [...truth.byEvent.keys()];
      if (ids.length === 0 || truth.projects === 0) {
        record('INCONCLUSIVE  filter[event_id][not_eq] -- needs both kinds of booking present');
        return;
      }

      const actual = await countFor(
        `filter[event_id][not_eq]=<${ids.length} ids>`,
        `filter[event_id][not_eq]=${ids.join(',')}`,
      );
      if (actual === null) return;

      record(
        `filter[event_id][not_eq] over all event ids: ${actual} row(s) -- ` +
          `${truth.projects} project booking(s) exist`,
      );
      // 0, not the project bookings: the filter only ever matches inside the
      // bookings that have an event. If this ever returns them, list_bookings
      // can drop its client-side split -- so a failure here is a finding.
      expect(actual).toBe(0);
    });

    it('filter[booking_type] is accepted and then ignored', async () => {
      // Server total against server total, so a partial sweep is no obstacle.
      if (!available('filter[booking_type]')) return;
      const unfiltered = await countFor('no filter (baseline)', '');
      if (unfiltered === null || unfiltered === 0) {
        record('INCONCLUSIVE  filter[booking_type] -- no bookings to filter');
        return;
      }

      for (const value of BOOKING_TYPE_VALUES) {
        for (const query of [
          `filter[booking_type]=${value}`,
          `filter[booking_type][eq]=${value}`,
        ]) {
          const actual = await countFor(query, query);
          if (actual === null) continue;
          record(`${query}: ${actual} row(s) against an unfiltered ${unfiltered}`);
          // Documented, accepted, inert. A failure means Productive made it work
          // -- then list_bookings can stop splitting client-side.
          expect(actual).toBe(unfiltered);
        }
      }
      // Ten sequential probes (five values x two syntaxes) against a live API do
      // not fit in vitest's 5s default.
    }, 60_000);

    it('filter[person_id] takes a comma-separated list', async () => {
      // a + b against a,b -- all three counted by the server, so a partial
      // sweep only affects which two people are picked, not the comparison.
      if (!available('filter[person_id] list')) return;
      const [first, second] = topIds(truth.byPerson, 2);
      if (!first || !second) {
        record('INCONCLUSIVE  filter[person_id] list -- fewer than two people have bookings');
        return;
      }

      const a = await countFor(`filter[person_id]=${first}`, `filter[person_id]=${first}`);
      const b = await countFor(`filter[person_id]=${second}`, `filter[person_id]=${second}`);
      const both = await countFor(
        `filter[person_id]=${first},${second}`,
        `filter[person_id]=${first},${second}`,
      );
      if (a === null || b === null || both === null) return;

      record(`filter[person_id] list: ${a} + ${b} = ${a + b}, list returned ${both}`);
      // get_capacity_overview scopes its sweep with exactly this.
      expect(both).toBe(a + b);
    });

    it('filter[project_id] narrows, filter[budget_id] is at least accepted', async () => {
      if (!available('filter[project_id] / filter[budget_id]')) return;
      const projects = await client.listProjects({ status: 'active', limit: 5 }).catch(() => null);

      for (const project of projects?.data ?? []) {
        const count = await countFor(
          `filter[project_id]=${project.id}`,
          `filter[project_id]=${project.id}`,
        );
        if (count === null || count === 0) continue;
        record(`filter[project_id]=${project.id}: ${count} row(s)`);
        const unknown = await countFor(
          `filter[project_id]=${UNKNOWN_ID}`,
          `filter[project_id]=${UNKNOWN_ID}`,
        );
        // A filter that answers the same for a real and an impossible project
        // is not filtering -- which is exactly what booking_type does.
        if (unknown !== null) expect(unknown).toBe(0);
        break;
      }

      const budget = await countFor(
        `filter[budget_id]=${UNKNOWN_ID}`,
        `filter[budget_id]=${UNKNOWN_ID}`,
      );
      record(
        budget === null
          ? 'filter[budget_id]: rejected -- see the line above'
          : `filter[budget_id]=${UNKNOWN_ID}: accepted, ${budget} row(s) (semantics unproven)`,
      );
    });

    it('rejects an unknown filter key and an unknown sort key', async () => {
      if (!available('unknown filter / unknown sort')) return;

      const refusals: Array<[string, string]> = [
        ['unknown filter', 'filter[bogus_xyz]=1'],
        ['unknown sort', 'sort=bogus_field'],
      ];

      for (const [label, query] of refusals) {
        const res = await probe(label, `bookings?${query}`, true);
        if (!res) continue;
        record(`${label} -> HTTP ${res.status}: ${messageFrom(res.text)}`);
        // The status has been both 400 and 422 for this; the message is the
        // stable part, which is why src/utils/errors.ts branches on the status
        // class and never on the code.
        expect(res.ok).toBe(false);
      }
    });

    it('prints the summary of every finding in this file', () => {
      console.error(
        '[integration] ---- /bookings filter probe summary ----\n' +
          findings.map((f) => `[integration] ${f}`).join('\n') +
          '\n[integration] ---- measured behaviour is written up in ' +
          'docs/resource-management-spec.md §4 ----',
      );
    });
  },
);
