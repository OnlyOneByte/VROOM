/**
 * Characterization tests for getInsurance / buildInsuranceDetails (C73 deep-review). This
 * insurance-analytics path had ZERO test coverage, yet it carries the cost-shape logic (bug #8,
 * effectiveMonthlyPremium) AND the open #14 question (an expired latest term still counts as the
 * current premium). The C73 audit read it against source; this pins the CURRENT behavior so a
 * future #14 decision (filter to endDate >= now, or keep) is a safe, deliberate change against a
 * net — and documents exactly what that behavior is.
 *
 * Goes through the public getInsurance(userId) over a real in-memory DB (buildInsuranceDetails is
 * private), seeding policies/terms/junctions directly — the analytics-test-generators harness.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { AnalyticsRepository } from '../repository';
import {
  createTestDb,
  seedInsurancePolicy,
  seedInsuranceTermVehicle,
  seedUser,
  seedVehicle,
  type TestDb,
} from './analytics-test-generators';

let testDb: TestDb;
let repo: AnalyticsRepository;
const USER = 'user-ins';

beforeEach(() => {
  testDb = createTestDb();
  repo = new AnalyticsRepository(testDb.drizzle);
  seedUser(testDb.sqlite, { id: USER, email: 'ins@example.com', displayName: 'Ins' });
  seedVehicle(testDb.sqlite, {
    id: 'veh-1',
    userId: USER,
    make: 'Honda',
    model: 'Civic',
    year: 2022,
  });
});
afterEach(() => testDb.sqlite.close());

const MS_DAY = 24 * 60 * 60 * 1000;

/** Insert an insurance policy (active by default). */
function policy(id: string, company: string, isActive = true): void {
  seedInsurancePolicy(testDb.sqlite, { id, userId: USER, company, isActive });
}

/** Insert an insurance term (start/end are ms-epoch timestamps; cost shape is monthly OR total). */
function term(opts: {
  id: string;
  policyId: string;
  startMs: number;
  endMs: number;
  monthlyCost?: number | null;
  totalCost?: number | null;
}): void {
  testDb.sqlite.run(
    'INSERT INTO insurance_terms (id, policy_id, start_date, end_date, monthly_cost, total_cost) VALUES (?, ?, ?, ?, ?, ?)',
    [
      opts.id,
      opts.policyId,
      opts.startMs,
      opts.endMs,
      opts.monthlyCost ?? null,
      opts.totalCost ?? null,
    ]
  );
}

const now = Date.UTC(2024, 5, 15); // fixed reference for the relative term windows below

describe('getInsurance — cost-shape handling (bug #8 path)', () => {
  test('an explicit monthlyCost flows straight into the monthly + annual totals', async () => {
    policy('p1', 'GEICO');
    term({
      id: 't1',
      policyId: 'p1',
      startMs: now - 30 * MS_DAY,
      endMs: now + 335 * MS_DAY,
      monthlyCost: 100,
    });
    seedInsuranceTermVehicle(testDb.sqlite, { termId: 't1', vehicleId: 'veh-1' });

    const result = await repo.getInsurance(USER);
    expect(result.summary.totalMonthlyPremiums).toBeCloseTo(100, 2);
    expect(result.summary.totalAnnualPremiums).toBeCloseTo(1200, 2);
    expect(result.summary.activePoliciesCount).toBe(1);
  });

  test('a lump-sum totalCost (no monthlyCost) is amortized across the term span, not zeroed', async () => {
    // The bug #8 class: `monthlyCost ?? 0` once zeroed every totalCost-only term.
    policy('p1', 'GEICO');
    // A ~12-month term with totalCost 1200 → ~100/mo.
    term({
      id: 't1',
      policyId: 'p1',
      startMs: now - 30 * MS_DAY,
      endMs: now + 335 * MS_DAY,
      totalCost: 1200,
    });
    seedInsuranceTermVehicle(testDb.sqlite, { termId: 't1', vehicleId: 'veh-1' });

    const result = await repo.getInsurance(USER);
    expect(result.summary.totalMonthlyPremiums).toBeGreaterThan(0); // NOT zeroed
  });
});

