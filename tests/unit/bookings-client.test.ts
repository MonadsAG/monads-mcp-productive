import { describe, it, expect } from 'vitest';
import type { ProductiveBooking, ProductiveEvent } from '../../src/api/types.js';
import {
  BOOKING_METHOD,
  buildBookingQuery,
  buildQuantity,
  countWorkingDays,
  defaultBookingMethod,
  describeApprovalState,
  formatMinutes,
  isAbsenceBooking,
  isCapacityBooking,
  resolveAbsenceType,
} from '../../src/api/bookings-client.js';

function event(
  id: string,
  name: string,
  extra: Partial<ProductiveEvent['attributes']> = {},
): ProductiveEvent {
  return { id, type: 'events', attributes: { name, ...extra } };
}

function booking(
  attributes: Partial<ProductiveBooking['attributes']> = {},
  relationships: ProductiveBooking['relationships'] = {},
): ProductiveBooking {
  return {
    id: '1',
    type: 'bookings',
    attributes: { started_on: '2026-03-02', ended_on: '2026-03-06', ...attributes },
    relationships,
  };
}

describe('buildBookingQuery', () => {
  it('always sideloads the relationships needed to classify a booking', () => {
    expect(buildBookingQuery()).toContain('include=person%2Cevent%2Cservice');
  });

  it('maps approval status names onto the numeric filter the API expects', () => {
    expect(buildBookingQuery({ approval_status: 'pending' })).toContain(
      'filter%5Bapproval_status%5D=2',
    );
    expect(buildBookingQuery({ approval_status: 'canceled' })).toContain(
      'filter%5Bapproval_status%5D=5',
    );
  });

  it('passes date, person and paging filters through', () => {
    const q = buildBookingQuery({
      after: '2026-01-01',
      before: '2026-12-31',
      person_id: '42',
      limit: 25,
      page: 2,
    });

    expect(q).toContain('filter%5Bafter%5D=2026-01-01');
    expect(q).toContain('filter%5Bbefore%5D=2026-12-31');
    expect(q).toContain('filter%5Bperson_id%5D=42');
    expect(q).toContain('page%5Bsize%5D=25');
    expect(q).toContain('page%5Bnumber%5D=2');
  });

  it('omits boolean filters unless explicitly enabled', () => {
    const q = buildBookingQuery({ with_draft: false, canceled: false });
    expect(q).not.toContain('with_draft');
    expect(q).not.toContain('canceled');
  });
});

describe('booking classification', () => {
  it('treats a booking with an event as an absence', () => {
    const b = booking({}, { event: { data: { id: '5', type: 'events' } } });
    expect(isAbsenceBooking(b)).toBe(true);
    expect(isCapacityBooking(b)).toBe(false);
  });

  it('treats a booking with a service as project capacity', () => {
    const b = booking({}, { service: { data: { id: '7', type: 'services' } } });
    expect(isCapacityBooking(b)).toBe(true);
    expect(isAbsenceBooking(b)).toBe(false);
  });

  it('does not mistake an explicitly null relationship for a set one', () => {
    const b = booking({}, { event: { data: null }, service: { data: null } });
    expect(isAbsenceBooking(b)).toBe(false);
    expect(isCapacityBooking(b)).toBe(false);
  });
});

describe('defaultBookingMethod', () => {
  it('uses hours-per-day for types that allow half days', () => {
    expect(defaultBookingMethod(event('1', 'X', { half_day_bookings: true }))).toBe(
      BOOKING_METHOD.HOURS_PER_DAY,
    );
  });

  it('uses total-hours for types that do not', () => {
    expect(defaultBookingMethod(event('1', 'X', { half_day_bookings: false }))).toBe(
      BOOKING_METHOD.TOTAL_HOURS,
    );
  });
});

