import { describe, it, expect, vi } from 'vitest';
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import type { ProductiveAPIClient } from '../../src/api/client.js';
import type { ProductiveBooking } from '../../src/api/types.js';
import {
  createAbsenceTool,
  listAbsenceTypesTool,
  listAbsencesTool,
} from '../../src/tools/absences.js';
import { listBookingsTool } from '../../src/tools/bookings.js';

/** Mon-Thu 8h, Friday off: a 32h contract, Monday first, two-week rotation. */
const FOUR_DAY_WEEK = JSON.stringify([
  ['2020-01-01', null, [8, 8, 8, 8, 0, 0, 0, 8, 8, 8, 8, 0, 0, 0], 1],
]);

const FULL_TIME = JSON.stringify([
  ['2020-01-01', null, [8, 8, 8, 8, 8, 0, 0, 8, 8, 8, 8, 8, 0, 0], 1],
]);

function person(availabilities?: string) {
  return {
    data: {
      id: '7',
      type: 'people',
      attributes: { first_name: 'Ada', last_name: 'Lovelace', availabilities },
    },
  };
}

/** Vacation: no half days, so create_absence picks booking method 3 (total hours). */
const VACATION = {
  id: '1',
  type: 'events',
  attributes: { name: 'Vacation', half_day_bookings: false, event_type_id: 1 },
};

/** Remote work: same resource as an absence, but the person is at their desk. */
const HOME_OFFICE = {
  id: '5',
  type: 'events',
  attributes: { name: 'Home Office', absence_type: 'remote_work', event_type_id: 2 },
};

function absence(id: string, attrs: Record<string, unknown> = {}): ProductiveBooking {
  return {
    id,
    type: 'bookings',
    relationships: {
      person: { data: { id: '7', type: 'people' } },
      event: { data: { id: '1', type: 'events' } },
    },
    attributes: { started_on: '2026-03-02', ended_on: '2026-03-06', ...attrs },
  } as ProductiveBooking;
}

function projectBooking(id: string): ProductiveBooking {
  return {
    id,
    type: 'bookings',
    relationships: {
      person: { data: { id: '7', type: 'people' } },
      service: { data: { id: '9', type: 'services' } },
    },
    attributes: { started_on: '2026-03-02', ended_on: '2026-03-06', total_time: 480 },
  } as ProductiveBooking;
}

function mockClient(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    listEvents: vi.fn().mockResolvedValue({ data: [VACATION] }),
    getPerson: vi.fn().mockResolvedValue(person(FOUR_DAY_WEEK)),
    listBookings: vi.fn().mockResolvedValue({ data: [] }),
    createBooking: vi.fn().mockResolvedValue({ data: absence('100', { total_working_days: 4 }) }),
    ...overrides,
  } as unknown as ProductiveAPIClient;
}