describe('getInsurance — latest-term selection', () => {
  test('the latest term (by endDate) wins when a policy has several', async () => {
    policy('p1', 'GEICO');
    term({
      id: 'old',
      policyId: 'p1',
      startMs: now - 400 * MS_DAY,
      endMs: now - 40 * MS_DAY,
      monthlyCost: 80,
    });
    term({
      id: 'new',
      policyId: 'p1',
      startMs: now - 30 * MS_DAY,
      endMs: now + 335 * MS_DAY,
      monthlyCost: 120,
    });
    seedInsuranceTermVehicle(testDb.sqlite, { termId: 'new', vehicleId: 'veh-1' });

    const result = await repo.getInsurance(USER);
    expect(result.summary.totalMonthlyPremiums).toBeCloseTo(120, 2); // the newer term's premium
  });

  test('equal-endDate terms break the tie by the later startDate (deterministic, #50)', async () => {
    // Two terms share an endDate (e.g. a mid-term correction); the later-STARTING one is the current
    // coverage and must win regardless of DB row order.
    policy('p1', 'GEICO');
    const sharedEnd = now + 335 * MS_DAY;
    term({
      id: 'earlier-start',
      policyId: 'p1',
      startMs: now - 60 * MS_DAY,
      endMs: sharedEnd,
      monthlyCost: 100,
    });
    term({
      id: 'later-start',
      policyId: 'p1',
      startMs: now - 20 * MS_DAY,
      endMs: sharedEnd,
      monthlyCost: 130,
    });
    seedInsuranceTermVehicle(testDb.sqlite, { termId: 'later-start', vehicleId: 'veh-1' });

    const result = await repo.getInsurance(USER);
    expect(result.summary.totalMonthlyPremiums).toBeCloseTo(130, 2); // the later-starting term
  });

  test('an INACTIVE policy is excluded from the premium totals', async () => {
    policy('p1', 'GEICO', false); // inactive
    term({
      id: 't1',
      policyId: 'p1',
      startMs: now - 30 * MS_DAY,
      endMs: now + 335 * MS_DAY,
      monthlyCost: 100,
    });
    seedInsuranceTermVehicle(testDb.sqlite, { termId: 't1', vehicleId: 'veh-1' });

    const result = await repo.getInsurance(USER);
    expect(result.summary.activePoliciesCount).toBe(0);
    expect(result.summary.totalMonthlyPremiums).toBe(0);
  });
});

describe('getInsurance — #25: per-vehicle attribution scopes to the LATEST term, not all terms', () => {
  // The premium is the LATEST term's (line ~924); coveredVehicleIds MUST be that same term's
  // junctions. Pre-fix it spanned EVERY term's junctions, so a policy whose coverage shrank across
  // terms mis-distributed: the latest premium got divided by the (larger) all-terms vehicle count,
  // understating the still-covered vehicle and inventing phantom premiums for dropped ones.
  test('a vehicle dropped from the latest term gets NO premium; the kept vehicle gets the FULL latest premium', async () => {
    seedVehicle(testDb.sqlite, {
      id: 'veh-2',
      userId: USER,
      make: 'Toyota',
      model: 'Corolla',
      year: 2021,
    });
    policy('p1', 'GEICO');
    // OLD term covered BOTH veh-1 and veh-2.
    term({
      id: 'old',
      policyId: 'p1',
      startMs: now - 400 * MS_DAY,
      endMs: now - 40 * MS_DAY,
      monthlyCost: 80,
    });
    seedInsuranceTermVehicle(testDb.sqlite, { termId: 'old', vehicleId: 'veh-1' });
    seedInsuranceTermVehicle(testDb.sqlite, { termId: 'old', vehicleId: 'veh-2' });
    // LATEST term renewed covering ONLY veh-1 (veh-2 was dropped) at $120/mo.
    term({
      id: 'new',
      policyId: 'p1',
      startMs: now - 30 * MS_DAY,
      endMs: now + 335 * MS_DAY,
      monthlyCost: 120,
    });
    seedInsuranceTermVehicle(testDb.sqlite, { termId: 'new', vehicleId: 'veh-1' });

    const result = await repo.getInsurance(USER);

    // The aggregate is unchanged — added once per policy regardless of distribution.
    expect(result.summary.totalMonthlyPremiums).toBeCloseTo(120, 2);

    // Only veh-1 appears in vehicleDetails, carrying the FULL $120 (pre-fix: veh-1 AND veh-2 each
    // appeared at $60 — half the premium, plus a phantom entry for the no-longer-covered veh-2).
    const ids = result.vehicleDetails.map((d) => d.vehicleId).sort();
    expect(ids).toEqual(['veh-1']);
    const veh1 = result.vehicleDetails.find((d) => d.vehicleId === 'veh-1');
    expect(veh1?.monthlyPremium).toBeCloseTo(120, 2);
    expect(veh1?.annualPremium).toBeCloseTo(1440, 2);

    // costByCarrier counts only the latest term's vehicles (pre-fix: 2).
    expect(result.costByCarrier).toHaveLength(1);
    expect(result.costByCarrier[0]?.vehicleCount).toBe(1);
  });

  test('when coverage is UNCHANGED across terms, a multi-vehicle split is still correct (no regression)', async () => {
    // Control: both terms cover {veh-1, veh-2}, latest premium $120 → each vehicle $60. The fix must
    // not disturb the normal multi-vehicle split — only the changed-coverage case above.
    seedVehicle(testDb.sqlite, {
      id: 'veh-2',
      userId: USER,
      make: 'Toyota',
      model: 'Corolla',
      year: 2021,
    });
    policy('p1', 'GEICO');
    term({
      id: 'new',
      policyId: 'p1',
      startMs: now - 30 * MS_DAY,
      endMs: now + 335 * MS_DAY,
      monthlyCost: 120,
    });
    seedInsuranceTermVehicle(testDb.sqlite, { termId: 'new', vehicleId: 'veh-1' });
    seedInsuranceTermVehicle(testDb.sqlite, { termId: 'new', vehicleId: 'veh-2' });

    const result = await repo.getInsurance(USER);
    expect(result.summary.totalMonthlyPremiums).toBeCloseTo(120, 2);
    const ids = result.vehicleDetails.map((d) => d.vehicleId).sort();
    expect(ids).toEqual(['veh-1', 'veh-2']);
    for (const d of result.vehicleDetails) expect(d.monthlyPremium).toBeCloseTo(60, 2);
    expect(result.costByCarrier[0]?.vehicleCount).toBe(2);
  });
});

