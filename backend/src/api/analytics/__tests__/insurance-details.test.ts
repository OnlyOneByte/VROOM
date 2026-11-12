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

function policy(id: string, company: string, isActive = true): void {
  seedInsurancePolicy(testDb.sqlite, { id, userId: USER, company, isActive });
}

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

const now = Date.UTC(2024, 5, 15);

describe('getInsurance — cost-shape handling', () => {
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
    policy('p1', 'GEICO');
    term({
      id: 't1',
      policyId: 'p1',
      startMs: now - 30 * MS_DAY,
      endMs: now + 335 * MS_DAY,
      totalCost: 1200,
    });
    seedInsuranceTermVehicle(testDb.sqlite, { termId: 't1', vehicleId: 'veh-1' });

    const result = await repo.getInsurance(USER);
    expect(result.summary.totalMonthlyPremiums).toBeGreaterThan(0);
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
    expect(result.summary.totalMonthlyPremiums).toBeCloseTo(120, 2);
  });

  test('equal-endDate terms break the tie by the later startDate (deterministic)', async () => {
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
    expect(result.summary.totalMonthlyPremiums).toBeCloseTo(130, 2);
  });

  test('an INACTIVE policy is excluded from the premium totals', async () => {
    policy('p1', 'GEICO', false);
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

describe('getInsurance — per-vehicle attribution scopes to the LATEST term, not all terms', () => {
  test('a vehicle dropped from the latest term gets NO premium; the kept vehicle gets the FULL latest premium', async () => {
    seedVehicle(testDb.sqlite, {
      id: 'veh-2',
      userId: USER,
      make: 'Toyota',
      model: 'Corolla',
      year: 2021,
    });
    policy('p1', 'GEICO');
    term({
      id: 'old',
      policyId: 'p1',
      startMs: now - 400 * MS_DAY,
      endMs: now - 40 * MS_DAY,
      monthlyCost: 80,
    });
    seedInsuranceTermVehicle(testDb.sqlite, { termId: 'old', vehicleId: 'veh-1' });
    seedInsuranceTermVehicle(testDb.sqlite, { termId: 'old', vehicleId: 'veh-2' });
    term({
      id: 'new',
      policyId: 'p1',
      startMs: now - 30 * MS_DAY,
      endMs: now + 335 * MS_DAY,
      monthlyCost: 120,
    });
    seedInsuranceTermVehicle(testDb.sqlite, { termId: 'new', vehicleId: 'veh-1' });

    const result = await repo.getInsurance(USER);

    expect(result.summary.totalMonthlyPremiums).toBeCloseTo(120, 2);

    const ids = result.vehicleDetails.map((d) => d.vehicleId).sort();
    expect(ids).toEqual(['veh-1']);
    const veh1 = result.vehicleDetails.find((d) => d.vehicleId === 'veh-1');
    expect(veh1?.monthlyPremium).toBeCloseTo(120, 2);
    expect(veh1?.annualPremium).toBeCloseTo(1440, 2);

    expect(result.costByCarrier).toHaveLength(1);
    expect(result.costByCarrier[0]?.vehicleCount).toBe(1);
  });

  test('when coverage is unchanged across terms, a multi-vehicle split is still correct', async () => {
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

describe('getInsurance — an expired latest term still counts (product decision pending)', () => {
  test('an active policy whose only term already EXPIRED still adds its premium to the total', async () => {
    policy('p1', 'GEICO');
    term({
      id: 'lapsed',
      policyId: 'p1',
      startMs: now - 400 * MS_DAY,
      endMs: now - 40 * MS_DAY,
      monthlyCost: 90,
    });
    seedInsuranceTermVehicle(testDb.sqlite, { termId: 'lapsed', vehicleId: 'veh-1' });

    const result = await repo.getInsurance(USER);
    expect(result.summary.totalMonthlyPremiums).toBeCloseTo(90, 2);
    expect(result.summary.activePoliciesCount).toBe(1);
  });
});

describe('getInsurance — term-less active policies excluded from activePoliciesCount', () => {
  test('an active policy with NO terms is not counted (count matches the policies contributing premiums)', async () => {
    policy('p-withterm', 'GEICO');
    term({
      id: 't1',
      policyId: 'p-withterm',
      startMs: now - 30 * MS_DAY,
      endMs: now + 335 * MS_DAY,
      monthlyCost: 100,
    });
    seedInsuranceTermVehicle(testDb.sqlite, { termId: 't1', vehicleId: 'veh-1' });

    policy('p-noterm', 'Allstate');

    const result = await repo.getInsurance(USER);
    expect(result.summary.activePoliciesCount).toBe(1);
    expect(result.summary.totalMonthlyPremiums).toBeCloseTo(100, 2);
  });

  test('an active policy with a term is still counted', async () => {
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
    policy('p-noterm', 'Allstate');

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

describe('getInsurance — monthlyPremiumTrend bucketing', () => {
  test('a term contributes its monthly premium to EACH month it spans (inclusive both ends)', async () => {
    policy('p1', 'GEICO');
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
    expect(byMonth.get('2024-02')).toBeCloseTo(130, 2);
    expect(byMonth.get('2024-03')).toBeCloseTo(30, 2);
    expect(result.monthlyPremiumTrend.map((p) => p.month)).toEqual([
      '2024-01',
      '2024-02',
      '2024-03',
    ]);
  });

  test('a totalCost-only term spreads its AMORTIZED monthly premium across each spanned month', async () => {
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

describe('getInsurance — response shape matches the frontend contract', () => {
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
