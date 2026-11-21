import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { insuranceTerms } from '../../../db/schema';
import {
  createTestDb,
  seedInsurancePolicy,
  seedUser,
  type TestDb,
} from '../../analytics/__tests__/analytics-test-generators';
import { isTermInForce, termInForceAt } from '../in-force';

const NOW = new Date('2026-06-15T12:00:00.000Z');
const DAY = 86_400_000;
const seconds = (ms: number) => Math.floor(ms / 1000);

const TERMS: Array<{ id: string; start: number; end: number; inForce: boolean }> = [
  { id: 'ended', start: NOW.getTime() - 400 * DAY, end: NOW.getTime() - 35 * DAY, inForce: false },
  { id: 'current', start: NOW.getTime() - 30 * DAY, end: NOW.getTime() + 150 * DAY, inForce: true },
  { id: 'starts-now', start: NOW.getTime(), end: NOW.getTime() + 180 * DAY, inForce: true },
  { id: 'ends-now', start: NOW.getTime() - 180 * DAY, end: NOW.getTime(), inForce: true },
  {
    id: 'ended-1s-ago',
    start: NOW.getTime() - 180 * DAY,
    end: NOW.getTime() - 1000,
    inForce: false,
  },
  { id: 'future', start: NOW.getTime() + 1000, end: NOW.getTime() + 180 * DAY, inForce: false },
];

let testDb: TestDb;

beforeEach(() => {
  testDb = createTestDb();
  seedUser(testDb.sqlite, { id: 'u1', email: 'u1@test.com', displayName: 'U1' });
  seedInsurancePolicy(testDb.sqlite, { id: 'p1', userId: 'u1', company: 'Acme', isActive: true });
  for (const t of TERMS) {
    testDb.sqlite.run(
      'INSERT INTO insurance_terms (id, policy_id, start_date, end_date) VALUES (?, ?, ?, ?)',
      [t.id, 'p1', seconds(t.start), seconds(t.end)]
    );
  }
});

afterEach(() => testDb.sqlite.close());

describe('one in-force rule for SQL and code', () => {
  test.each([
    ['on a whole second', NOW],
    ['half a second later', new Date(NOW.getTime() + 500)],
  ])(
    'the SQL predicate and isTermInForce select the same terms, boundaries included (%s)',
    async (_label, now) => {
      const expected = TERMS.filter((t) => t.inForce)
        .map((t) => t.id)
        .sort();

      const sqlIds = (
        await testDb.drizzle
          .select({ id: insuranceTerms.id })
          .from(insuranceTerms)
          .where(termInForceAt(now))
      )
        .map((r) => r.id)
        .sort();

      const rows = await testDb.drizzle.select().from(insuranceTerms);
      const codeIds = rows
        .filter((r) => isTermInForce(r, now))
        .map((r) => r.id)
        .sort();

      expect(sqlIds).toEqual(expected);
      expect(codeIds).toEqual(expected);
    }
  );

  test('a term with a missing date is never in force', () => {
    expect(isTermInForce({ startDate: null, endDate: new Date(NOW.getTime() + DAY) }, NOW)).toBe(
      false
    );
    expect(isTermInForce({ startDate: new Date(NOW.getTime() - DAY), endDate: null }, NOW)).toBe(
      false
    );
  });
});
