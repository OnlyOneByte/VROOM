import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { insuranceTerms } from '../../../db/schema';
import { sqliteTestSql } from '../../../test-helpers/test-sql';
import { zonedMidnight } from '../../../utils/time-zone';
import { seedInsurancePolicy, seedUser } from '../../analytics/__tests__/analytics-test-db';
import { createTestDb, type TestDb } from '../../analytics/__tests__/analytics-test-generators';
import { isTermInForce, termInForceAt } from '../in-force';

const HOUR = 3_600_000;
const seconds = (d: Date) => Math.floor(d.getTime() / 1000);
const localTime = (day: number, hour: number, timeZone: string) =>
  new Date(zonedMidnight(2026, 5, day, timeZone).getTime() + hour * HOUR);

const TERMS = [
  { id: 'ended-yesterday', start: 1, end: 14, inForce: false },
  { id: 'ends-today', start: 1, end: 15, inForce: true },
  { id: 'current', start: 1, end: 30, inForce: true },
  { id: 'starts-today', start: 15, end: 30, inForce: true },
  { id: 'starts-tomorrow', start: 16, end: 30, inForce: false },
];

const CASES = ['UTC', 'Pacific/Auckland', 'America/Los_Angeles'].flatMap((timeZone) =>
  [9, 18].map((hour) => ({ timeZone, hour }))
);

let testDb: TestDb;

function seedTerms(timeZone: string): void {
  for (const t of TERMS) {
    testDb.sqlite.run(
      'INSERT INTO insurance_terms (id, policy_id, start_date, end_date) VALUES (?, ?, ?, ?)',
      [
        t.id,
        'p1',
        seconds(localTime(t.start, 12, timeZone)),
        seconds(localTime(t.end, 12, timeZone)),
      ]
    );
  }
}

beforeEach(async () => {
  testDb = createTestDb();
  await seedUser(sqliteTestSql(testDb.sqlite), {
    id: 'u1',
    email: 'u1@test.com',
    displayName: 'U1',
  });
  await seedInsurancePolicy(sqliteTestSql(testDb.sqlite), {
    id: 'p1',
    userId: 'u1',
    company: 'Acme',
    isActive: true,
  });
});

afterEach(() => testDb.sqlite.close());

describe('a term is in force on every local calendar day from its start date through its end date', () => {
  test.each(CASES)(
    'SQL and isTermInForce agree on Jun 15 at $hour:00 in $timeZone, the end day included and upcoming terms excluded',
    async ({ timeZone, hour }) => {
      seedTerms(timeZone);
      const now = localTime(15, hour, timeZone);
      const expected = TERMS.filter((t) => t.inForce)
        .map((t) => t.id)
        .sort();

      const sqlIds = (
        await testDb.drizzle
          .select({ id: insuranceTerms.id })
          .from(insuranceTerms)
          .where(termInForceAt(now, timeZone))
      )
        .map((r) => r.id)
        .sort();

      const rows = await testDb.drizzle.select().from(insuranceTerms);
      const codeIds = rows
        .filter((r) => isTermInForce(r, now, timeZone))
        .map((r) => r.id)
        .sort();

      expect(sqlIds).toEqual(expected);
      expect(codeIds).toEqual(expected);
    }
  );

  test('the end day is judged in the user zone: a Los Angeles term ending today still counts that evening', () => {
    const term = {
      startDate: localTime(1, 12, 'America/Los_Angeles'),
      endDate: localTime(15, 12, 'America/Los_Angeles'),
    };
    const eveningOfTheEndDay = localTime(15, 18, 'America/Los_Angeles');
    expect(isTermInForce(term, eveningOfTheEndDay, 'America/Los_Angeles')).toBe(true);
    expect(isTermInForce(term, eveningOfTheEndDay)).toBe(false);
  });

  test('a term with a missing date is never in force', () => {
    const now = localTime(15, 12, 'UTC');
    expect(isTermInForce({ startDate: null, endDate: localTime(20, 12, 'UTC') }, now)).toBe(false);
    expect(isTermInForce({ startDate: localTime(1, 12, 'UTC'), endDate: null }, now)).toBe(false);
  });
});
