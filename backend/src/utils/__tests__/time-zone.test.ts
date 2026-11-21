import { describe, expect, test } from 'bun:test';
import { calendarDayIn, zonedDayWindow, zonedMidnight } from '../time-zone';

describe('zonedMidnight', () => {
  test('an ordinary day starts at local midnight', () => {
    expect(zonedMidnight(2025, 0, 15, 'Pacific/Auckland').toISOString()).toBe(
      '2025-01-14T11:00:00.000Z'
    );
    expect(zonedMidnight(2025, 0, 15, 'Pacific/Honolulu').toISOString()).toBe(
      '2025-01-15T10:00:00.000Z'
    );
  });

  test('a day whose DST change skips midnight starts at the first instant after the jump', () => {
    const santiago = zonedMidnight(2025, 8, 7, 'America/Santiago');
    expect(santiago.toISOString()).toBe('2025-09-07T04:00:00.000Z');
    expect(calendarDayIn(santiago, 'America/Santiago')).toBe('2025-09-07');

    const havana = zonedMidnight(2025, 2, 9, 'America/Havana');
    expect(havana.toISOString()).toBe('2025-03-09T05:00:00.000Z');
    expect(calendarDayIn(havana, 'America/Havana')).toBe('2025-03-09');
  });

  test('a day whose DST change repeats the hour before midnight still starts at midnight', () => {
    expect(zonedMidnight(2025, 3, 6, 'America/Santiago').toISOString()).toBe(
      '2025-04-06T04:00:00.000Z'
    );
  });

  test('the day before a skipped midnight keeps its last hour', () => {
    const { dayStart, nextDay } = zonedDayWindow(
      new Date('2025-09-07T03:30:00Z'),
      'America/Santiago'
    );
    expect(calendarDayIn(new Date('2025-09-07T03:30:00Z'), 'America/Santiago')).toBe('2025-09-06');
    expect(dayStart.toISOString()).toBe('2025-09-06T04:00:00.000Z');
    expect(nextDay.toISOString()).toBe('2025-09-07T04:00:00.000Z');
  });
});
