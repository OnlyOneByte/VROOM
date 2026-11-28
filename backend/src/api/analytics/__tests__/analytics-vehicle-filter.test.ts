import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { AnalyticsRepository } from '../repository';
import {
  seedExpense,
  seedInsurancePolicy,
  seedInsuranceTermVehicle,
  seedUser,
  seedVehicle,
  seedVehicleFinancing,
  openAnalyticsTestDb,
  type AnalyticsTestDb,
} from './analytics-test-db';

const OWNER = { id: 'owner', email: 'o@test.com', displayName: 'O' };
const STRANGER = { id: 'stranger', email: 's@test.com', displayName: 'S' };
const CIVIC = { id: 'civic', userId: OWNER.id, make: 'Honda', model: 'Civic', year: 2019 };
const RAV4 = { id: 'rav4', userId: OWNER.id, make: 'Toyota', model: 'RAV4', year: 2022 };
const FORD = { id: 'ford', userId: STRANGER.id, make: 'Ford', model: 'F-150', year: 2020 };
const RANGE = {
  start: Date.UTC(2024, 0, 1) / 1000,
  end: Date.UTC(2025, 0, 1) / 1000,
};
const DAY = 86_400_000;

let testDb: AnalyticsTestDb;
let repo: AnalyticsRepository;

async function fillUps(vehicleId: string, amount: number, startMileage: number): Promise<void> {
  for (let i = 0; i < 6; i++) {
    await seedExpense(testDb.sql, {
      id: `${vehicleId}-fuel-${i}`,
      vehicleId,
      category: 'fuel',
      expenseAmount: amount,
      date: new Date(Date.UTC(2024, i * 2, 10)),
      mileage: startMileage + i * 300,
      volume: 10,
      fuelType: 'Regular',
      missedFillup: false,
    });
  }
  await seedExpense(testDb.sql, {
    id: `${vehicleId}-service`,
    vehicleId,
    category: 'maintenance',
    expenseAmount: amount * 3,
    date: new Date(Date.UTC(2024, 5, 20)),
    mileage: null,
    volume: null,
    fuelType: null,
    missedFillup: false,
  });
}

beforeEach(async () => {
  testDb = await openAnalyticsTestDb();
  repo = new AnalyticsRepository(testDb.asyncDb);
  for (const user of [OWNER, STRANGER]) await seedUser(testDb.sql, user);
  for (const vehicle of [CIVIC, RAV4, FORD]) await seedVehicle(testDb.sql, vehicle);
  await fillUps(CIVIC.id, 4_000, 10_000);
  await fillUps(RAV4.id, 6_000, 30_000);
  await fillUps(FORD.id, 9_000, 50_000);
});

afterEach(() => testDb.close());

