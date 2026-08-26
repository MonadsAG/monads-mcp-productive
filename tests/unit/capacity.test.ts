import { describe, it, expect } from 'vitest';
import type { ProductiveBooking } from '../../src/api/types.js';
import {
  parseAvailabilities,
  sliceForDate,
  weeklyHours,
  hoursOnDate,
  contractedMinutes,
  bookedMinutes,
  overlapRange,
  summariseCapacity,
} from '../../src/api/capacity.js';

/** Two-week rotation: `hours` on weekdays, 0 at weekends. */
function pattern(hours: number): number[] {
  return [hours, hours, hours, hours, hours, 0, 0, hours, hours, hours, hours, hours, 0, 0];
}

function booking(
  overrides: Partial<ProductiveBooking['attributes']>,
  absence = false,
): ProductiveBooking {
  return {
    id: '1',
    type: 'bookings',
    attributes: {
      started_on: '2026-03-02',
      ended_on: '2026-03-06',
      ...overrides,
    },
    relationships: absence
      ? { event: { data: { id: '99', type: 'events' } }, service: { data: null } }
      : { service: { data: { id: '77', type: 'services' } }, event: { data: null } },
  };
}

describe('parseAvailabilities', () => {
  it('parses the JSON-string shape the API returns', () => {
    const raw = JSON.stringify([['2024-01-17', null, pattern(8), 44853]]);
    const slices = parseAvailabilities(raw);

    expect(slices).toHaveLength(1);
    expect(slices[0].from).toBe('2024-01-17');
    expect(slices[0].to).toBeNull();
    expect(slices[0].pattern).toHaveLength(14);
  });

  it.each([undefined, null, '', 'not json', '{"a":1}', 42])(
    'returns [] for unusable input %j',
    (raw) => {
      expect(parseAvailabilities(raw)).toEqual([]);
    },
  );

  it('skips malformed slices instead of throwing', () => {
    const raw = JSON.stringify([
      ['2024-01-01', null, 'nope', 1],
      ['2024-02-01', null, pattern(8), 1],
    ]);
    expect(parseAvailabilities(raw)).toHaveLength(1);
  });
});

describe('sliceForDate', () => {
  const slices = parseAvailabilities(
    JSON.stringify([
      ['2024-01-01', '2025-12-31', pattern(8), 1],
      ['2026-01-01', null, pattern(6.4), 1],
    ]),
  );

  it('picks the slice covering the date, not the first or last one', () => {
    expect(sliceForDate(slices, '2025-06-01')?.pattern[0]).toBe(8);
    expect(sliceForDate(slices, '2026-06-01')?.pattern[0]).toBe(6.4);
  });

  it('returns null when no slice covers the date', () => {
    expect(sliceForDate(slices, '2023-01-01')).toBeNull();
  });
});

describe('weeklyHours / hoursOnDate', () => {
  it('halves the two-week pattern into a weekly figure', () => {
    expect(weeklyHours({ from: 'x', to: null, pattern: pattern(8) })).toBe(40);
    expect(weeklyHours({ from: 'x', to: null, pattern: pattern(6.4) })).toBeCloseTo(32);
  });

  it('reads hours from the matching weekday, not an average', () => {
    // Four eight-hour days: Mon-Thu worked, Fri off.
    const compressed = { from: 'x', to: null, pattern: [8, 8, 8, 8, 0, 0, 0, 8, 8, 8, 8, 0, 0, 0] };
    expect(hoursOnDate(compressed, '2026-03-02')).toBe(8); // Monday
    expect(hoursOnDate(compressed, '2026-03-06')).toBe(0); // Friday -- not worked
    expect(hoursOnDate(compressed, '2026-03-07')).toBe(0); // Saturday
  });

  it('reports zero for an empty pattern rather than dividing by zero', () => {
    expect(hoursOnDate({ from: 'x', to: null, pattern: new Array(14).fill(0) }, '2026-03-02')).toBe(
      0,
    );
  });
});

describe('contractedMinutes', () => {
  const fullTime = parseAvailabilities(JSON.stringify([['2024-01-01', null, pattern(8), 1]]));

  it('counts working days only, skipping the weekend', () => {
    // Mon 2026-03-02 .. Fri 2026-03-06 = 5 working days
    expect(contractedMinutes(fullTime, '2026-03-02', '2026-03-06')).toBe(5 * 8 * 60);
  });

  it('excludes weekend days from a range that spans one', () => {
    // Mon .. following Mon = 6 working days
    expect(contractedMinutes(fullTime, '2026-03-02', '2026-03-09')).toBe(6 * 8 * 60);
  });

  it('returns null when the person has no pattern at all', () => {
    expect(contractedMinutes([], '2026-03-02', '2026-03-06')).toBeNull();
  });

  it('scales with a part-time pattern', () => {
    const partTime = parseAvailabilities(JSON.stringify([['2024-01-01', null, pattern(4), 1]]));
    expect(contractedMinutes(partTime, '2026-03-02', '2026-03-06')).toBe(5 * 4 * 60);
  });

  it('respects which weekdays are worked, not just how many hours', () => {
    // 8h Mon-Thu = 32h/week. Averaging the worked days would wrongly give 40h.
    const fourDay = parseAvailabilities(
      JSON.stringify([['2024-01-01', null, [8, 8, 8, 8, 0, 0, 0, 8, 8, 8, 8, 0, 0, 0], 1]]),
    );
    expect(contractedMinutes(fourDay, '2026-03-02', '2026-03-06')).toBe(32 * 60);
  });

  it('picks up a mid-range contract change day by day', () => {
    const changing = parseAvailabilities(
      JSON.stringify([
        ['2024-01-01', '2026-03-03', pattern(8), 1],
        ['2026-03-04', null, pattern(4), 1],
      ]),
    );
    // Mon+Tue at 8h, Wed-Fri at 4h
    expect(contractedMinutes(changing, '2026-03-02', '2026-03-06')).toBe((2 * 8 + 3 * 4) * 60);
  });
});

