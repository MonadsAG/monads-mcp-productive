import { describe, it, expect, vi } from 'vitest';
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import type { ProductiveAPIClient } from '../../src/api/client.js';
import type { ProductiveBooking } from '../../src/api/types.js';
import { ProductiveApiError } from '../../src/api/errors.js';
import {
  createBookingTool,
  deleteBookingTool,
  listBookingsTool,
  updateBookingTool,
} from '../../src/tools/bookings.js';
import { MAX_PAGE_SIZE } from '../../src/api/bookings-client.js';

/** Mon-Thu 8h, Friday off: a 32h contract, Monday first, two-week rotation. */
const FOUR_DAY_WEEK = JSON.stringify([
  ['2020-01-01', null, [8, 8, 8, 8, 0, 0, 0, 8, 8, 8, 8, 0, 0, 0], 1],
]);

/** Mon-Fri; the Friday is exactly the day the four-day contract does not cover. */
const WEEK = { date_from: '2026-03-02', date_to: '2026-03-06' };

function person(availabilities?: string) {
  return {
    data: {
      id: '7',
      type: 'people',
      attributes: { first_name: 'Ada', last_name: 'Lovelace', availabilities },
    },
  };
}

function projectBooking(id: string, attrs: Record<string, unknown> = {}): ProductiveBooking {
  return {
    id,
    type: 'bookings',
    relationships: {
      person: { data: { id: '7', type: 'people' } },
      service: { data: { id: '9', type: 'services' } },
    },
    attributes: { started_on: '2026-03-02', ended_on: '2026-03-06', total_time: 1920, ...attrs },
  } as ProductiveBooking;
}

function absenceBooking(id: string, attrs: Record<string, unknown> = {}): ProductiveBooking {
  return {
    id,
    type: 'bookings',
    relationships: {
      person: { data: { id: '7', type: 'people' } },
      event: { data: { id: '1', type: 'events' } },
    },
    attributes: { started_on: '2026-03-02', ended_on: '2026-03-06', total_time: 1920, ...attrs },
  } as ProductiveBooking;
}

/** getBooking, createBooking and updateBooking all answer with a single resource. */
function single(booking: ProductiveBooking) {
  return { data: booking };
}

function mockClient(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    getPerson: vi.fn().mockResolvedValue(person(FOUR_DAY_WEEK)),
    listBookings: vi.fn().mockResolvedValue({ data: [] }),
    createBooking: vi
      .fn()
      .mockResolvedValue(single(projectBooking('100', { total_working_days: 4 }))),
    getBooking: vi.fn().mockResolvedValue(single(projectBooking('55', { booking_method_id: 3 }))),
    updateBooking: vi
      .fn()
      .mockResolvedValue(single(projectBooking('55', { total_working_days: 4 }))),
    deleteBooking: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as ProductiveAPIClient;
}

/** Run a tool and hand back what it threw, so both code and message can be asserted. */
async function caught(promise: Promise<unknown>): Promise<McpError> {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(McpError);
  return error as McpError;
}