describe('getInsurance — #14 OPEN QUESTION: an expired latest term still counts (pending Angelo)', () => {
  // This pins the CURRENT behavior, NOT an endorsement of it. buildInsuranceDetails picks the
  // latest term by endDate but does NOT check endDate >= now, so an ACTIVE policy whose latest
  // term lapsed months ago still contributes its stale premium. If/when #14 is decided to filter
  // expired terms, this test is the one to flip (and it documents exactly what changes).
  test('an active policy whose only term already EXPIRED still adds its premium to the total', async () => {
    policy('p1', 'GEICO');
    // Term ended ~40 days before `now` and was never renewed.
    term({
      id: 'lapsed',
      policyId: 'p1',
      startMs: now - 400 * MS_DAY,
      endMs: now - 40 * MS_DAY,
      monthlyCost: 90,
    });
    seedInsuranceTermVehicle(testDb.sqlite, { termId: 'lapsed', vehicleId: 'veh-1' });

    const result = await repo.getInsurance(USER);
    // CURRENT behavior (the #14 question): the expired term's premium is still counted.
    expect(result.summary.totalMonthlyPremiums).toBeCloseTo(90, 2);
    expect(result.summary.activePoliciesCount).toBe(1);
  });
});

describe('getInsurance — #51: term-less active policies excluded from activePoliciesCount', () => {
  // A term-less active policy contributes $0 to the premium totals (buildInsuranceDetails skips it via
  // `if (!latestTerm) continue`). Pre-fix activePoliciesCount counted it anyway → "2 active policies"
  // beside premiums summed over only 1, an internal inconsistency. The count now uses the SAME
  // has-a-term predicate the premium path gates on.
  test('an active policy with NO terms is not counted (count matches the policies contributing premiums)', async () => {
    policy('p-withterm', 'GEICO'); // active, HAS a term → counts + contributes premium
    term({
      id: 't1',
      policyId: 'p-withterm',
      startMs: now - 30 * MS_DAY,
      endMs: now + 335 * MS_DAY,
      monthlyCost: 100,
    });
    seedInsuranceTermVehicle(testDb.sqlite, { termId: 't1', vehicleId: 'veh-1' });

    policy('p-noterm', 'Allstate'); // active, NO term → $0, must NOT inflate the count

    const result = await repo.getInsurance(USER);
    // Only the policy that actually contributes a premium is counted.
    expect(result.summary.activePoliciesCount).toBe(1);
    expect(result.summary.totalMonthlyPremiums).toBeCloseTo(100, 2);
  });

  test('an active policy WITH a term is still counted (the fix does not over-exclude)', async () => {
    policy('p1', 'GEICO');
    term({
      id: 't1',
      policyId: 'p1',
      startMs: now - 30 * MS_DAY,
      endMs: now + 335 * MS_DAY,
      monthlyCost: 75,
    });
    seedInsuranceTermVehicle(testDb.sqlite, { termId: 't1', vehicleId: 'veh-1' });

    const result = await repo.getInsurance(USER);
    expect(result.summary.activePoliciesCount).toBe(1);
  });

  test('a term-less active policy alongside ZERO termed policies yields count 0 + $0', async () => {
    policy('p-noterm', 'Allstate'); // active, but no term anywhere

    const result = await repo.getInsurance(USER);
    expect(result.summary.activePoliciesCount).toBe(0);
    expect(result.summary.totalMonthlyPremiums).toBe(0);
  });
});

