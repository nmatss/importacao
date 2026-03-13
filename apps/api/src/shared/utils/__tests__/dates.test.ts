import { describe, it, expect } from 'vitest';
import { formatDate, addDays, daysBetween, isDeadlineCritical, calculateLiDeadline } from '../dates.js';

describe('formatDate', () => {
  it('should format a Date object to YYYY-MM-DD', () => {
    const date = new Date(2025, 0, 15); // Jan 15, 2025
    expect(formatDate(date)).toBe('2025-01-15');
  });

  it('should format a date string to YYYY-MM-DD', () => {
    expect(formatDate('2025-06-05T12:00:00Z')).toBe('2025-06-05');
  });

  it('should pad single-digit months and days', () => {
    const date = new Date(2025, 2, 5); // Mar 5, 2025
    expect(formatDate(date)).toBe('2025-03-05');
  });
});

describe('addDays', () => {
  it('should add days to a date', () => {
    const date = new Date(2025, 0, 1);
    const result = addDays(date, 10);
    expect(result.getDate()).toBe(11);
    expect(result.getMonth()).toBe(0);
  });

  it('should handle month rollover', () => {
    const date = new Date(2025, 0, 28);
    const result = addDays(date, 5);
    expect(result.getMonth()).toBe(1); // February
    expect(result.getDate()).toBe(2);
  });

  it('should handle negative days', () => {
    const date = new Date(2025, 0, 15);
    const result = addDays(date, -5);
    expect(result.getDate()).toBe(10);
  });

  it('should not mutate the original date', () => {
    const date = new Date(2025, 0, 1);
    addDays(date, 10);
    expect(date.getDate()).toBe(1);
  });
});

describe('daysBetween', () => {
  it('should calculate days between two dates', () => {
    const d1 = new Date(2025, 0, 1);
    const d2 = new Date(2025, 0, 11);
    expect(daysBetween(d1, d2)).toBe(10);
  });

  it('should return absolute difference regardless of order', () => {
    const d1 = new Date(2025, 0, 11);
    const d2 = new Date(2025, 0, 1);
    expect(daysBetween(d1, d2)).toBe(10);
  });

  it('should return 0 for same date', () => {
    const d = new Date(2025, 5, 15);
    expect(daysBetween(d, d)).toBe(0);
  });
});

describe('isDeadlineCritical', () => {
  it('should return true when deadline is within warning days', () => {
    const now = new Date();
    const deadline = addDays(now, 2);
    expect(isDeadlineCritical(deadline, 3)).toBe(true);
  });

  it('should return false when deadline is far away', () => {
    const now = new Date();
    const deadline = addDays(now, 30);
    expect(isDeadlineCritical(deadline, 3)).toBe(false);
  });

  it('should return false when deadline is in the past', () => {
    const now = new Date();
    const deadline = addDays(now, -5);
    expect(isDeadlineCritical(deadline, 3)).toBe(false);
  });

  it('should use default warning days of 3', () => {
    const now = new Date();
    const deadline = addDays(now, 2);
    expect(isDeadlineCritical(deadline)).toBe(true);
  });
});

describe('calculateLiDeadline', () => {
  it('should return date 13 days after shipment', () => {
    const shipment = new Date(2025, 0, 1);
    const deadline = calculateLiDeadline(shipment);
    expect(deadline.getDate()).toBe(14);
    expect(deadline.getMonth()).toBe(0);
  });
});
