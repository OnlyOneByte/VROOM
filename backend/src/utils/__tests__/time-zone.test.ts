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

  test('a half-hour DST change that skips midnight starts the day at the transition', () => {
    for (const zone of ['America/Toronto', 'America/Nassau']) {
      const start = zonedMidnight(1919, 2, 31, zone);
      expect(start.toISOString()).toBe('1919-03-31T04:30:00.000Z');
      expect(calendarDayIn(start, zone)).toBe('1919-03-31');
      expect(calendarDayIn(new Date(start.getTime() - 1000), zone)).toBe('1919-03-30');
    }
  });

  test('a day whose DST change repeats the hour before midnight still starts at midnight', () => {
    expect(zonedMidnight(2025, 3, 6, 'America/Santiago').toISOString()).toBe(
      '2025-04-06T04:00:00.000Z'
    );
  });

  test('a day whose DST change repeats midnight starts at the first midnight', () => {
    expect(zonedMidnight(1976, 8, 26, 'Europe/Lisbon').toISOString()).toBe(
      '1976-09-25T23:00:00.000Z'
    );
    expect(zonedMidnight(1995, 8, 15, 'Asia/Amman').toISOString()).toBe('1995-09-14T21:00:00.000Z');
  });

  test('the day before a repeated midnight ends at the first midnight', () => {
    const { dayStart, nextDay } = zonedDayWindow(new Date('1976-09-25T12:00:00Z'), 'Europe/Lisbon');
    expect(dayStart.toISOString()).toBe('1976-09-24T23:00:00.000Z');
    expect(nextDay.toISOString()).toBe('1976-09-25T23:00:00.000Z');
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

  test('a skipped day in a zone whose old offset was beyond 15 hours starts where the next day does', () => {
    expect(zonedMidnight(1844, 11, 31, 'Asia/Manila').toISOString()).toBe(
      '1844-12-31T15:56:00.000Z'
    );
    expect(zonedMidnight(1844, 11, 31, 'Pacific/Palau').toISOString()).toBe(
      '1844-12-31T15:02:04.000Z'
    );
  });
});