describe('createBookingTool', () => {
  it('previews without writing when confirm is missing', async () => {
    const client = mockClient();

    const result = await createBookingTool(
      client,
      { person_id: '7', service_id: '9', ...WEEK, hours_per_day: 8 },
      {},
    );

    expect(result.content[0].text).toContain('Project booking ready to create');
    expect(result.content[0].text).toContain('Ada Lovelace (ID 7)');
    expect(result.content[0].text).toContain('"confirm": true');
    expect(client.createBooking).not.toHaveBeenCalled();
  });

  it('books a percentage as booking method 2', async () => {
    const client = mockClient();

    await createBookingTool(
      client,
      { person_id: '7', service_id: '9', ...WEEK, percentage: 50, confirm: true },
      {},
    );

    expect(client.createBooking).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          attributes: expect.objectContaining({ booking_method_id: 2, percentage: 50 }),
        }),
      }),
    );
  });

  it('books hours per day as booking method 1, in hours and minutes', async () => {
    const client = mockClient();

    await createBookingTool(
      client,
      { person_id: '7', service_id: '9', ...WEEK, hours_per_day: 6, confirm: true },
      {},
    );

    expect(client.createBooking).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          attributes: expect.objectContaining({ booking_method_id: 1, hours: 6, time: 360 }),
        }),
      }),
    );
  });

  it('totals booking method 3 over the working days of the person, not the calendar', async () => {
    const client = mockClient();

    await createBookingTool(
      client,
      {
        person_id: '7',
        service_id: '9',
        ...WEEK,
        hours_per_day: 8,
        booking_method_id: 3,
        confirm: true,
      },
      {},
    );

    // Mon-Thu contract over a Mon-Fri range: 4 x 8h, not the calendar's 5 x 8h.
    expect(client.createBooking).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          attributes: expect.objectContaining({ booking_method_id: 3, total_time: 1920 }),
        }),
      }),
    );
  });

  it('resolves "me" against the configured user', async () => {
    const client = mockClient();

    await createBookingTool(
      client,
      { service_id: '9', ...WEEK, hours_per_day: 8, confirm: true },
      { PRODUCTIVE_USER_ID: '7' },
    );

    expect(client.createBooking).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          attributes: expect.objectContaining({ person_id: 7, service_id: 9 }),
        }),
      }),
    );
  });

  it('rejects a non-numeric service_id instead of sending null to the API', async () => {
    const client = mockClient();

    const error = await caught(
      createBookingTool(
        client,
        { person_id: '7', service_id: 'abc', ...WEEK, hours_per_day: 8, confirm: true },
        {},
      ),
    );

    expect(error.code).toBe(ErrorCode.InvalidParams);
    expect(error.message).toContain('service_id must be a numeric');
    expect(client.createBooking).not.toHaveBeenCalled();
  });
});

describe('updateBookingTool', () => {
  it('clears the amounts of the previous method when switching to percentage', async () => {
    const client = mockClient();

    await updateBookingTool(client, { booking_id: '55', percentage: 50, confirm: true });

    expect(client.updateBooking).toHaveBeenCalledWith(
      '55',
      expect.objectContaining({
        data: expect.objectContaining({
          attributes: expect.objectContaining({
            booking_method_id: 2,
            percentage: 50,
            total_time: 0,
            hours: 0,
            time: 0,
          }),
        }),
      }),
    );
  });

  it('recomputes a method-3 total over the working days of the person', async () => {
    const client = mockClient();

    await updateBookingTool(client, { booking_id: '55', hours_per_day: 8, confirm: true });

    expect(client.updateBooking).toHaveBeenCalledWith(
      '55',
      expect.objectContaining({
        data: expect.objectContaining({
          attributes: expect.objectContaining({ booking_method_id: 3, total_time: 1920 }),
        }),
      }),
    );
  });

  it('names the person and the project booking in the preview, and writes nothing', async () => {
    const client = mockClient();

    const result = await updateBookingTool(client, { booking_id: '55', note: 'moved' });

    expect(result.content[0].text).toContain('project capacity booking');
    expect(result.content[0].text).toContain('Ada Lovelace (ID 7)');
    expect(client.updateBooking).not.toHaveBeenCalled();
  });

  it('marks an absence as such in the preview', async () => {
    const client = mockClient({
      getBooking: vi.fn().mockResolvedValue(single(absenceBooking('56'))),
    });

    const result = await updateBookingTool(client, { booking_id: '56', note: 'moved' });

    expect(result.content[0].text).toContain('ABSENCE');
    expect(client.updateBooking).not.toHaveBeenCalled();
  });

  it('refuses a percentage on an absence, the way create_absence does', async () => {
    const client = mockClient({
      getBooking: vi.fn().mockResolvedValue(single(absenceBooking('56'))),
    });

    const error = await caught(
      updateBookingTool(client, { booking_id: '56', percentage: 50, confirm: true }),
    );

    expect(error.code).toBe(ErrorCode.InvalidParams);
    expect(error.message).toContain(
      'booking_method_id must be 1 (hours per day) or 3 (total hours) for absences',
    );
    expect(error.message).toContain('hours_per_day');
    expect(client.updateBooking).not.toHaveBeenCalled();
  });

  it('refuses it in the preview path too, before anything is shown', async () => {
    const client = mockClient({
      getBooking: vi.fn().mockResolvedValue(single(absenceBooking('56'))),
    });

    const error = await caught(updateBookingTool(client, { booking_id: '56', percentage: 50 }));

    expect(error.code).toBe(ErrorCode.InvalidParams);
    expect(client.updateBooking).not.toHaveBeenCalled();
  });
});