describe('the car filter narrows every fleet endpoint', () => {
  test('summary counts only the picked cars', async () => {
    const all = await repo.getSummary(OWNER.id, RANGE);
    const civic = await repo.getSummary(OWNER.id, RANGE, undefined, undefined, [CIVIC.id]);
    expect(all.quickStats.vehicleCount).toBe(2);
    expect(civic.quickStats.vehicleCount).toBe(1);
    expect(civic.quickStats.ytdSpending).toBe(6 * 4_000 + 12_000);
    expect(civic.fuelStats.fillupCostByVehicle.every((r) => r.vehicleId === CIVIC.id)).toBe(true);
    expect(civic.fuelAdvanced.vehicleRadar.map((r) => r.vehicleId)).toEqual([CIVIC.id]);
  });

  test('fuel stats and fuel patterns take a car list', async () => {
    const stats = await repo.getFuelStats(OWNER.id, RANGE, [CIVIC.id, FORD.id]);
    expect(stats.fillupCostByVehicle.every((r) => r.vehicleId === CIVIC.id)).toBe(true);
    const advanced = await repo.getFuelAdvanced(OWNER.id, RANGE, [RAV4.id]);
    expect(advanced.vehicleRadar.map((r) => r.vehicleId)).toEqual([RAV4.id]);
  });

  test('cross-vehicle keeps the picked cars and drops the rest', async () => {
    const both = await repo.getCrossVehicle(OWNER.id, RANGE, undefined, [CIVIC.id, RAV4.id]);
    const rav4 = await repo.getCrossVehicle(OWNER.id, RANGE, undefined, [RAV4.id]);
    expect(both.vehicleCostComparison.map((v) => v.vehicleId).sort()).toEqual([CIVIC.id, RAV4.id]);
    expect(rav4.vehicleCostComparison).toEqual([
      expect.objectContaining({ vehicleId: RAV4.id, totalCost: 6 * 6_000 + 18_000 }),
    ]);
    expect(rav4.expenseByCategory.reduce((sum, c) => sum + c.amount, 0)).toBe(54_000);
  });

  test("another user's car in the filter is never counted, and alone it matches nothing", async () => {
    const mixed = await repo.getCrossVehicle(OWNER.id, RANGE, undefined, [CIVIC.id, FORD.id]);
    expect(mixed.vehicleCostComparison.map((v) => v.vehicleId)).toEqual([CIVIC.id]);
    const foreign = await repo.getSummary(OWNER.id, RANGE, undefined, undefined, [FORD.id]);
    expect(foreign.quickStats.vehicleCount).toBe(0);
    expect(foreign.quickStats.ytdSpending).toBe(0);
    const none = await repo.getCrossVehicle(OWNER.id, RANGE, undefined, []);
    expect(none.monthlyExpenseTrends).toEqual([]);
  });

  test('financing follows the car filter', async () => {
    await seedVehicleFinancing(testDb.sql, {
      id: 'loan',
      vehicleId: RAV4.id,
      financingType: 'loan',
      provider: 'Bank',
      originalAmount: 2_000_000,
      apr: 5,
      termMonths: 60,
      startDate: new Date(Date.now() - 90 * DAY),
      paymentAmount: 40_000,
      isActive: true,
    });
    const civic = await repo.getFinancing(OWNER.id, undefined, [CIVIC.id]);
    expect(civic.summary.totalMonthlyPayments).toBe(0);
    expect(civic.vehicleDetails.map((v) => v.vehicleId)).toEqual([CIVIC.id]);
    const rav4 = await repo.getFinancing(OWNER.id, undefined, [RAV4.id]);
    expect(rav4.summary.totalMonthlyPayments).toBe(40_000);
    expect(rav4.summary.loanCount).toBe(1);
  });

  test('a policy covering two cars counts only the picked share', async () => {
    await seedInsurancePolicy(testDb.sql, {
      id: 'pol',
      userId: OWNER.id,
      company: 'Acme',
      isActive: true,
    });
    await testDb.sql.run(
      'INSERT INTO insurance_terms (id, policy_id, start_date, end_date, monthly_cost) VALUES (?, ?, ?, ?, ?)',
      [
        'term',
        'pol',
        Math.floor((Date.now() - 30 * DAY) / 1000),
        Math.floor((Date.now() + 300 * DAY) / 1000),
        20_000,
      ]
    );
    for (const vehicleId of [CIVIC.id, RAV4.id]) {
      await seedInsuranceTermVehicle(testDb.sql, { termId: 'term', vehicleId });
    }
    const all = await repo.getInsurance(OWNER.id);
    expect(all.summary.totalMonthlyPremiums).toBe(20_000);
    const civic = await repo.getInsurance(OWNER.id, undefined, [CIVIC.id]);
    expect(civic.summary.totalMonthlyPremiums).toBe(10_000);
    expect(civic.summary.activePoliciesCount).toBe(1);
    expect(civic.vehicleDetails).toEqual([
      expect.objectContaining({ vehicleId: CIVIC.id, monthlyPremium: 10_000 }),
    ]);
    expect(civic.costByCarrier).toEqual([
      { carrier: 'Acme', annualPremium: 120_000, vehicleCount: 1 },
    ]);
    const trendTotal = (data: typeof all) =>
      data.monthlyPremiumTrend.reduce((sum, m) => sum + m.premiums, 0);
    expect(trendTotal(civic)).toBe(trendTotal(all) / 2);
    const none = await repo.getInsurance(OWNER.id, undefined, [FORD.id]);
    expect(none.summary).toEqual({
      totalMonthlyPremiums: 0,
      totalAnnualPremiums: 0,
      activePoliciesCount: 0,
    });
    expect(none.monthlyPremiumTrend).toEqual([]);
  });
});
