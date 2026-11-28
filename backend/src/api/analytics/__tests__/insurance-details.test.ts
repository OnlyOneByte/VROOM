import { afterEach, beforeEach, describe, expect, setSystemTime, test } from 'bun:test';
import { AnalyticsRepository } from '../repository';
import {
  type AnalyticsTestDb,
  openAnalyticsTestDb,
  seedInsurancePolicy,
  seedInsuranceTermVehicle,
  seedUser,
  seedVehicle,
} from './analytics-test-db';

let testDb: AnalyticsTestDb;
let repo: AnalyticsRepository;
const USER = 'user-ins';

beforeEach(async () => {
  testDb = await openAnalyticsTestDb();
  repo = new AnalyticsRepository(testDb.asyncDb);
  await seedUser(testDb.sql, { id: USER, email: 'ins@example.com', displayName: 'Ins' });
  await seedVehicle(testDb.sql, {
    id: 'veh-1',
    userId: USER,
    make: 'Honda',
    model: 'Civic',
    year: 2022,
  });
});
afterEach(() => {
  setSystemTime();
  testDb.close();
});

const MS_DAY = 24 * 60 * 60 * 1000;

async function policy(id: string, company: string, isActive = true): Promise<void> {
  await seedInsurancePolicy(testDb.sql, { id, userId: USER, company, isActive });
}