describe('getInsurance — empty / no-data', () => {
  test('a user with no policies gets a zeroed summary, not a throw', async () => {
    const result = await repo.getInsurance(USER);
    expect(result.summary.totalMonthlyPremiums).toBe(0);
    expect(result.summary.activePoliciesCount).toBe(0);
    expect(result.vehicleDetails).toEqual([]);
    expect(result.costByCarrier).toEqual([]);
  });
});

// C46 deep-review: the `monthlyPremiumTrend` series (the per-month premium chart the analytics tab
// renders) was driven ONLY transitively through getInsurance — every prior test asserts the totals /
// per-vehicle split / count / contract, but NONE pins the month-by-month bucketing. That's the C6/C18
// "helper output never asserted" gap on a money-facing series: a regression in accumulateMonthlyPremiums
// (e.g. adding the premium ONCE instead of per-month, or an off-by-one on the span) would distort the
// trend chart and pass every existing test. These certify the bucketing firsthand. Day-1-anchored,
// inclusive of both endpoint months (monthKeysInRange, the #14/cycle-14 contract effectiveMonthlyPremium
// amortizes over) — uses UTC month boundaries so the keys are timezone-stable.
//
// HARNESS NOTE (firsthand audit finding): insurance_terms.start_date/end_date are Drizzle `mode:
// 'timestamp'` columns — SQLite stores Unix SECONDS, and the real repository writes via the ORM
// (`.insert(...).values({ startDate: Date })`), which divides by 1000. The shared `term()` helper above
// inserts raw MILLISECONDS via direct SQL, so a term's dates read back ~1000× too large (year ~55970).
// The pre-existing tests never caught this because they're date-INDEPENDENT (monthlyCost flows straight
// through effectiveMonthlyPremium; the totalCost test only asserts > 0) — the trend is the first
// assertion that depends on the stored epoch. So these seed SECONDS (`termSeconds`) to match the
// production storage contract; the PRODUCTION path is clean (verified by seeding the real seconds shape).
function termSeconds(opts: {
  id: string;
  policyId: string;
  startMs: number;
  endMs: number;
  monthlyCost?: number | null;
  totalCost?: number | null;
}): void {
  testDb.sqlite.run(
    'INSERT INTO insurance_terms (id, policy_id, start_date, end_date, monthly_cost, total_cost) VALUES (?, ?, ?, ?, ?, ?)',
    [
      opts.id,
      opts.policyId,
      Math.floor(opts.startMs / 1000),
      Math.floor(opts.endMs / 1000),
      opts.monthlyCost ?? null,
      opts.totalCost ?? null,
    ]
  );
}