describe('listBookingsTool', () => {
  const mixed = { data: [projectBooking('1'), absenceBooking('2')] };

  it('hides absences unless include_absences is set', async () => {
    const client = mockClient({ listBookings: vi.fn().mockResolvedValue(mixed) });

    const result = await listBookingsTool(client, {}, {});

    expect(result.content[0].text).toContain('1 booking found');
    expect(result.content[0].text).not.toContain('Absence:');
  });

  it('includes them once asked for', async () => {
    const client = mockClient({ listBookings: vi.fn().mockResolvedValue(mixed) });

    const result = await listBookingsTool(client, { include_absences: true }, {});

    expect(result.content[0].text).toContain('2 bookings found');
    expect(result.content[0].text).toContain('Absence:');
  });

  // A whole page, not a multiple of `limit`: a date range can hold nothing but
  // absences for far more than three rows -- a full year in the test org holds
  // 25 bookings and every one of them is an absence -- and a short over-fetch
  // then reports "no project bookings" for a window that has plenty below the
  // cut. It is one request either way.
  it('asks for a whole page so absences cannot crowd the project bookings out', async () => {
    const client = mockClient({ listBookings: vi.fn().mockResolvedValue(mixed) });

    await listBookingsTool(client, { limit: 3 }, {});

    expect(client.listBookings).toHaveBeenCalledWith(
      expect.objectContaining({ project_id: undefined, limit: MAX_PAGE_SIZE }),
    );
  });

  it('passes project_id through and skips the over-fetch, since absences have no project', async () => {
    const client = mockClient({ listBookings: vi.fn().mockResolvedValue(mixed) });

    await listBookingsTool(client, { project_id: '633049' }, {});

    expect(client.listBookings).toHaveBeenCalledWith(
      expect.objectContaining({ project_id: '633049', limit: 50 }),
    );
  });
});

describe('delete_booking', () => {
  // The one call in this set that cannot be undone, and a booking id says
  // nothing about whose entry it is -- so the preview has to.
  it('names person, kind and period before deleting anything', async () => {
    const client = mockClient();

    const result = await deleteBookingTool(client, { booking_id: '55' });

    expect(client.deleteBooking).not.toHaveBeenCalled();
    expect(result.content[0].text).toContain('project capacity booking');
    expect(result.content[0].text).toContain('Ada Lovelace');
    expect(result.content[0].text).toContain('2026-03-02');
    expect(result.content[0].text).toMatch(/no undo/i);
  });

  it('calls out an absence as such, so a mistyped id is visible', async () => {
    const client = mockClient({
      getBooking: vi.fn().mockResolvedValue(single(absenceBooking('77'))),
    });

    const result = await deleteBookingTool(client, { booking_id: '77' });

    expect(result.content[0].text).toContain('ABSENCE');
  });

  it('deletes once confirmed and says what went', async () => {
    const client = mockClient();

    const result = await deleteBookingTool(client, { booking_id: '55', confirm: true });

    expect(client.deleteBooking).toHaveBeenCalledWith('55');
    expect(result.content[0].text).toContain('has been deleted');
  });

  it('reports a missing booking as a caller error, not an internal one', async () => {
    const client = mockClient({
      getBooking: vi
        .fn()
        .mockRejectedValue(new ProductiveApiError('The requested record was not found', 404)),
    });

    const error = await caught(deleteBookingTool(client, { booking_id: '999', confirm: true }));

    expect(error).toBeInstanceOf(McpError);
    expect(error.code).toBe(ErrorCode.InvalidParams);
    expect(client.deleteBooking).not.toHaveBeenCalled();
  });
});
