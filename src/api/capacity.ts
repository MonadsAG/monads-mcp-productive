/**
 * Capacity arithmetic: contracted hours vs. planned bookings.
 *
 * Pure functions only -- no API calls -- so the maths can be tested directly.
 * The contracted hours come from a person's `availabilities` field, NOT from
 * entitlements (those are absence quotas). See docs/resource-management-spec.md.
 */
import type { ProductiveBooking } from './types.js';
import { isAbsenceBooking } from './bookings-client.js';

/**
 * One slice of a person's contracted working pattern.
 *
 * Raw shape in the API: `[from, to|null, number[14], calendarId]`, where the 14
 * numbers are hours per day across a two-week rotation, Monday first.
 */
export interface AvailabilitySlice {
  from: string;
  to: string | null;
  /** Hours per day over a two-week rotation (14 entries, Monday first). */
  pattern: number[];
}

/** Parse `YYYY-MM-DD` into a UTC date, or null when unusable. */
function toUtcDate(iso: string): Date | null {
  const d = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

function toIso(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Monday = 0 ... Sunday = 6, matching how the pattern array is laid out. */
function patternIndex(date: Date): number {
  return (date.getUTCDay() + 6) % 7;
}

/**
 * Parse the `availabilities` attribute, which arrives as a JSON *string*.
 *
 * Returns an empty array for missing or malformed input rather than throwing --
 * a person without a usable pattern should degrade to "unknown", not break the
 * whole overview.
 */
export function parseAvailabilities(raw: unknown): AvailabilitySlice[] {
  if (typeof raw !== 'string' || raw.trim() === '') return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  const slices: AvailabilitySlice[] = [];
  for (const entry of parsed) {
    if (!Array.isArray(entry) || entry.length < 3) continue;
    const [from, to, pattern] = entry;
    if (typeof from !== 'string' || !Array.isArray(pattern)) continue;
    if (!pattern.every((n) => typeof n === 'number')) continue;
    slices.push({ from, to: typeof to === 'string' ? to : null, pattern });
  }
  return slices;
}

/**
 * Pick the slice covering a date.
 *
 * People accumulate several slices as their contract changes over time, so
 * picking the first or last one silently produces wrong numbers for any
 * historical or future range.
 */
export function sliceForDate(
  slices: AvailabilitySlice[],
  isoDate: string,
): AvailabilitySlice | null {
  const covering = slices.filter((s) => s.from <= isoDate && (s.to === null || s.to >= isoDate));
  if (covering.length === 0) return null;
  // Latest start wins when slices overlap.
  return covering.reduce((best, s) => (s.from > best.from ? s : best));
}

/** Contracted hours per week = the two-week pattern halved. */
export function weeklyHours(slice: AvailabilitySlice): number {
  const total = slice.pattern.reduce((sum, h) => sum + h, 0);
  return slice.pattern.length >= 14 ? total / 2 : total;
}

/**
 * Contracted hours on one specific date, read from the matching weekday.
 *
 * Positions matter: a pattern of four eight-hour days is 32h/week, not 40. An
 * average across the worked days would silently inflate exactly those
 * compressed part-time contracts. Where the two weeks of the rotation differ,
 * they are averaged -- the alternation has no documented anchor date, so
 * averaging is the honest approximation.
 */
export function hoursOnDate(slice: AvailabilitySlice, isoDate: string): number {
  const date = toUtcDate(isoDate);
  if (!date) return 0;

  const index = patternIndex(date);
  const { pattern } = slice;

  if (pattern.length >= 14) return (pattern[index] + pattern[index + 7]) / 2;
  if (pattern.length >= 7) return pattern[index];
  return 0;
}

/** Walk every date in an inclusive range. */
function* datesInRange(startIso: string, endIso: string): Generator<Date> {
  const start = toUtcDate(startIso);
  const end = toUtcDate(endIso);
  if (!start || !end || end < start) return;

  for (const d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    yield new Date(d);
  }
}

/**
 * Contracted minutes across a date range.
 *
 * Evaluated day by day, so a range spanning a contract change picks up each
 * slice where it actually applies. Returns null only when no day in the range
 * is covered by any slice.
 */
export function contractedMinutes(
  slices: AvailabilitySlice[],
  startIso: string,
  endIso: string,
): number | null {
  if (slices.length === 0) return null;

  let hours = 0;
  let covered = false;

  for (const date of datesInRange(startIso, endIso)) {
    const iso = toIso(date);
    const slice = sliceForDate(slices, iso);
    if (!slice) continue;
    covered = true;
    hours += hoursOnDate(slice, iso);
  }

  return covered ? Math.round(hours * 60) : null;
}

/** The part of a booking that falls inside the queried range, or null. */
export function overlapRange(
  booking: ProductiveBooking,
  startIso: string,
  endIso: string,
): { from: string; to: string } | null {
  const from = booking.attributes.started_on > startIso ? booking.attributes.started_on : startIso;
  const to = booking.attributes.ended_on < endIso ? booking.attributes.ended_on : endIso;
  return from <= to ? { from, to } : null;
}

/** Days in a range that the person is actually contracted to work. */
function contractedDays(slices: AvailabilitySlice[], startIso: string, endIso: string): number {
  let days = 0;
  for (const date of datesInRange(startIso, endIso)) {
    const iso = toIso(date);
    const slice = sliceForDate(slices, iso);
    if (slice && hoursOnDate(slice, iso) > 0) days += 1;
  }
  return days;
}

/** Weekdays in a range, used when the person has no pattern to go by. */
function weekdaysInRange(startIso: string, endIso: string): number {
  let days = 0;
  for (const date of datesInRange(startIso, endIso)) {
    const weekday = date.getUTCDay();
    if (weekday !== 0 && weekday !== 6) days += 1;
  }
  return days;
}

/**
 * Days in a range that count as working days *for this person*.
 *
 * The person's own pattern decides; calendar Mon-Fri is only the fallback for
 * someone with no pattern on file. Sizing a booking by calendar weekdays would
 * charge a four-day contract for the fifth day -- a normal week of leave for an
 * 80% contract would be written as 40h and then reported back as overbooked.
 */
export function workingDaysInRange(
  slices: AvailabilitySlice[],
  startIso: string,
  endIso: string,
): number {
  const contracted = contractedDays(slices, startIso, endIso);
  return contracted > 0 ? contracted : weekdaysInRange(startIso, endIso);
}

/**
 * Minutes a booking contributes *within the queried range*.
 *
 * The API's date filters match on overlap, so a six-month booking comes back in
 * a one-week query. Counting its full length against one week's contracted time
 * would report absurd overbooking, so everything is prorated onto the overlap.
 */
export function bookedMinutes(
  booking: ProductiveBooking,
  slices: AvailabilitySlice[],
  startIso: string,
  endIso: string,
): number {
  const overlap = overlapRange(booking, startIso, endIso);
  if (!overlap) return 0;

  const a = booking.attributes;
  const workingDays = (from: string, to: string): number => workingDaysInRange(slices, from, to);

  const overlapDays = workingDays(overlap.from, overlap.to);
  if (overlapDays === 0) return 0;

  if (typeof a.percentage === 'number' && a.percentage > 0 && !a.total_time && !a.time) {
    const contracted = contractedMinutes(slices, overlap.from, overlap.to);
    return contracted === null ? 0 : Math.round((contracted * a.percentage) / 100);
  }

  if (typeof a.total_time === 'number' && a.total_time > 0) {
    const bookingDays = a.total_working_days ?? workingDays(a.started_on, a.ended_on);
    if (bookingDays === 0) return 0;
    return Math.round(a.total_time * (overlapDays / bookingDays));
  }

  if (typeof a.time === 'number' && a.time > 0) return a.time * overlapDays;
  if (typeof a.hours === 'number' && a.hours > 0) return Math.round(a.hours * 60) * overlapDays;

  if (typeof a.percentage === 'number' && a.percentage > 0) {
    const contracted = contractedMinutes(slices, overlap.from, overlap.to);
    return contracted === null ? 0 : Math.round((contracted * a.percentage) / 100);
  }

  return 0;
}

export interface CapacitySummary {
  /** null when the person has no usable availabilities pattern. */
  contractedMinutes: number | null;
  projectMinutes: number;
  absenceMinutes: number;
  /** Everything already claimed: project work plus absence. */
  plannedMinutes: number;
  /** Contracted minus project minus absence; null when contracted is unknown. */
  freeMinutes: number | null;
  /** Project load as a share of contracted time; null when contracted is unknown. */
  utilisationPercent: number | null;
  /**
   * Total claimed time as a share of contracted time.
   *
   * This is the figure `overbooked` refers to -- somebody on sick leave all week
   * is fully claimed at 0% project utilisation, so reporting only the project
   * share next to an overbooked flag reads as a contradiction.
   */
  plannedPercent: number | null;
  overbooked: boolean;
}

/**
 * Aggregate one person's bookings for a range into a capacity summary.
 *
 * Absences reduce available time; project bookings consume it. Overbooking is
 * reported, never blocked -- that is a warning, not a validation rule.
 */
export function summariseCapacity(
  bookings: ProductiveBooking[],
  availabilities: AvailabilitySlice[],
  startIso: string,
  endIso: string,
): CapacitySummary {
  const contracted = contractedMinutes(availabilities, startIso, endIso);

  let projectMinutes = 0;
  let absenceMinutes = 0;

  for (const booking of bookings) {
    // Cancelled and rejected bookings never consume capacity.
    if (booking.attributes.canceled || booking.attributes.rejected) continue;

    const minutes = bookedMinutes(booking, availabilities, startIso, endIso);
    if (isAbsenceBooking(booking)) absenceMinutes += minutes;
    else projectMinutes += minutes;
  }

  const plannedMinutes = projectMinutes + absenceMinutes;
  const freeMinutes = contracted === null ? null : contracted - plannedMinutes;
  const share = (part: number): number | null =>
    contracted === null || contracted === 0 ? null : Math.round((part / contracted) * 1000) / 10;

  return {
    contractedMinutes: contracted,
    projectMinutes,
    absenceMinutes,
    plannedMinutes,
    freeMinutes,
    utilisationPercent: share(projectMinutes),
    plannedPercent: share(plannedMinutes),
    overbooked: freeMinutes !== null && freeMinutes < 0,
  };
}
