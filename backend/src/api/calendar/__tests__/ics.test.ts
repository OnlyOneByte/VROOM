import { describe, expect, test } from 'bun:test';
import { paymentDates } from '../feed-events';
import { toIcs } from '../ics';

const NOW = new Date('2026-11-23T10:00:00Z');

describe('toIcs', () => {
  test('writes an all-day event with CRLF line ends and an exclusive end date', () => {
    const ics = toIcs(
      [{ uid: 'reminder-1-20261231@vroom', date: '2026-12-31', summary: 'Tyres' }],
      NOW
    );
    expect(ics.split('\r\n')).toEqual([
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//VROOM//Calendar//EN',
      'CALSCALE:GREGORIAN',
      'METHOD:PUBLISH',
      'X-WR-CALNAME:VROOM',
      'BEGIN:VEVENT',
      'UID:reminder-1-20261231@vroom',
      'DTSTAMP:20261123T100000Z',
      'DTSTART;VALUE=DATE:20261231',
      'DTEND;VALUE=DATE:20270101',
      'SUMMARY:Tyres',
      'TRANSP:TRANSPARENT',
      'END:VEVENT',
      'END:VCALENDAR',
      '',
    ]);
  });

  test('escapes text so a reminder name cannot add properties or events', () => {
    const ics = toIcs(
      [{ uid: 'u', date: '2026-12-01', summary: 'A, B; C\\D\nEND:VEVENT\r\nBEGIN:VEVENT' }],
      NOW
    );
    expect(ics).toContain('SUMMARY:A\\, B\\; C\\\\D\\nEND:VEVENT\\nBEGIN:VEVENT\r\n');
    expect(ics.match(/^BEGIN:VEVENT$/gm)).toHaveLength(1);
  });

  test('a bare carriage return is escaped like any other line break', () => {
    const ics = toIcs([{ uid: 'u', date: '2026-12-01', summary: 'A\rBEGIN:VEVENT\rB' }], NOW);
    expect(ics).toContain('SUMMARY:A\\nBEGIN:VEVENT\\nB\r\n');
    expect(ics.split(/\r\n|\r|\n/).filter((l) => l === 'BEGIN:VEVENT')).toHaveLength(1);
  });

  test('folds lines longer than 75 octets without splitting a character', () => {
    const ics = toIcs([{ uid: 'u', date: '2026-12-01', summary: 'é'.repeat(60) }], NOW);
    const lines = ics.split('\r\n');
    for (const line of lines) expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
    const summary = lines
      .slice(lines.findIndex((l) => l.startsWith('SUMMARY:')))
      .filter((l, i) => i === 0 || l.startsWith(' '))
      .map((l, i) => (i === 0 ? l : l.slice(1)))
      .join('');
    expect(summary).toBe(`SUMMARY:${'é'.repeat(60)}`);
  });
});

describe('paymentDates', () => {
  const base = {
    startDate: new Date('2025-01-31T12:00:00Z'),
    termMonths: 24,
    paymentDayOfMonth: 31,
    endDate: null,
  };
  const from = new Date('2026-01-01T00:00:00Z');
  const to = new Date('2026-04-30T00:00:00Z');

  test('monthly payments land on the day, clamped to short months, inside the window', () => {
    const days = paymentDates({ ...base, paymentFrequency: 'monthly' }, from, to).map((d) =>
      d.toISOString().slice(0, 10)
    );
    expect(days).toEqual(['2026-01-31', '2026-02-28', '2026-03-31']);
  });

  test('a payment day later in the month than the start keeps the last payment', () => {
    const loan = {
      startDate: new Date('2026-01-05T12:00:00Z'),
      termMonths: 12,
      paymentDayOfMonth: 20,
      endDate: null,
      paymentFrequency: 'monthly',
    };
    const days = paymentDates(
      loan,
      new Date('2026-01-01T00:00:00Z'),
      new Date('2027-12-31T00:00:00Z')
    );
    expect(days).toHaveLength(12);
    expect(days.at(-1)?.toISOString().slice(0, 10)).toBe('2027-01-20');
  });

  test('payments stop at the end of the term', () => {
    const short = { ...base, termMonths: 13, paymentFrequency: 'monthly' };
    expect(paymentDates(short, from, to).map((d) => d.toISOString().slice(0, 10))).toEqual([
      '2026-01-31',
      '2026-02-28',
    ]);
  });

  test('weekly and bi-weekly payments step from the start date; custom has none', () => {
    const weekly = paymentDates({ ...base, paymentFrequency: 'weekly' }, from, to);
    const biweekly = paymentDates({ ...base, paymentFrequency: 'bi-weekly' }, from, to);
    expect(weekly.length).toBe(17);
    expect(biweekly.length).toBe(9);
    expect(paymentDates({ ...base, paymentFrequency: 'custom' }, from, to)).toEqual([]);
  });
});
