/**
 * Date rules for date-based parking spaces.
 *
 * Every date here is a calendar day as a 'YYYY-MM-DD' string — the same form as the database `date`
 * columns and <input type="date">. They are compared as strings (ISO dates sort correctly) and never
 * parsed with `new Date('YYYY-MM-DD')`, which means UTC midnight and shifts the day in other timezones.
 * "Today" is the device's local calendar date (todayIso() in parking.service.ts), which is also the day
 * the app books reservations for, so a range and a booking day are always compared in the same terms.
 */

/** Longest allowed range, matching admin_add_dated_parking_space() in schema.sql. */
export const MAX_RANGE_DAYS = 365;

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

export interface DateRange {
  available_from: string | null;
  available_until: string | null;
}

/** Permanent spaces (no range) are open every day; date-based ones from start through end, inclusive. */
export function isAvailableOn(space: DateRange, day: string): boolean {
  if (!space.available_from || !space.available_until) return true;
  return space.available_from <= day && day <= space.available_until;
}

export function isDateBased(space: DateRange): boolean {
  return !!space.available_from;
}

/** True when two inclusive ranges share at least one day. */
export function rangesOverlap(aFrom: string, aUntil: string, bFrom: string, bUntil: string): boolean {
  return aFrom <= bUntil && bFrom <= aUntil;
}

/** Day number for a real calendar date, or null for anything else ('2026-02-30', '', 'abc'). */
function dayNumber(iso: string): number | null {
  const m = ISO_DATE.exec(iso);
  if (!m) return null;
  const [y, mo, d] = [+m[1], +m[2], +m[3]];
  const t = Date.UTC(y, mo - 1, d);
  const back = new Date(t);
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== d) return null;
  return t / 86_400_000;
}

/** Error message for an invalid range, or null when it can be saved. */
export function validateDateRange(from: string, until: string, today: string): string | null {
  if (!from || !until) return 'Choose a start date and an end date.';
  const a = dayNumber(from);
  const b = dayNumber(until);
  if (a === null || b === null) return 'Enter valid dates.';
  if (b < a) return "The end date can't be earlier than the start date.";
  if (until < today) return 'The end date is in the past.';
  if (b - a > MAX_RANGE_DAYS) return 'A date range can be at most one year long.';
  return null;
}

/** "14 – 16 Oct 2026", "30 Oct – 2 Nov 2026" or "14 Oct 2026" for a single day. */
export function formatDateRange(from: string, until: string): string {
  const a = dayNumber(from);
  const b = dayNumber(until);
  if (a === null || b === null) return `${from} – ${until}`;
  // Formatted in UTC because dayNumber() is UTC-based: the printed day is exactly the stored one.
  const fmt = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
  return a === b ? fmt.format(a * 86_400_000) : fmt.formatRange(a * 86_400_000, b * 86_400_000);
}
