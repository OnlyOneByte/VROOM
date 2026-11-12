import { describe, expect, test } from 'bun:test';
import { buildLocalDate } from '../local-date';

describe('buildLocalDate', () => {
  test('builds a valid date from in-range parts (local calendar day preserved)', () => {
    const d = buildLocalDate(2024, 3, 15);
    expect(d).not.toBeNull();
    expect(d?.getFullYear()).toBe(2024);
    expect(d?.getMonth()).toBe(2);
    expect(d?.getDate()).toBe(15);
  });

  test('defaults the time component to local midnight when omitted', () => {
    const d = buildLocalDate(2024, 6, 1);
    expect(d?.getHours()).toBe(0);
    expect(d?.getMinutes()).toBe(0);
    expect(d?.getSeconds()).toBe(0);
  });

  test('honors an explicit time component', () => {
    const d = buildLocalDate(2024, 6, 1, 13, 30, 45);
    expect(d?.getHours()).toBe(13);
    expect(d?.getMinutes()).toBe(30);
    expect(d?.getSeconds()).toBe(45);
  });

  test('rejects a month past 12 instead of rolling forward', () => {
    expect(buildLocalDate(2024, 13, 45)).toBeNull();
  });

  test('rejects an impossible day-of-month (Feb 30 → would roll into March)', () => {
    expect(buildLocalDate(2024, 2, 30)).toBeNull();
  });

  test('rejects a zero / out-of-range month', () => {
    expect(buildLocalDate(2024, 0, 15)).toBeNull();
  });

  test('accepts a real leap day but rejects the non-leap-year Feb 29', () => {
    expect(buildLocalDate(2024, 2, 29)).not.toBeNull();
    expect(buildLocalDate(2023, 2, 29)).toBeNull();
  });

  test('rejects an out-of-range hour that rolls the day forward (foreign-import time-parse path)', () => {
    expect(buildLocalDate(2024, 3, 15, 25, 0, 0)).toBeNull();
    expect(buildLocalDate(2024, 3, 15, 48, 0, 0)).toBeNull();
  });

  test('a same-day time wrap (minute 90) is accepted with the date intact (current by-design behavior)', () => {
    const d = buildLocalDate(2024, 3, 15, 12, 90, 0);
    expect(d).not.toBeNull();
    expect(d?.getDate()).toBe(15);
  });
});
