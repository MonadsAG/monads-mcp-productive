import { describe, it, expect, vi } from 'vitest';
import type { ProductiveAPIClient } from '../../src/api/client.js';
import type {
  ProductiveBooking,
  ProductiveIncludedResource,
  ProductivePerson,
} from '../../src/api/types.js';
import { MAX_BOOKING_PAGES, MAX_PAGE_SIZE, PERSON_TYPE } from '../../src/api/bookings-client.js';
import { getCapacityOverviewTool } from '../../src/tools/capacity.js';

/** Mon-Fri 8h: a 40h week, Monday first, two-week rotation. */
const FULL_TIME = JSON.stringify([
  ['2020-01-01', null, [8, 8, 8, 8, 8, 0, 0, 8, 8, 8, 8, 8, 0, 0], 1],
]);

/** The queried window: Monday to Friday, so 40h contracted for a full-timer. */
const WEEK = { date_from: '2026-03-02', date_to: '2026-03-06' };

function person(id: string, name: string): ProductivePerson {
  return {
    id,
    type: 'people',
    attributes: {
      email: `${name.toLowerCase()}@example.com`,
      first_name: name,
      last_name: `P${id}`,
      created_at: '2020-01-01T00:00:00Z',
      availabilities: FULL_TIME,
      is_user: true,
    },
  };
}

function projectBooking(id: string, personId: string, totalTime: number): ProductiveBooking {
  return {
    id,
    type: 'bookings',
    relationships: {
      person: { data: { id: personId, type: 'people' } },
      service: { data: { id: '9', type: 'services' } },
    },
    attributes: { started_on: WEEK.date_from, ended_on: WEEK.date_to, total_time: totalTime },
  } as ProductiveBooking;
}

/** A booking tied to an event -- absence or remote work, depending on `included`. */
function eventBooking(id: string, personId: string, eventId: string): ProductiveBooking {
  return {
    id,
    type: 'bookings',
    relationships: {
      person: { data: { id: personId, type: 'people' } },
      event: { data: { id: eventId, type: 'events' } },
    },
    attributes: { started_on: WEEK.date_from, ended_on: WEEK.date_to, total_time: 2400 },
  } as ProductiveBooking;
}

const HOME_OFFICE: ProductiveIncludedResource = {
  id: '5',
  type: 'events',
  attributes: { name: 'Home Office', absence_type: 'remote_work' },
};

/** A page the pager has to follow: exactly as many rows as it asked for. */
function fullPage(): ProductiveBooking[] {
  return Array.from({ length: MAX_PAGE_SIZE }, (_, i) => projectBooking(`f${i}`, '999', 60));
}

type MockClient = ProductiveAPIClient & {
  listPeople: ReturnType<typeof vi.fn>;
  listBookings: ReturnType<typeof vi.fn>;
  getPerson: ReturnType<typeof vi.fn>;
};

function mockClient(overrides: Partial<Record<string, unknown>> = {}): MockClient {
  return {
    listPeople: vi.fn().mockResolvedValue({ data: [person('1', 'Ada')] }),
    listBookings: vi.fn().mockResolvedValue({ data: [] }),
    getPerson: vi.fn().mockResolvedValue({ data: person('7', 'Grace') }),
    ...overrides,
  } as unknown as MockClient;
}

async function overview(client: MockClient, args: Record<string, unknown> = {}): Promise<string> {
  const result = await getCapacityOverviewTool(client, { ...WEEK, ...args }, {});
  return result.content[0].text;
}

/** The block of the report belonging to one person. */
function rowFor(text: string, personId: string): string {
  const block = text.split('\n\n').find((part) => part.includes(`(ID: ${personId})`));
  if (!block) throw new Error(`no row for person ${personId} in:\n${text}`);
  return block;
}

// The overview used to issue one bookings request per person, in batches of
// five. At limit=200 that is 201 requests against a 100-per-10s rate limit and
// the Workers subrequest budget, and it silently truncated at 200 bookings per
// person. These tests pin the single sweep that replaced it.
describe('getCapacityOverviewTool fetches bookings once for everyone', () => {
  it('makes one bookings call for three people, not one each', async () => {
    const client = mockClient({
      listPeople: vi.fn().mockResolvedValue({
        data: [person('1', 'Ada'), person('2', 'Grace'), person('3', 'Alan')],
      }),
    });

    await overview(client);

    expect(client.listBookings).toHaveBeenCalledTimes(1);
  });

  // Scoping the sweep is not cosmetic: an unscoped one pulls in bookings for
  // people who never appear in the output and burns the page budget on them.
  it('scopes the one call to exactly the people it reports on', async () => {
    const client = mockClient({
      listPeople: vi.fn().mockResolvedValue({
        data: [person('1', 'Ada'), person('2', 'Grace'), person('3', 'Alan')],
      }),
    });

    await overview(client);

    expect(client.listBookings).toHaveBeenCalledWith(
      expect.objectContaining({ person_id: '1,2,3' }),
    );
  });

  it('asks the API for active people only', async () => {
    const client = mockClient();

    await overview(client);

    expect(client.listPeople).toHaveBeenCalledWith(expect.objectContaining({ is_active: true }));
  });

  it('attributes each booking to its own person', async () => {
    const client = mockClient({
      listPeople: vi.fn().mockResolvedValue({
        data: [person('1', 'Ada'), person('2', 'Grace'), person('3', 'Alan')],
      }),
      listBookings: vi.fn().mockResolvedValue({
        data: [projectBooking('b1', '1', 1200), projectBooking('b2', '2', 2400)],
      }),
    });

    const text = await overview(client);

    expect(rowFor(text, '1')).toContain('Projects: 20h');
    expect(rowFor(text, '2')).toContain('Projects: 40h');
    expect(rowFor(text, '3')).toContain('Projects: 0m');
  });

  it('passes the person_type filter to the sweep when placeholders are excluded', async () => {
    const client = mockClient();

    await overview(client, { include_placeholders: false });

    expect(client.listBookings).toHaveBeenCalledWith(
      expect.objectContaining({ person_type: PERSON_TYPE.USER }),
    );
  });
});