async function term(opts: {
  id: string;
  policyId: string;
  startMs: number;
  endMs: number;
  monthlyCost?: number | null;
  totalCost?: number | null;
}): Promise<void> {
  await testDb.sql.run(
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

const now = Date.now();

describe('getInsurance — cost-shape handling', () => {
  test('an explicit monthlyCost flows straight into the monthly + annual totals', async () => {
    await policy('p1', 'GEICO');
    await term({
      id: 't1',
      policyId: 'p1',
      startMs: now - 30 * MS_DAY,
      endMs: now + 335 * MS_DAY,
      monthlyCost: 100,
    });
    await seedInsuranceTermVehicle(testDb.sql, { termId: 't1', vehicleId: 'veh-1' });

    const result = await repo.getInsurance(USER);
    expect(result.summary.totalMonthlyPremiums).toBeCloseTo(100, 2);
    expect(result.summary.totalAnnualPremiums).toBeCloseTo(1200, 2);
    expect(result.summary.activePoliciesCount).toBe(1);
  });

  test('a lump-sum totalCost (no monthlyCost) is amortized across the term span, not zeroed', async () => {
    await policy('p1', 'GEICO');
    await term({
      id: 't1',
      policyId: 'p1',
      startMs: now - 30 * MS_DAY,
      endMs: now + 335 * MS_DAY,
      totalCost: 1200,
    });
    await seedInsuranceTermVehicle(testDb.sql, { termId: 't1', vehicleId: 'veh-1' });

    const result = await repo.getInsurance(USER);
    expect(result.summary.totalMonthlyPremiums).toBeGreaterThan(0);
  });
});

describe('getInsurance — latest-term selection', () => {
  test('the latest await term (by endDate) wins when a policy has several', async () => {
    await policy('p1', 'GEICO');
    await term({
      id: 'old',
      policyId: 'p1',
      startMs: now - 400 * MS_DAY,
      endMs: now - 40 * MS_DAY,
      monthlyCost: 80,
    });
    await term({
      id: 'new',
      policyId: 'p1',
      startMs: now - 30 * MS_DAY,
      endMs: now + 335 * MS_DAY,
      monthlyCost: 120,
    });
    await seedInsuranceTermVehicle(testDb.sql, { termId: 'new', vehicleId: 'veh-1' });

    const result = await repo.getInsurance(USER);
    expect(result.summary.totalMonthlyPremiums).toBeCloseTo(120, 2);
  });

  test('equal-endDate terms break the tie by the later startDate (deterministic)', async () => {
    await policy('p1', 'GEICO');
    const sharedEnd = now + 335 * MS_DAY;
    await term({
      id: 'earlier-start',
      policyId: 'p1',
      startMs: now - 60 * MS_DAY,
      endMs: sharedEnd,
      monthlyCost: 100,
    });
    await term({
      id: 'later-start',
      policyId: 'p1',
      startMs: now - 20 * MS_DAY,
      endMs: sharedEnd,
      monthlyCost: 130,
    });
    await seedInsuranceTermVehicle(testDb.sql, { termId: 'later-start', vehicleId: 'veh-1' });

    const result = await repo.getInsurance(USER);
    expect(result.summary.totalMonthlyPremiums).toBeCloseTo(130, 2);
  });

  test('an INACTIVE policy is excluded from the premium totals', async () => {
    await policy('p1', 'GEICO', false);
    await term({
      id: 't1',
      policyId: 'p1',
      startMs: now - 30 * MS_DAY,
      endMs: now + 335 * MS_DAY,
      monthlyCost: 100,
    });
    await seedInsuranceTermVehicle(testDb.sql, { termId: 't1', vehicleId: 'veh-1' });

    const result = await repo.getInsurance(USER);
    expect(result.summary.activePoliciesCount).toBe(0);
    expect(result.summary.totalMonthlyPremiums).toBe(0);
  });
});

describe('getInsurance — per-vehicle attribution scopes to the LATEST term, not all terms', () => {
  test('a vehicle dropped from the latest term gets NO premium; the kept vehicle gets the FULL latest premium', async () => {
    await seedVehicle(testDb.sql, {
      id: 'veh-2',
      userId: USER,
      make: 'Toyota',
      model: 'Corolla',
      year: 2021,
    });
    await policy('p1', 'GEICO');
    await term({
      id: 'old',
      policyId: 'p1',
      startMs: now - 400 * MS_DAY,
      endMs: now - 40 * MS_DAY,
      monthlyCost: 80,
    });
    await seedInsuranceTermVehicle(testDb.sql, { termId: 'old', vehicleId: 'veh-1' });
    await seedInsuranceTermVehicle(testDb.sql, { termId: 'old', vehicleId: 'veh-2' });
    await term({
      id: 'new',
      policyId: 'p1',
      startMs: now - 30 * MS_DAY,
      endMs: now + 335 * MS_DAY,
      monthlyCost: 120,
    });
    await seedInsuranceTermVehicle(testDb.sql, { termId: 'new', vehicleId: 'veh-1' });

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
    await seedVehicle(testDb.sql, {
      id: 'veh-2',
      userId: USER,
      make: 'Toyota',
      model: 'Corolla',
      year: 2021,
    });
    await policy('p1', 'GEICO');
    await term({
      id: 'new',
      policyId: 'p1',
      startMs: now - 30 * MS_DAY,
      endMs: now + 335 * MS_DAY,
      monthlyCost: 120,
    });
    await seedInsuranceTermVehicle(testDb.sql, { termId: 'new', vehicleId: 'veh-1' });
    await seedInsuranceTermVehicle(testDb.sql, { termId: 'new', vehicleId: 'veh-2' });

    const result = await repo.getInsurance(USER);
    expect(result.summary.totalMonthlyPremiums).toBeCloseTo(120, 2);
    const ids = result.vehicleDetails.map((d) => d.vehicleId).sort();
    expect(ids).toEqual(['veh-1', 'veh-2']);
    for (const d of result.vehicleDetails) expect(d.monthlyPremium).toBeCloseTo(60, 2);
    expect(result.costByCarrier[0]?.vehicleCount).toBe(2);
  });
});

describe('getInsurance — only a term in force today counts toward the totals', () => {
  test('an active policy whose only term already EXPIRED adds no premium, vehicle or carrier', async () => {
    await policy('p1', 'GEICO');
    await term({
      id: 'lapsed',
      policyId: 'p1',
      startMs: now - 400 * MS_DAY,
      endMs: now - 40 * MS_DAY,
      monthlyCost: 90,
    });
    await seedInsuranceTermVehicle(testDb.sql, { termId: 'lapsed', vehicleId: 'veh-1' });

    const result = await repo.getInsurance(USER);
    expect(result.summary.totalMonthlyPremiums).toBe(0);
    expect(result.summary.activePoliciesCount).toBe(0);
    expect(result.vehicleDetails).toEqual([]);
    expect(result.costByCarrier).toEqual([]);
    expect(result.monthlyPremiumTrend.length).toBeGreaterThan(0);
  });

  test('a policy renewed for a future term counts its current term, not the future one', async () => {
    await policy('p1', 'GEICO');
    await term({
      id: 'current',
      policyId: 'p1',
      startMs: now - 100 * MS_DAY,
      endMs: now + 30 * MS_DAY,
      monthlyCost: 80,
    });
    await term({
      id: 'next',
      policyId: 'p1',
      startMs: now + 31 * MS_DAY,
      endMs: now + 395 * MS_DAY,
      monthlyCost: 95,
    });
    await seedInsuranceTermVehicle(testDb.sql, { termId: 'current', vehicleId: 'veh-1' });
    await seedInsuranceTermVehicle(testDb.sql, { termId: 'next', vehicleId: 'veh-1' });

    const result = await repo.getInsurance(USER);
    expect(result.summary.totalMonthlyPremiums).toBeCloseTo(80, 2);
    expect(result.summary.activePoliciesCount).toBe(1);
  });

  test('a term whose end date is today still counts, in totals and in vehicle coverage', async () => {
    const lateToday = new Date('2026-06-15T23:59:59.000Z');
    const startOfToday = Date.UTC(2026, 5, 15);
    setSystemTime(lateToday);
    await policy('p1', 'GEICO');
    await term({
      id: 'ends-today',
      policyId: 'p1',
      startMs: startOfToday - 180 * MS_DAY,
      endMs: startOfToday,
      monthlyCost: 70,
    });
    await seedInsuranceTermVehicle(testDb.sql, { termId: 'ends-today', vehicleId: 'veh-1' });

    const result = await repo.getInsurance(USER);
    expect(result.summary.totalMonthlyPremiums).toBeCloseTo(70, 2);
    expect(result.summary.activePoliciesCount).toBe(1);
    expect((await repo.getVehicleHealth(USER, 'veh-1')).insuranceCoverage).toBe(100);
  });
});

describe('getInsurance — term-less active policies excluded from activePoliciesCount', () => {
  test('an active policy with NO terms is not counted (count matches the policies contributing premiums)', async () => {
    await policy('p-withterm', 'GEICO');
    await term({
      id: 't1',
      policyId: 'p-withterm',
      startMs: now - 30 * MS_DAY,
      endMs: now + 335 * MS_DAY,
      monthlyCost: 100,
    });
    await seedInsuranceTermVehicle(testDb.sql, { termId: 't1', vehicleId: 'veh-1' });

    await policy('p-noterm', 'Allstate');

    const result = await repo.getInsurance(USER);
    expect(result.summary.activePoliciesCount).toBe(1);
    expect(result.summary.totalMonthlyPremiums).toBeCloseTo(100, 2);
  });

  test('an active policy with a term is still counted', async () => {
    await policy('p1', 'GEICO');
    await term({
      id: 't1',
      policyId: 'p1',
      startMs: now - 30 * MS_DAY,
      endMs: now + 335 * MS_DAY,
      monthlyCost: 75,
    });
    await seedInsuranceTermVehicle(testDb.sql, { termId: 't1', vehicleId: 'veh-1' });

    const result = await repo.getInsurance(USER);
    expect(result.summary.activePoliciesCount).toBe(1);
  });

  test('a term-less active policy alongside ZERO termed policies yields count 0 + $0', async () => {
    await policy('p-noterm', 'Allstate');

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

async function termSeconds(opts: {
  id: string;
  policyId: string;
  startMs: number;
  endMs: number;
  monthlyCost?: number | null;
  totalCost?: number | null;
}): Promise<void> {
  await testDb.sql.run(
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
    await policy('p1', 'GEICO');
    await termSeconds({
      id: 't1',
      policyId: 'p1',
      startMs: Date.UTC(2024, 0, 1),
      endMs: Date.UTC(2024, 2, 31),
      monthlyCost: 100,
    });
    await seedInsuranceTermVehicle(testDb.sql, { termId: 't1', vehicleId: 'veh-1' });

    const result = await repo.getInsurance(USER);
    expect(result.monthlyPremiumTrend).toEqual([
      { month: '2024-01', premiums: 100 },
      { month: '2024-02', premiums: 100 },
      { month: '2024-03', premiums: 100 },
    ]);
  });

  test('overlapping policies SUM their premiums in the shared months', async () => {
    await policy('p1', 'GEICO');
    await policy('p2', 'Allstate');
    await termSeconds({
      id: 't1',
      policyId: 'p1',
      startMs: Date.UTC(2024, 0, 10),
      endMs: Date.UTC(2024, 1, 20),
      monthlyCost: 100,
    });
    await termSeconds({
      id: 't2',
      policyId: 'p2',
      startMs: Date.UTC(2024, 1, 5),
      endMs: Date.UTC(2024, 2, 5),
      monthlyCost: 30,
    });
    await seedInsuranceTermVehicle(testDb.sql, { termId: 't1', vehicleId: 'veh-1' });
    await seedInsuranceTermVehicle(testDb.sql, { termId: 't2', vehicleId: 'veh-1' });

    const result = await repo.getInsurance(USER);
    const byMonth = new Map(result.monthlyPremiumTrend.map((p) => [p.month, p.premiums]));
    expect(byMonth.get('2024-01')).toBeCloseTo(100, 2);
    expect(byMonth.get('2024-02')).toBeCloseTo(130, 2);
    expect(result.monthlyPremiumTrend.map((p) => p.month)).toEqual(['2024-01', '2024-02']);
  });

  test('a six-month term ending on its anniversary day charges six months, not seven', async () => {
    await policy('p1', 'GEICO');
    await termSeconds({
      id: 't1',
      policyId: 'p1',
      startMs: Date.UTC(2024, 0, 1, 12),
      endMs: Date.UTC(2024, 6, 1, 12),
      totalCost: 600,
    });
    await seedInsuranceTermVehicle(testDb.sql, { termId: 't1', vehicleId: 'veh-1' });

    const result = await repo.getInsurance(USER);
    expect(result.monthlyPremiumTrend.map((p) => p.month)).toEqual([
      '2024-01',
      '2024-02',
      '2024-03',
      '2024-04',
      '2024-05',
      '2024-06',
    ]);
  });

  test('a totalCost-only term spreads its AMORTIZED monthly premium across each spanned month', async () => {
    await policy('p1', 'GEICO');
    await termSeconds({
      id: 't1',
      policyId: 'p1',
      startMs: Date.UTC(2024, 0, 1),
      endMs: Date.UTC(2024, 2, 31),
      totalCost: 300,
    });
    await seedInsuranceTermVehicle(testDb.sql, { termId: 't1', vehicleId: 'veh-1' });

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
    await policy('p1', 'GEICO');
    await term({
      id: 't1',
      policyId: 'p1',
      startMs: now - 30 * MS_DAY,
      endMs: now + 335 * MS_DAY,
      monthlyCost: 100,
    });
    await seedInsuranceTermVehicle(testDb.sql, { termId: 't1', vehicleId: 'veh-1' });

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

describe('getInsurance — month buckets do not depend on the server timezone', () => {
  const originalTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  afterEach(() => {
    process.env.TZ = originalTz;
  });

  for (const tz of ['America/Los_Angeles', 'Pacific/Auckland']) {
    test(`a Jan–Mar term charts Jan, Feb and Mar with TZ=${tz}`, async () => {
      process.env.TZ = tz;
      await policy('p1', 'GEICO');
      await termSeconds({
        id: 't1',
        policyId: 'p1',
        startMs: Date.UTC(2024, 0, 1),
        endMs: Date.UTC(2024, 2, 31),
        monthlyCost: 100,
      });
      await seedInsuranceTermVehicle(testDb.sql, { termId: 't1', vehicleId: 'veh-1' });

      const result = await repo.getInsurance(USER);
      expect(result.monthlyPremiumTrend.map((p) => p.month)).toEqual([
        '2024-01',
        '2024-02',
        '2024-03',
      ]);
    });
  }
});