describe('createAbsenceTool sizes the absence from the person, not the calendar', () => {
  const week = { date_from: '2026-03-02', date_to: '2026-03-06' }; // Mon-Fri

  it('books a four-day contract for 32h, not 40h', async () => {
    const client = mockClient();

    await createAbsenceTool(
      client,
      { person_id: '7', absence_type: 'Vacation', ...week, confirm: true },
      {},
    );

    expect(client.createBooking).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          attributes: expect.objectContaining({ total_time: 1920, booking_method_id: 3 }),
        }),
      }),
    );
  });

  it('still books 40h for a five-day contract', async () => {
    const client = mockClient({
      getPerson: vi.fn().mockResolvedValue(person(FULL_TIME)),
    });

    await createAbsenceTool(
      client,
      { person_id: '7', absence_type: 'Vacation', ...week, confirm: true },
      {},
    );

    expect(client.createBooking).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          attributes: expect.objectContaining({ total_time: 2400 }),
        }),
      }),
    );
  });

  it('falls back to calendar weekdays when the person has no pattern', async () => {
    const client = mockClient({ getPerson: vi.fn().mockResolvedValue(person(undefined)) });

    await createAbsenceTool(
      client,
      { person_id: '7', absence_type: 'Vacation', ...week, confirm: true },
      {},
    );

    // 5 weekdays x the 8h default.
    expect(client.createBooking).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          attributes: expect.objectContaining({ total_time: 2400 }),
        }),
      }),
    );
  });

  it('honours an explicit hours_per_day over the pattern', async () => {
    const client = mockClient();

    await createAbsenceTool(
      client,
      { person_id: '7', absence_type: 'Vacation', ...week, hours_per_day: 4, confirm: true },
      {},
    );

    // Half days across the four days the person actually works.
    expect(client.createBooking).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ attributes: expect.objectContaining({ total_time: 960 }) }),
      }),
    );
  });

  it('refuses a range the person is never contracted to work', async () => {
    const client = mockClient();

    // 2026-03-06 is the Friday this contract does not cover.
    await expect(
      createAbsenceTool(
        client,
        {
          person_id: '7',
          absence_type: 'Vacation',
          date_from: '2026-03-06',
          date_to: '2026-03-06',
        },
        {},
      ),
    ).rejects.toThrow(/not contracted to work/i);
    expect(client.createBooking).not.toHaveBeenCalled();
  });

  it('reports the derived hours in the confirmation preview', async () => {
    const client = mockClient();

    const result = await createAbsenceTool(
      client,
      { person_id: '7', absence_type: 'Vacation', ...week },
      {},
    );

    expect(result.content[0].text).toContain('Working days: 4');
    expect(result.content[0].text).toContain('Hours per day: 8');
    expect(client.createBooking).not.toHaveBeenCalled();
  });
});

describe('listAbsencesTool selects the absences server-side', () => {
  it('filters by every event id, so the limit can be passed through as-is', async () => {
    const client = mockClient({
      listEvents: vi.fn().mockResolvedValue({ data: [VACATION, HOME_OFFICE] }),
      listBookings: vi.fn().mockResolvedValue({ data: [absence('1')] }),
    });

    await listAbsencesTool(client, { limit: 10 }, {});

    expect(client.listBookings).toHaveBeenCalledWith(
      expect.objectContaining({ event_id: '1,5', limit: 10 }),
    );
  });

  it('narrows the filter to the one event when absence_type is given', async () => {
    const client = mockClient({
      listEvents: vi.fn().mockResolvedValue({ data: [VACATION, HOME_OFFICE] }),
      listBookings: vi.fn().mockResolvedValue({ data: [absence('1')] }),
    });

    await listAbsencesTool(client, { absence_type: 'Vacation' }, {});

    expect(client.listBookings).toHaveBeenCalledWith(expect.objectContaining({ event_id: '1' }));
  });

  it('still drops a project booking that slips past the filter', async () => {
    const client = mockClient({
      listBookings: vi.fn().mockResolvedValue({ data: [absence('1'), projectBooking('2')] }),
    });

    const result = await listAbsencesTool(client, {}, {});

    expect(result.content[0].text).toContain('1 absence found');
  });

  it('trims to the requested limit and says there may be more', async () => {
    const client = mockClient({
      listBookings: vi.fn().mockResolvedValue({ data: [absence('1'), absence('2'), absence('3')] }),
    });

    const result = await listAbsencesTool(client, { limit: 2 }, {});

    expect(result.content[0].text).toContain('2 absences found');
    expect(result.content[0].text).toContain('There may be more');
  });

  it('reports an empty result without blaming the page size', async () => {
    const client = mockClient({ listBookings: vi.fn().mockResolvedValue({ data: [] }) });

    const result = await listAbsencesTool(client, { limit: 1 }, {});

    expect(result.content[0].text).toContain('No absences found');
    expect(result.content[0].text).toContain('only sees its own resource planning');
  });
});

