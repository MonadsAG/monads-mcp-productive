import { describe, it, expect } from 'vitest';
import type { ProductiveBooking } from '../../src/api/types.js';
import {
  parseAvailabilities,
  hasUnreadableAvailabilities,
  sliceForDate,
  weeklyHours,
  hoursOnDate,
  contractedMinutes,
  bookedMinutes,
  overlapRange,
  summariseCapacity,
  workingDaysInRange,
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

  // The live API sends a JSON string, but the official spec's own example
  // (docs/api-spec/resources/people.yaml) shows a bare nested array. Reading
  // only one of the two would report "no working pattern" for every person if
  // the response ever took the documented shape.
  it('accepts the bare array shape the spec documents', () => {
    const slices = parseAvailabilities([pattern(8)]);

    expect(slices).toHaveLength(1);
    expect(slices[0].pattern).toHaveLength(14);
    expect(slices[0].to).toBeNull();
  });

  it('accepts an already-decoded array of time-sliced entries', () => {
    expect(parseAvailabilities([['2024-01-17', null, pattern(8), 1]])).toHaveLength(1);
  });

  it('rejects a bare pattern too short to cover a week', () => {
    expect(parseAvailabilities([[8, 0, 0, 0, 0]])).toEqual([]);
  });

  // Same floor on the time-sliced shape. Without it the slice survives,
  // hoursOnDate returns 0 for every weekday, and the person is reported with a
  // contracted 0m and an OVERBOOKED flag instead of "pattern not readable".
  it('rejects a time-sliced pattern too short to cover a week', () => {
    const raw = JSON.stringify([['2024-01-01', null, [8, 8], 1]]);

    expect(parseAvailabilities(raw)).toEqual([]);
    expect(hasUnreadableAvailabilities(raw)).toBe(true);
  });
});

describe('hasUnreadableAvailabilities', () => {
  // "Nothing on file" and "something on file that this code cannot read" need
  // different answers -- reporting the second as the first hides a bug behind a
  // plausible-looking result.
  it.each([undefined, null, '', '   ', '[]', []])('reports %j as simply not set', (raw) => {
    expect(hasUnreadableAvailabilities(raw)).toBe(false);
  });

  it.each(['not json', '{"a":1}', '[[8,0,0,0,0]]'])('flags %j as unreadable', (raw) => {
    expect(hasUnreadableAvailabilities(raw)).toBe(true);
  });

  it('says nothing is wrong with a pattern it can read', () => {
    expect(hasUnreadableAvailabilities(JSON.stringify([['2024-01-01', null, pattern(8), 1]]))).toBe(
      false,
    );
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

  // Numerator and denominator have to be counted the same way. Taking the days
  // inside the window from the person's pattern but the booking's own length
  // from the API's total_working_days mixes two calendars: whenever they
  // disagree -- a public holiday inside the booking, say -- a booking lying
  // entirely inside the window stops adding up to its own total_time.
  it('counts a booking that lies fully inside the window at its full length', () => {
    const b = booking({
      started_on: '2026-03-02',
      ended_on: '2026-03-06',
      total_time: 1920,
      total_working_days: 4, // e.g. the API subtracted a public holiday
    });
    expect(bookedMinutes(b, full, from, to)).toBe(1920);
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

  // Remote work is the same `bookings` resource as time off, told apart only by
  // the event's absence_type. Subtracting it would report a fully staffed week
  // -- everyone at their desk, just at home -- as booked solid.
  it('counts remote work separately and does not subtract it', () => {
    const summary = summariseCapacity(
      [booking({ total_time: 960 }), booking({ total_time: 480 }, true)],
      availabilities,
      from,
      to,
      new Set(['99']), // the event id the absence fixture uses
    );

    expect(summary.remoteMinutes).toBe(480);
    expect(summary.absenceMinutes).toBe(0);
    expect(summary.plannedMinutes).toBe(960);
    expect(summary.freeMinutes).toBe(2400 - 960);
    expect(summary.overbooked).toBe(false);
  });

  it('treats an event that is not known to be remote as an absence', () => {
    const summary = summariseCapacity(
      [booking({ total_time: 480 }, true)],
      availabilities,
      from,
      to,
      new Set(['other']),
    );

    expect(summary.absenceMinutes).toBe(480);
    expect(summary.remoteMinutes).toBe(0);
  });

  it('keeps the old behaviour when no remote event ids are passed at all', () => {
    const summary = summariseCapacity(
      [booking({ total_time: 480 }, true)],
      availabilities,
      from,
      to,
    );

    expect(summary.absenceMinutes).toBe(480);
    expect(summary.remoteMinutes).toBe(0);
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

describe('workingDaysInRange', () => {
  /** Mon-Thu 8h, Friday off: a 32h contract, Monday first, two-week rotation. */
  const fourDayWeek = parseAvailabilities(
    JSON.stringify([['2020-01-01', null, [8, 8, 8, 8, 0, 0, 0, 8, 8, 8, 8, 0, 0, 0], 1]]),
  );

  it("counts the person's own working days, not the calendar's", () => {
    // 2026-03-02..06 is Mon-Fri. Counting five would charge a Mon-Thu contract
    // for a day it does not work -- a plain week of leave booked as 40h against
    // 32h contracted, then reported back as overbooked.
    expect(workingDaysInRange(fourDayWeek, '2026-03-02', '2026-03-06')).toBe(4);
  });

  it('falls back to calendar weekdays when no pattern is on file', () => {
    expect(workingDaysInRange([], '2026-03-02', '2026-03-06')).toBe(5);
  });

  it('falls back rather than returning zero for a day the person never works', () => {
    // Friday alone: no contracted day, but the range is still a working day for
    // sizing purposes -- returning 0 would make the booking unwritable.
    expect(workingDaysInRange(fourDayWeek, '2026-03-06', '2026-03-06')).toBe(1);
  });

  it('returns zero for a weekend-only range', () => {
    expect(workingDaysInRange(fourDayWeek, '2026-03-07', '2026-03-08')).toBe(0);
  });

  it('sizes a part-time absence so it does not read as overbooked', () => {
    const from = '2026-03-02';
    const to = '2026-03-06';
    const days = workingDaysInRange(fourDayWeek, from, to);
    const contracted = contractedMinutes(fourDayWeek, from, to);
    const hoursPerDay = contracted! / days / 60;

    // What create_absence writes for a full week of leave.
    const totalTime = Math.round(hoursPerDay * 60 * days);
    expect(totalTime).toBe(1920); // 32h, not 40h

    const summary = summariseCapacity(
      [
        {
          id: 'a',
          type: 'bookings',
          relationships: { event: { data: { id: '1', type: 'events' } } },
          attributes: {
            started_on: from,
            ended_on: to,
            booking_method_id: 3,
            total_time: totalTime,
            total_working_days: days,
          },
        } as ProductiveBooking,
      ],
      fourDayWeek,
      from,
      to,
    );

    expect(summary.plannedPercent).toBe(100);
    expect(summary.overbooked).toBe(false);
  });
});