describe('getCapacityOverviewTool pages through the bookings', () => {
  it('follows meta.total_pages to the last page', async () => {
    const client = mockClient({
      listBookings: vi
        .fn()
        .mockImplementation((params: { page?: number }) =>
          params.page === 1
            ? Promise.resolve({ data: fullPage(), meta: { total_pages: 2 } })
            : Promise.resolve({ data: [projectBooking('b1', '1', 600)] }),
        ),
    });

    const text = await overview(client);

    expect(client.listBookings).toHaveBeenCalledTimes(2);
    expect(client.listBookings.mock.calls[1][0]).toMatchObject({
      page: 2,
      limit: MAX_PAGE_SIZE,
      sort: 'started_on',
    });
    expect(rowFor(text, '1')).toContain('Projects: 10h');
  });

  it('stops as soon as a page comes back short', async () => {
    const client = mockClient({
      listBookings: vi.fn().mockResolvedValue({ data: [projectBooking('b1', '1', 600)] }),
    });

    await overview(client);

    expect(client.listBookings).toHaveBeenCalledTimes(1);
  });

  it('stops at the page ceiling and says the numbers are incomplete', async () => {
    const client = mockClient({
      listBookings: vi.fn().mockResolvedValue({ data: fullPage(), meta: { total_pages: 99 } }),
    });

    const text = await overview(client);

    expect(client.listBookings).toHaveBeenCalledTimes(MAX_BOOKING_PAGES);
    expect(text).toContain('Incomplete');
    expect(text).toContain('upper bound');
    // The warning has to precede the figures it qualifies.
    expect(text.indexOf('Incomplete')).toBeLessThan(text.indexOf('(ID: 1)'));
  });
});

describe('getCapacityOverviewTool for a single person', () => {
  it('never lists people and filters the bookings by that person', async () => {
    const client = mockClient();

    await overview(client, { person_id: '7' });

    expect(client.listPeople).not.toHaveBeenCalled();
    expect(client.listBookings).toHaveBeenCalledTimes(1);
    expect(client.listBookings).toHaveBeenCalledWith(
      expect.objectContaining({ person_id: '7', after: WEEK.date_from, before: WEEK.date_to }),
    );
  });
});

// Working from home is still working. Counting it as absence reported a fully
// staffed week as booked solid and flagged remote-first people as overbooked.
describe('getCapacityOverviewTool treats remote work as available', () => {
  it('reports it separately without eating into free capacity', async () => {
    const client = mockClient({
      listBookings: vi.fn().mockResolvedValue({
        data: [eventBooking('b1', '1', '5')],
        included: [HOME_OFFICE],
      }),
    });

    const text = await overview(client);

    expect(rowFor(text, '1')).toContain('Remote: 40h');
    expect(rowFor(text, '1')).toContain('Free: 40h');
    expect(text).not.toContain('OVERBOOKED');
    expect(text).toContain('not deducted');
  });

  it('keeps the same booking an absence when the event is not sideloaded', async () => {
    const client = mockClient({
      listBookings: vi.fn().mockResolvedValue({ data: [eventBooking('b1', '1', '5')] }),
    });

    const text = await overview(client);

    expect(rowFor(text, '1')).toContain('Absence: 40h');
    expect(text).not.toContain('Remote:');
  });
});

// Both cases end up without contracted hours, but one is a gap in Productive
// and the other is a parsing bug here. One shared message would hide the bug.
describe('getCapacityOverviewTool says why contracted hours are unknown', () => {
  function withAvailabilities(raw: unknown): MockClient {
    const p = person('1', 'Ada');
    return mockClient({
      listPeople: vi.fn().mockResolvedValue({
        data: [{ ...p, attributes: { ...p.attributes, availabilities: raw } }],
      }),
    });
  }

  it('reports a missing working pattern as missing', async () => {
    const text = await overview(withAvailabilities(undefined));

    expect(text).toContain('no working pattern set on this person');
  });

  it('reports a pattern it cannot read as unreadable', async () => {
    const text = await overview(withAvailabilities('{"shape":"unexpected"}'));

    expect(text).toContain('could not be read');
  });
});