describe('listAbsencesTool treats remote work as presence, not absence', () => {
  /** A booking against the Home Office event, sideloaded so it can be told apart. */
  function homeOffice(id: string): ProductiveBooking {
    const booking = absence(id);
    booking.relationships = {
      person: { data: { id: '7', type: 'people' } },
      event: { data: { id: '5', type: 'events' } },
    };
    return booking;
  }

  const withRemote = {
    data: [absence('1'), homeOffice('2')],
    included: [HOME_OFFICE],
  };

  it('hides remote work bookings by default and says so', async () => {
    const client = mockClient({ listBookings: vi.fn().mockResolvedValue(withRemote) });

    const result = await listAbsencesTool(client, {}, {});

    expect(result.content[0].text).toContain('1 absence found');
    expect(result.content[0].text).toContain('1 remote work booking hidden');
    expect(result.content[0].text).toContain('include_remote_work: true');
  });

  it('shows them once include_remote_work is set', async () => {
    const client = mockClient({ listBookings: vi.fn().mockResolvedValue(withRemote) });

    const result = await listAbsencesTool(client, { include_remote_work: true }, {});

    expect(result.content[0].text).toContain('2 absences found');
    expect(result.content[0].text).not.toContain('hidden');
  });

  it('keeps an event without absence_type as an absence', async () => {
    // Conservative fallback: an unclassified event must never be dropped, or a
    // sick leave would silently disappear from "who is off?".
    const client = mockClient({
      listBookings: vi.fn().mockResolvedValue({
        data: [homeOffice('2')],
        included: [{ id: '5', type: 'events', attributes: { name: 'Unlabelled' } }],
      }),
    });

    const result = await listAbsencesTool(client, {}, {});

    expect(result.content[0].text).toContain('1 absence found');
  });

  it('still answers an explicit request for a remote work type', async () => {
    const client = mockClient({
      listEvents: vi.fn().mockResolvedValue({ data: [VACATION, HOME_OFFICE] }),
      // What the server returns for filter[event_id]=5.
      listBookings: vi.fn().mockResolvedValue({ data: [homeOffice('2')], included: [HOME_OFFICE] }),
    });

    const result = await listAbsencesTool(client, { absence_type: 'Home Office' }, {});

    expect(client.listBookings).toHaveBeenCalledWith(expect.objectContaining({ event_id: '5' }));
    expect(result.content[0].text).toContain('1 absence found');
    expect(result.content[0].text).toContain('This type is remote work');
  });
});

describe('listAbsenceTypesTool labels the category', () => {
  it('marks remote work as such and never calls it Unpaid', async () => {
    const client = mockClient({
      listEvents: vi.fn().mockResolvedValue({ data: [VACATION, HOME_OFFICE] }),
    });

    const result = await listAbsenceTypesTool(client, {});

    expect(result.content[0].text).toContain('Remote work');
    expect(result.content[0].text).toContain('Time off');
    // event_type_id 2 is forced on every remote work event, so "Unpaid" here
    // would be a statement about home office that the API never made.
    expect(result.content[0].text).not.toContain('Unpaid');
  });
});

describe('createAbsenceTool rejects IDs the API cannot take', () => {
  it('refuses a non-numeric person_id instead of sending null', async () => {
    const client = mockClient();

    await expect(
      createAbsenceTool(
        client,
        {
          person_id: 'ada@example.com',
          absence_type: 'Vacation',
          date_from: '2026-03-02',
          date_to: '2026-03-06',
          confirm: true,
        },
        {},
      ),
    ).rejects.toThrow(/person_id must be a numeric Productive ID/);
    expect(client.createBooking).not.toHaveBeenCalled();
  });

  it('names remote work in the confirmation preview', async () => {
    const client = mockClient({
      listEvents: vi.fn().mockResolvedValue({ data: [VACATION, HOME_OFFICE] }),
    });

    const result = await createAbsenceTool(
      client,
      {
        person_id: '7',
        absence_type: 'Home Office',
        date_from: '2026-03-02',
        date_to: '2026-03-06',
      },
      {},
    );

    expect(result.content[0].text).toContain('remote work');
    expect(client.createBooking).not.toHaveBeenCalled();
  });
});