describe('getInsurance — monthlyPremiumTrend bucketing (C46 deep-review)', () => {
  test('a term contributes its monthly premium to EACH month it spans (inclusive both ends)', async () => {
    policy('p1', 'GEICO');
    // Jan 1 → Mar 31 2024 inclusive = exactly 3 month-keys, each carrying the full $100 monthly premium.
    termSeconds({
      id: 't1',
      policyId: 'p1',
      startMs: Date.UTC(2024, 0, 1),
      endMs: Date.UTC(2024, 2, 31),
      monthlyCost: 100,
    });
    seedInsuranceTermVehicle(testDb.sqlite, { termId: 't1', vehicleId: 'veh-1' });

    const result = await repo.getInsurance(USER);
    expect(result.monthlyPremiumTrend).toEqual([
      { month: '2024-01', premiums: 100 },
      { month: '2024-02', premiums: 100 },
      { month: '2024-03', premiums: 100 },
    ]);
  });

  test('overlapping policies SUM their premiums in the shared months', async () => {
    // p1 spans Jan–Feb @ $100/mo; p2 spans Feb–Mar @ $30/mo. February is shared → 130.
    policy('p1', 'GEICO');
    policy('p2', 'Allstate');
    termSeconds({
      id: 't1',
      policyId: 'p1',
      startMs: Date.UTC(2024, 0, 10),
      endMs: Date.UTC(2024, 1, 20),
      monthlyCost: 100,
    });
    termSeconds({
      id: 't2',
      policyId: 'p2',
      startMs: Date.UTC(2024, 1, 5),
      endMs: Date.UTC(2024, 2, 5),
      monthlyCost: 30,
    });
    seedInsuranceTermVehicle(testDb.sqlite, { termId: 't1', vehicleId: 'veh-1' });
    seedInsuranceTermVehicle(testDb.sqlite, { termId: 't2', vehicleId: 'veh-1' });

    const result = await repo.getInsurance(USER);
    const byMonth = new Map(result.monthlyPremiumTrend.map((p) => [p.month, p.premiums]));
    expect(byMonth.get('2024-01')).toBeCloseTo(100, 2);
    expect(byMonth.get('2024-02')).toBeCloseTo(130, 2); // overlap sums
    expect(byMonth.get('2024-03')).toBeCloseTo(30, 2);
    // The series is sorted ascending by month-key (the response .sort() contract).
    expect(result.monthlyPremiumTrend.map((p) => p.month)).toEqual([
      '2024-01',
      '2024-02',
      '2024-03',
    ]);
  });

  test('a totalCost-only term spreads its AMORTIZED monthly premium across each spanned month', async () => {
    // totalCost 300 over a Jan–Mar (3-month) span → effectiveMonthlyPremium 100, in EACH month
    // (not the lump sum in one bucket — the trend shows the recurring cost, matching the totals path).
    policy('p1', 'GEICO');
    termSeconds({
      id: 't1',
      policyId: 'p1',
      startMs: Date.UTC(2024, 0, 1),
      endMs: Date.UTC(2024, 2, 31),
      totalCost: 300,
    });
    seedInsuranceTermVehicle(testDb.sqlite, { termId: 't1', vehicleId: 'veh-1' });

    const result = await repo.getInsurance(USER);
    expect(result.monthlyPremiumTrend).toEqual([
      { month: '2024-01', premiums: 100 },
      { month: '2024-02', premiums: 100 },
      { month: '2024-03', premiums: 100 },
    ]);
  });
});

// FE↔BE contract-drift guard for the GET /analytics/insurance response (loop-improvement #2;
// C55 /stats, C62 /vehicles list, C68 single-financing — this locks the hand-assembled
// InsuranceData). getInsurance hand-builds a nested summary + 3 derived arrays with NO type
// binding to the frontend InsuranceResponse (types/analytics.ts:180); a dropped/renamed key
// silently breaks the analytics tab. Exact-key equality, shape-stable across empty + populated.
const INSURANCE_TOP_KEYS = [
  'summary',
  'vehicleDetails',
  'monthlyPremiumTrend',
  'costByCarrier',
].sort();
const SUMMARY_KEYS = ['totalMonthlyPremiums', 'totalAnnualPremiums', 'activePoliciesCount'].sort();
const VEHICLE_DETAIL_KEYS = [
  'vehicleId',
  'vehicleName',
  'carrier',
  'monthlyPremium',
  'annualPremium',
  'deductible',
  'coverageType',
].sort();

describe('getInsurance — FE↔BE response contract shape (drift guard)', () => {
  test('the EMPTY response has exactly the frontend InsuranceResponse top-level + summary keys', async () => {
    const result = await repo.getInsurance(USER);
    expect(Object.keys(result).sort()).toEqual(INSURANCE_TOP_KEYS);
    expect(Object.keys(result.summary).sort()).toEqual(SUMMARY_KEYS);
  });

  test('a POPULATED response keeps the same top-level/summary keys + the vehicleDetails + array item shapes', async () => {
    policy('p1', 'GEICO');
    term({
      id: 't1',
      policyId: 'p1',
      startMs: now - 30 * MS_DAY,
      endMs: now + 335 * MS_DAY,
      monthlyCost: 100,
    });
    seedInsuranceTermVehicle(testDb.sqlite, { termId: 't1', vehicleId: 'veh-1' });

    const result = await repo.getInsurance(USER);
    expect(Object.keys(result).sort()).toEqual(INSURANCE_TOP_KEYS);
    expect(Object.keys(result.summary).sort()).toEqual(SUMMARY_KEYS);

    expect(result.vehicleDetails.length).toBeGreaterThan(0);
    expect(Object.keys(result.vehicleDetails[0]).sort()).toEqual(VEHICLE_DETAIL_KEYS);

    expect(result.costByCarrier.length).toBeGreaterThan(0);
    expect(Object.keys(result.costByCarrier[0]).sort()).toEqual(
      ['carrier', 'annualPremium', 'vehicleCount'].sort()
    );

    expect(result.monthlyPremiumTrend.length).toBeGreaterThan(0);
    expect(Object.keys(result.monthlyPremiumTrend[0]).sort()).toEqual(['month', 'premiums'].sort());
  });
});