describe('buildQuantity', () => {
  it('sends hours and minutes for method 1', () => {
    expect(buildQuantity(BOOKING_METHOD.HOURS_PER_DAY, { hoursPerDay: 8 })).toEqual({
      hours: 8,
      time: 480,
    });
  });

  it('sends only the percentage for method 2', () => {
    expect(buildQuantity(BOOKING_METHOD.PERCENTAGE, { percentage: 50 })).toEqual({
      percentage: 50,
    });
  });

  it('totals hours across the working days for method 3', () => {
    expect(buildQuantity(BOOKING_METHOD.TOTAL_HOURS, { hoursPerDay: 8, workingDays: 3 })).toEqual({
      total_time: 1440,
    });
  });

  it('rejects a percentage booking with no percentage', () => {
    expect(() => buildQuantity(BOOKING_METHOD.PERCENTAGE, {})).toThrow(/percentage/i);
  });

  it('rejects an hours-based booking with no hours', () => {
    expect(() => buildQuantity(BOOKING_METHOD.HOURS_PER_DAY, {})).toThrow(/hours_per_day/i);
  });
});

describe('countWorkingDays', () => {
  it('counts an inclusive Monday-to-Friday range as five days', () => {
    expect(countWorkingDays('2026-03-02', '2026-03-06')).toBe(5);
  });

  it('skips the weekend in a range that spans one', () => {
    expect(countWorkingDays('2026-03-02', '2026-03-09')).toBe(6);
  });

  it('counts a single weekday as one day', () => {
    expect(countWorkingDays('2026-03-03', '2026-03-03')).toBe(1);
  });

  it('returns zero for a weekend-only range', () => {
    expect(countWorkingDays('2026-03-07', '2026-03-08')).toBe(0);
  });

  it('returns zero when the range is inverted or invalid', () => {
    expect(countWorkingDays('2026-03-06', '2026-03-02')).toBe(0);
    expect(countWorkingDays('not-a-date', '2026-03-02')).toBe(0);
  });
});

describe('describeApprovalState', () => {
  it('reports approved bookings as approved', () => {
    expect(describeApprovalState(booking({ approved: true }))).toBe('Approved');
  });

  it('includes the reason when a booking was rejected', () => {
    expect(describeApprovalState(booking({ rejected: true, rejected_reason: 'too busy' }))).toBe(
      'Rejected (too busy)',
    );
  });

  it('reports cancellation ahead of any other state', () => {
    expect(describeApprovalState(booking({ canceled: true, approved: true }))).toBe('Canceled');
  });

  it('counts outstanding approvers when the booking is still pending', () => {
    const b = booking(
      { approved: false },
      { approval_statuses: { data: [{ id: '1', type: 'approval_statuses' }] } },
    );
    expect(describeApprovalState(b)).toBe('Pending approval (1 approver(s))');
  });
});

describe('resolveAbsenceType', () => {
  const events = [
    event('1', 'Vacation'),
    event('2', 'Sick Leave'),
    event('3', 'Unpaid leave'),
    event('4', 'Old Vacation', { archived_at: '2024-01-01' }),
  ];

  it('matches case-insensitively on the exact name', () => {
    expect(resolveAbsenceType(events, 'vacation')?.id).toBe('1');
  });

  it('accepts an unambiguous partial match', () => {
    expect(resolveAbsenceType(events, 'sick')?.id).toBe('2');
  });

  it('ignores archived types so they cannot be booked by accident', () => {
    expect(resolveAbsenceType(events, 'Old Vacation')).toBeNull();
  });

  it('returns null for something that does not exist', () => {
    expect(resolveAbsenceType(events, 'Sabbatical')).toBeNull();
  });

  it('refuses to guess when several types match', () => {
    expect(() => resolveAbsenceType(events, 'leave')).toThrow(/matches several/i);
  });
});

describe('formatMinutes', () => {
  it.each([
    [480, '8h'],
    [450, '7h 30m'],
    [45, '45m'],
    [0, '0m'],
  ])('renders %i minutes as %s', (minutes, expected) => {
    expect(formatMinutes(minutes)).toBe(expected);
  });
});