describe('rejection reasons stay behind the same opt-in as notes', () => {
  const rejected = absence('1', {
    rejected: true,
    rejected_reason: 'still signed off sick',
    note: 'surgery follow-up',
  });

  it('omits the reason from list_absences by default', async () => {
    const client = mockClient({ listBookings: vi.fn().mockResolvedValue({ data: [rejected] }) });

    const result = await listAbsencesTool(client, {}, {});

    expect(result.content[0].text).toContain('Status: Rejected');
    expect(result.content[0].text).not.toContain('still signed off sick');
    expect(result.content[0].text).not.toContain('surgery follow-up');
  });

  it('includes it once include_notes is set', async () => {
    const client = mockClient({ listBookings: vi.fn().mockResolvedValue({ data: [rejected] }) });

    const result = await listAbsencesTool(client, { include_notes: true }, {});

    expect(result.content[0].text).toContain('Rejected (still signed off sick)');
  });

  it('never leaks it through list_bookings, which has no opt-in at all', async () => {
    const withReason = projectBooking('1');
    withReason.attributes.rejected = true;
    withReason.attributes.rejected_reason = 'still signed off sick';
    const client = mockClient({ listBookings: vi.fn().mockResolvedValue({ data: [withReason] }) });

    const result = await listBookingsTool(client, {}, {});

    expect(result.content[0].text).toContain('Status: Rejected');
    expect(result.content[0].text).not.toContain('still signed off sick');
  });
});

describe('createAbsenceTool refuses to double-book a period', () => {
  const existing = absence('900', { started_on: '2026-03-02', ended_on: '2026-03-06' });

  it('refuses a period the person is already absent for, naming the clash', async () => {
    const client = mockClient({
      listBookings: vi.fn().mockResolvedValue({ data: [existing] }),
    });

    const error = await createAbsenceTool(
      client,
      {
        person_id: '7',
        absence_type: 'Vacation',
        date_from: '2026-03-02',
        date_to: '2026-03-06',
        confirm: true,
      },
      {},
    ).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(McpError);
    expect((error as McpError).code).toBe(ErrorCode.InvalidParams);
    expect((error as McpError).message).toContain('booking 900');
    expect((error as McpError).message).toContain('allow_overlap');
    expect(client.createBooking).not.toHaveBeenCalled();
  });

  it('books it anyway when the caller says the overlap is intended', async () => {
    const client = mockClient({
      listBookings: vi.fn().mockResolvedValue({ data: [existing] }),
    });

    await createAbsenceTool(
      client,
      {
        person_id: '7',
        absence_type: 'Vacation',
        date_from: '2026-03-02',
        date_to: '2026-03-06',
        allow_overlap: true,
        confirm: true,
      },
      {},
    );

    expect(client.createBooking).toHaveBeenCalled();
  });

  it('warns about the clash in the preview instead of failing it', async () => {
    const client = mockClient({
      listBookings: vi.fn().mockResolvedValue({ data: [existing] }),
    });

    const result = await createAbsenceTool(
      client,
      {
        person_id: '7',
        absence_type: 'Vacation',
        date_from: '2026-03-02',
        date_to: '2026-03-06',
      },
      {},
    );

    expect(result.content[0].text).toContain('already covered by');
    expect(result.content[0].text).toContain('booking 900');
    expect(client.createBooking).not.toHaveBeenCalled();
  });

  // Cancelled and rejected entries free the period up again -- treating them as
  // a clash would lock a person out of rebooking a holiday they withdrew.
  it('ignores cancelled and rejected absences when looking for clashes', async () => {
    const client = mockClient({
      listBookings: vi.fn().mockResolvedValue({
        data: [
          absence('901', { canceled: true }),
          absence('902', { rejected: true }),
          projectBooking('903'),
        ],
      }),
    });

    await createAbsenceTool(
      client,
      {
        person_id: '7',
        absence_type: 'Vacation',
        date_from: '2026-03-02',
        date_to: '2026-03-06',
        confirm: true,
      },
      {},
    );

    expect(client.createBooking).toHaveBeenCalled();
  });
});
