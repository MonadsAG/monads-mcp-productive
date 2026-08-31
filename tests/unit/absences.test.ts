import { describe, it, expect, vi } from 'vitest';
import type { ProductiveAPIClient } from '../../src/api/client.js';
import type { ProductiveBooking } from '../../src/api/types.js';
import { createAbsenceTool, listAbsencesTool } from '../../src/tools/absences.js';
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

describe('listAbsencesTool applies limit after the absences are separated out', () => {
  it('over-fetches so project bookings cannot crowd absences out', async () => {
    const client = mockClient({
      listBookings: vi.fn().mockResolvedValue({ data: [absence('1')] }),
    });

    await listAbsencesTool(client, { limit: 10 }, {});

    expect(client.listBookings).toHaveBeenCalledWith(expect.objectContaining({ limit: 30 }));
  });

  it('trims to the requested limit and says there may be more', async () => {
    const client = mockClient({
      listBookings: vi.fn().mockResolvedValue({ data: [absence('1'), absence('2'), absence('3')] }),
    });

    const result = await listAbsencesTool(client, { limit: 2 }, {});

    expect(result.content[0].text).toContain('2 absences found');
    expect(result.content[0].text).toContain('There may be more');
  });

  it('explains an empty result when the page was full of other bookings', async () => {
    const client = mockClient({
      // limit 1 -> fetches 3, all of them project bookings.
      listBookings: vi.fn().mockResolvedValue({
        data: [projectBooking('1'), projectBooking('2'), projectBooking('3')],
      }),
    });

    const result = await listAbsencesTool(client, { limit: 1 }, {});

    expect(result.content[0].text).toContain('No absences found');
    expect(result.content[0].text).toContain('full of other bookings');
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
