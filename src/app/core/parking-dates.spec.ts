import { describe, expect, it } from 'vitest';
import { formatDateRange, isAvailableOn, rangesOverlap, validateDateRange } from './parking-dates';
import { todayIso } from './parking.service';

const space300 = { available_from: '2026-10-14', available_until: '2026-10-16' };
const permanent = { available_from: null, available_until: null };

describe('date-based parking spaces', () => {
  it('is available on every day of the range, including both ends', () => {
    expect(isAvailableOn(space300, '2026-10-14')).toBe(true);
    expect(isAvailableOn(space300, '2026-10-15')).toBe(true);
    expect(isAvailableOn(space300, '2026-10-16')).toBe(true);
  });

  it('is not available the day before or after the range', () => {
    expect(isAvailableOn(space300, '2026-10-13')).toBe(false);
    expect(isAvailableOn(space300, '2026-10-17')).toBe(false);
    expect(isAvailableOn(space300, '2025-10-15')).toBe(false);
  });

  it('handles month and year boundaries', () => {
    const r = { available_from: '2026-12-31', available_until: '2027-01-01' };
    expect(isAvailableOn(r, '2026-12-30')).toBe(false);
    expect(isAvailableOn(r, '2026-12-31')).toBe(true);
    expect(isAvailableOn(r, '2027-01-01')).toBe(true);
    expect(isAvailableOn(r, '2027-01-02')).toBe(false);
  });

  it('keeps permanent spaces available every day', () => {
    expect(isAvailableOn(permanent, '2026-10-13')).toBe(true);
    expect(isAvailableOn(permanent, '2030-01-01')).toBe(true);
  });

  it('detects overlapping ranges, including a shared single day', () => {
    expect(rangesOverlap('2026-10-14', '2026-10-16', '2026-10-14', '2026-10-16')).toBe(true); // same range
    expect(rangesOverlap('2026-10-14', '2026-10-16', '2026-10-16', '2026-10-20')).toBe(true);
    expect(rangesOverlap('2026-10-14', '2026-10-16', '2026-10-10', '2026-10-14')).toBe(true);
    expect(rangesOverlap('2026-10-14', '2026-10-16', '2026-10-17', '2026-10-20')).toBe(false);
    expect(rangesOverlap('2026-10-14', '2026-10-16', '2026-10-01', '2026-10-13')).toBe(false);
  });
});

describe('validateDateRange', () => {
  const today = '2026-10-14';

  it('accepts a valid range and a single-day range', () => {
    expect(validateDateRange('2026-10-14', '2026-10-16', today)).toBeNull();
    expect(validateDateRange('2026-10-14', '2026-10-14', today)).toBeNull();
  });

  it('rejects an end date earlier than the start date', () => {
    expect(validateDateRange('2026-10-16', '2026-10-14', today)).toContain('earlier than the start date');
  });

  it('requires both dates and real calendar dates', () => {
    expect(validateDateRange('', '2026-10-16', today)).toContain('Choose');
    expect(validateDateRange('2026-10-14', '', today)).toContain('Choose');
    expect(validateDateRange('2026-02-30', '2026-03-01', today)).toBe('Enter valid dates.');
    expect(validateDateRange('14/10/2026', '2026-10-16', today)).toBe('Enter valid dates.');
  });

  it('rejects ranges that already ended but allows one ending today', () => {
    expect(validateDateRange('2026-10-01', '2026-10-13', today)).toContain('past');
    expect(validateDateRange('2026-10-01', '2026-10-14', today)).toBeNull();
  });

  it('limits a range to one year', () => {
    expect(validateDateRange('2026-10-14', '2027-10-14', today)).toBeNull(); // 365 days
    expect(validateDateRange('2026-10-14', '2027-10-15', today)).toContain('one year');
  });
});

describe('formatDateRange', () => {
  it('prints exactly the stored days', () => {
    // Spacing around the dash depends on the browser's ICU data.
    expect(formatDateRange('2026-10-14', '2026-10-16')).toMatch(/^14\s*–\s*16 Oct 2026$/);
    expect(formatDateRange('2026-10-14', '2026-10-14')).toBe('14 Oct 2026');
  });
});

describe('todayIso', () => {
  it('uses the local calendar date, not the UTC one', () => {
    // 23:30 local on 14 Oct is 14 Oct whatever the device timezone (it can be 15 Oct or 13 Oct in UTC).
    expect(todayIso(new Date(2026, 9, 14, 23, 30))).toBe('2026-10-14');
    expect(todayIso(new Date(2026, 9, 14, 0, 30))).toBe('2026-10-14');
  });
});
