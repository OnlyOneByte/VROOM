import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { AnalyticsRepository } from '../repository';
import {
  seedExpense,
  seedUser,
  seedVehicle,
  openAnalyticsTestDb,
  type AnalyticsTestDb,
} from './analytics-test-db';
import {
  type TestExpense,
  yearToRange,
} from './analytics-test-generators';

let testDb: AnalyticsTestDb;
let repo: AnalyticsRepository;

const USER = { id: 'user-spend', email: 'spend@test.com', displayName: 'Spend' };
const GAS = { id: 'veh-gas', userId: USER.id, make: 'Honda', model: 'Civic', year: 2020 };
const EV = { id: 'veh-ev', userId: USER.id, make: 'Kia', model: 'Niro EV', year: 2022 };

beforeEach(async () => {
  testDb = await openAnalyticsTestDb();
  repo = new AnalyticsRepository(testDb.asyncDb);
  await seedUser(testDb.sql, USER);
  await seedVehicle(testDb.sql, GAS);
  await seedVehicle(testDb.sql, EV);
});

afterEach(() => {
  testDb.close();
});

function fuel(over: Partial<TestExpense> & Pick<TestExpense, 'id' | 'date'>): TestExpense {
  return {
    vehicleId: GAS.id,
    category: 'fuel',
    expenseAmount: 40,
    mileage: null,
    volume: 10,
    fuelType: 'Regular',
    missedFillup: false,
    ...over,
  };
}

async function seedSecondHalf(withCharging: boolean): Promise<void> {
  for (let month = 6; month < 12; month++) {
    await seedExpense(
      testDb.sql,
      fuel({ id: `g${month}`, date: new Date(Date.UTC(2024, month, 10)), expenseAmount: 4550 })
    );
    if (withCharging) {
      await seedExpense(
        testDb.sql,
        fuel({
          id: `c${month}`,
          vehicleId: EV.id,
          date: new Date(Date.UTC(2024, month, 12)),
          expenseAmount: 1450,
          volume: 40,
          fuelType: 'Level 2 (AC)',
        })
      );
    }
  }
}

describe('monthly fuel spend', () => {
  test('a mixed fleet splits fuel from charging, averaged from the first expense', async () => {
    await seedSecondHalf(true);
    const { monthlySpend } = await repo.getFuelStats(USER.id, yearToRange(2024));
    expect(monthlySpend?.months).toBe(6);
    expect(monthlySpend?.fuel).toBeCloseTo(4550, 9);
    expect(monthlySpend?.charging).toBeCloseTo(1450, 9);
  });

  test('a gas-only fleet has no charging figure', async () => {
    await seedSecondHalf(false);
    const { monthlySpend } = await repo.getFuelStats(USER.id, yearToRange(2024));
    expect(monthlySpend).toEqual({ months: 6, fuel: 4550, charging: null });
  });

  test('a month with no fill-up after the first one still counts', async () => {
    await seedExpense(testDb.sql, fuel({ id: 'g1', date: new Date(Date.UTC(2024, 9, 5)) }));
    await seedExpense(testDb.sql, fuel({ id: 'g2', date: new Date(Date.UTC(2024, 11, 5)) }));
    const { monthlySpend } = await repo.getFuelStats(USER.id, yearToRange(2024));
    expect(monthlySpend).toEqual({ months: 3, fuel: 80 / 3, charging: null });
  });

  test('a rolling year that starts mid-month counts as 12 months, not 13', async () => {
    for (let i = 0; i < 12; i++) {
      await seedExpense(
        testDb.sql,
        fuel({ id: `r${i}`, date: new Date(Date.UTC(2024, 2 + i, 16)), expenseAmount: 6000 })
      );
    }
    const range = {
      start: Math.floor(Date.UTC(2024, 2, 15) / 1000),
      end: Math.floor(Date.UTC(2025, 2, 16) / 1000),
    };
    const { monthlySpend } = await repo.getFuelStats(USER.id, range);
    expect(monthlySpend).toEqual({ months: 12, fuel: 6000, charging: null });
  });

  test('no fuel expenses give no figure', async () => {
    const { monthlySpend } = await repo.getFuelStats(USER.id, yearToRange(2024));
    expect(monthlySpend).toBeNull();
  });
});