describe('overlapRange', () => {
  it('clips a booking to the queried window', () => {
    const b = booking({ started_on: '2026-02-01', ended_on: '2026-12-31' });
    expect(overlapRange(b, '2026-03-02', '2026-03-06')).toEqual({
      from: '2026-03-02',
      to: '2026-03-06',
    });
  });

  it('returns null when the booking lies outside the window', () => {
    const b = booking({ started_on: '2026-01-01', ended_on: '2026-01-31' });
    expect(overlapRange(b, '2026-03-02', '2026-03-06')).toBeNull();
  });
});

describe('bookedMinutes', () => {
  const full = parseAvailabilities(JSON.stringify([['2024-01-01', null, pattern(8), 1]]));
  const from = '2026-03-02';
  const to = '2026-03-06';

  it('prorates a long booking onto the queried window', () => {
    // 10 working days total, of which 5 fall in the window -> half the minutes.
    const b = booking({
      started_on: '2026-03-02',
      ended_on: '2026-03-13',
      total_time: 4800,
      total_working_days: 10,
    });
    expect(bookedMinutes(b, full, from, to)).toBe(2400);
  });

  it('counts nothing for a booking outside the window', () => {
    const b = booking({ started_on: '2026-01-05', ended_on: '2026-01-09', total_time: 2400 });
    expect(bookedMinutes(b, full, from, to)).toBe(0);
  });

  it('multiplies per-day minutes by the working days inside the window', () => {
    const b = booking({ started_on: '2026-03-02', ended_on: '2026-03-13', time: 480 });
    expect(bookedMinutes(b, full, from, to)).toBe(5 * 480);
  });

  it('scales a percentage against contracted time in the window', () => {
    const b = booking({ started_on: '2026-01-01', ended_on: '2026-12-31', percentage: 50 });
    expect(bookedMinutes(b, full, from, to)).toBe(1200);
  });

  it('cannot resolve a percentage without a working pattern', () => {
    const b = booking({ percentage: 50 });
    expect(bookedMinutes(b, [], from, to)).toBe(0);
  });
});

describe('summariseCapacity', () => {
  const availabilities = parseAvailabilities(JSON.stringify([['2024-01-01', null, pattern(8), 1]]));
  const from = '2026-03-02';
  const to = '2026-03-06'; // 5 working days -> 2400 contracted minutes

  it('splits project load from absence and reports what is left', () => {
    const summary = summariseCapacity(
      [
        booking({ total_time: 960 }), // project
        booking({ total_time: 480 }, true), // absence
      ],
      availabilities,
      from,
      to,
    );

    expect(summary.contractedMinutes).toBe(2400);
    expect(summary.projectMinutes).toBe(960);
    expect(summary.absenceMinutes).toBe(480);
    expect(summary.plannedMinutes).toBe(1440);
    expect(summary.freeMinutes).toBe(2400 - 960 - 480);
    expect(summary.utilisationPercent).toBe(40);
    expect(summary.plannedPercent).toBe(60);
    expect(summary.overbooked).toBe(false);
  });

  it('flags overbooking once bookings exceed contracted time', () => {
    const summary = summariseCapacity(
      [booking({ total_time: 2000 }), booking({ total_time: 1000 })],
      availabilities,
      from,
      to,
    );

    expect(summary.freeMinutes).toBeLessThan(0);
    expect(summary.overbooked).toBe(true);
  });

  it('reports the claimed share separately so absence-only overbooking is not shown as 0%', () => {
    // Nothing booked on projects, but absence exceeds contracted time.
    const summary = summariseCapacity(
      [booking({ total_time: 3000 }, true)],
      availabilities,
      from,
      to,
    );

    expect(summary.utilisationPercent).toBe(0);
    expect(summary.plannedPercent).toBe(125);
    expect(summary.overbooked).toBe(true);
  });

  it('ignores canceled and rejected bookings alike', () => {
    const summary = summariseCapacity(
      [booking({ total_time: 960, canceled: true }), booking({ total_time: 960, rejected: true })],
      availabilities,
      from,
      to,
    );

    expect(summary.projectMinutes).toBe(0);
  });

  it('does not let a long booking blow up a short query window', () => {
    // Six months at 100% must not read as thousands of percent for one week.
    const summary = summariseCapacity(
      [booking({ started_on: '2026-01-01', ended_on: '2026-06-30', percentage: 100 })],
      availabilities,
      from,
      to,
    );

    expect(summary.projectMinutes).toBe(2400);
    expect(summary.utilisationPercent).toBe(100);
    expect(summary.overbooked).toBe(false);
  });

  it('still totals bookings when the contracted pattern is unknown', () => {
    const summary = summariseCapacity([booking({ total_time: 960 })], [], from, to);

    expect(summary.contractedMinutes).toBeNull();
    expect(summary.projectMinutes).toBe(960);
    expect(summary.freeMinutes).toBeNull();
    expect(summary.utilisationPercent).toBeNull();
    expect(summary.plannedPercent).toBeNull();
    expect(summary.overbooked).toBe(false);
  });
});
