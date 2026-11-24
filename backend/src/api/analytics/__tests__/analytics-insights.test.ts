import { Database } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, setSystemTime, test } from 'bun:test';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import { applyMigrationsUpTo, loadMigrations } from '../../../db/__tests__/migration-helpers';
import * as schema from '../../../db/schema';
import {
  AnalyticsInsightsRepository,
  type Insight,
  isRoutineMaintenance,
  repairStreak,
  winterMonths,
  winterPenaltyPercent,
} from '../insights';
import { AnalyticsQueryRepository } from '../query-repository';
import {
  createTestDb,
  seedExpense,
  seedUser,
  seedVehicle,
  type TestDb,
} from './analytics-test-generators';

const seconds = (iso: string) => Math.floor(new Date(iso).getTime() / 1000);
const OWNER = { id: 'owner', email: 'owner@test.com', displayName: 'Owner' };
const CAMRY = { id: 'camry', userId: OWNER.id, make: 'Toyota', model: 'Camry', year: 2020 };
const LEAF = { id: 'leaf', userId: OWNER.id, make: 'Nissan', model: 'Leaf', year: 2022 };
const RANGE = { start: seconds('2025-01-01T00:00:00Z'), end: seconds('2026-01-01T00:00:00Z') };

let testDb: TestDb;
let repo: AnalyticsInsightsRepository;

function insights(overrides: Partial<{ start: number; end: number; timeZone: string }> = {}) {
  return repo.insights(OWNER.id, { ...RANGE, timeZone: 'UTC', ...overrides });
}

function find(list: Insight[], id: Insight['id']) {
  return list.find((i) => i.id === id);
}

let n = 0;
function expense(
  vehicleId: string,
  category: string,
  iso: string,
  cents: number,
  extra: Partial<{ mileage: number; volume: number; fuelType: string; description: string }> = {}
) {
  const id = `x-${n++}`;
  seedExpense(testDb.sqlite, {
    id,
    vehicleId,
    category,
    expenseAmount: cents,
    date: new Date(iso),
    mileage: extra.mileage ?? null,
    volume: extra.volume ?? null,
    fuelType: extra.fuelType ?? null,
    missedFillup: false,
  });
  if (extra.description) {
    testDb.sqlite.run('UPDATE expenses SET description = ? WHERE id = ?', [extra.description, id]);
  }
  return id;
}

function setPrefs(units: object, currency = 'USD') {
  const json = JSON.stringify({ chargeUnit: 'kwh', ...units });
  testDb.sqlite.run(
    'INSERT OR REPLACE INTO user_preferences (user_id, unit_preferences, currency_unit) VALUES (?, ?, ?)',
    [OWNER.id, json, currency]
  );
  testDb.sqlite.run('UPDATE vehicles SET unit_preferences = ?', [json]);
}

function setUnits(target: 'user' | 'cars', units: object, currency = 'USD') {
  const json = JSON.stringify({ chargeUnit: 'kwh', ...units });
  if (target === 'cars') {
    testDb.sqlite.run('UPDATE vehicles SET unit_preferences = ?', [json]);
    return;
  }
  testDb.sqlite.run(
    'INSERT OR REPLACE INTO user_preferences (user_id, unit_preferences, currency_unit) VALUES (?, ?, ?)',
    [OWNER.id, json, currency]
  );
}

const MILES = { distanceUnit: 'miles', volumeUnit: 'gallons_us' };
const METRIC = { distanceUnit: 'kilometers', volumeUnit: 'liters' };

function trip(vehicleId: string, iso: string, start: number, distance: number, purpose: string) {
  testDb.sqlite.run(
    'INSERT INTO trips (id, vehicle_id, user_id, start_odometer, end_odometer, purpose, trip_date) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [`t-${n++}`, vehicleId, OWNER.id, start, start + distance, purpose, seconds(iso)]
  );
}

beforeEach(() => {
  testDb = createTestDb();
  repo = new AnalyticsInsightsRepository(
    testDb.drizzle,
    new AnalyticsQueryRepository(testDb.drizzle)
  );
  seedUser(testDb.sqlite, OWNER);
  seedVehicle(testDb.sqlite, CAMRY);
  seedVehicle(testDb.sqlite, LEAF);
});

afterEach(() => testDb.sqlite.close());

describe('record month', () => {
  function seedMonths() {
    expense(CAMRY.id, 'maintenance', '2025-02-10T12:00:00Z', 10_000);
    expense(CAMRY.id, 'maintenance', '2025-03-10T12:00:00Z', 20_000);
    expense(CAMRY.id, 'maintenance', '2025-06-03T12:00:00Z', 30_000, { description: 'Brake pads' });
    expense(LEAF.id, 'misc', '2025-06-20T12:00:00Z', 5_000);
  }

  test('names the costliest month and its largest expense', async () => {
    seedMonths();
    const record = find(await insights(), 'recordMonth');
    expect(record?.value).toBe(350);
    expect(record?.unit).toBe('money');
    expect(record?.sentence).toBe(
      'June 2025 had the highest running costs in this period. The largest expense was Brake pads on the 2020 Toyota Camry ($300.00).'
    );
    expect(record?.query).toEqual({
      metric: 'cost',
      per: 'month',
      split: 'category',
      sel: '2025-06',
    });
  });

  test('counts running costs, as the chart does by default', async () => {
    seedMonths();
    expense(CAMRY.id, 'financial', '2025-03-01T12:00:00Z', 120_000, { description: 'Insurance' });
    const record = find(await insights(), 'recordMonth');
    expect(record?.value).toBe(350);
    expect(record?.sentence).not.toContain('Insurance');
  });

  test('needs three months with costs', async () => {
    expense(CAMRY.id, 'maintenance', '2025-02-10T12:00:00Z', 10_000);
    expense(CAMRY.id, 'maintenance', '2025-03-10T12:00:00Z', 20_000);
    expect(find(await insights(), 'recordMonth')).toBeUndefined();
  });

  test('writes money in the user currency', async () => {
    seedMonths();
    setPrefs({ distanceUnit: 'kilometers', volumeUnit: 'liters' }, 'EUR');
    expect(find(await insights(), 'recordMonth')?.sentence).toContain('€300.00');
  });
});

describe('repair-free streak', () => {
  const END = seconds('2025-12-01T00:00:00Z');
  beforeEach(() => setSystemTime(new Date('2025-12-01T00:00:00Z')));
  afterEach(() => setSystemTime());

  test('counts days since the last repair, skipping routine work', async () => {
    expense(CAMRY.id, 'maintenance', '2025-01-01T00:00:00Z', 40_000, { description: 'Alternator' });
    expense(CAMRY.id, 'maintenance', '2025-07-04T00:00:00Z', 30_000, { description: 'Brake pads' });
    expense(CAMRY.id, 'maintenance', '2025-10-01T00:00:00Z', 7_000, { description: 'Oil change' });
    const streak = find(await insights({ end: END }), 'repairFree');
    expect(streak?.value).toBe(150);
    expect(streak?.sentence).toContain('2020 Toyota Camry: no repairs since Jul 4, 2025.');
    expect(streak?.sentence).toContain('Its longest stretch was 184 days.');
    expect(streak?.query).toMatchObject({ cars: CAMRY.id, range: 'all' });
  });

  test('says nothing for a range that ended in the past', async () => {
    expense(CAMRY.id, 'maintenance', '2025-01-01T00:00:00Z', 40_000, { description: 'Alternator' });
    expect(
      find(await insights({ end: seconds('2025-09-01T00:00:00Z') }), 'repairFree')
    ).toBeUndefined();
  });

  test('says nothing without a repair, or right after one', async () => {
    expense(CAMRY.id, 'maintenance', '2025-03-01T00:00:00Z', 7_000, { description: 'Oil change' });
    expect(find(await insights({ end: END }), 'repairFree')).toBeUndefined();
    expense(CAMRY.id, 'maintenance', '2025-11-20T00:00:00Z', 30_000, { description: 'Brake pads' });
    expect(find(await insights({ end: END }), 'repairFree')).toBeUndefined();
  });

  test('routine work is known by tag or by words', () => {
    expect(isRoutineMaintenance(['oil-change'], 'Shop visit')).toBe(true);
    expect(isRoutineMaintenance(null, 'Tire rotation and balance')).toBe(true);
    expect(isRoutineMaintenance(['brakes'], 'New rotors')).toBe(false);
    expect(isRoutineMaintenance(null, 'Fix oil leak')).toBe(false);
    expect(isRoutineMaintenance(null, 'Washer pump')).toBe(false);
    expect(isRoutineMaintenance(null, 'Car wash')).toBe(true);
    expect(isRoutineMaintenance(null, 'Tire rotations')).toBe(true);
    expect(repairStreak([], 0)).toBeNull();
  });
});

describe('winter penalty', () => {
  function seedCharges(years: number[], winter: number[]) {
    testDb.sqlite.run("UPDATE vehicles SET vehicle_type = 'electric' WHERE id = ?", [LEAF.id]);
    let odometer = 1_000;
    for (const year of years) {
      for (let month = 1; month <= 12; month++) {
        for (const day of ['05', '20']) {
          odometer += winter.includes(month) ? 90 : 120;
          const iso = `${year}-${String(month).padStart(2, '0')}-${day}T12:00:00Z`;
          expense(LEAF.id, 'fuel', iso, 900, {
            mileage: odometer,
            volume: 30,
            fuelType: 'Level 2 (AC)',
          });
        }
      }
    }
  }

  test('compares the three coldest months with the rest over two winters', async () => {
    seedCharges([2024, 2025], [12, 1, 2]);
    const winter = find(await insights(), 'winterPenalty');
    expect(winter?.value).toBe(33);
    expect(winter?.sentence).toBe(
      '2022 Nissan Leaf uses 33% more kWh per mile in Dec, Jan, Feb than in the rest of the year.'
    );
    expect(winter?.query).toMatchObject({ metric: 'evEfficiency', cars: LEAF.id });
  });

  test('a southern time zone uses June to August', async () => {
    expect(winterMonths('Australia/Sydney')).toEqual([6, 7, 8]);
    seedCharges([2024, 2025], [6, 7, 8]);
    const winter = find(await insights({ timeZone: 'Australia/Sydney' }), 'winterPenalty');
    expect(winter?.sentence).toContain('in Jun, Jul, Aug');
  });

  test('needs two winters, and says per km in metric', async () => {
    seedCharges([2025], [12, 1, 2]);
    expect(find(await insights(), 'winterPenalty')).toBeUndefined();
    seedCharges([2024], [12, 1, 2]);
    setPrefs({ distanceUnit: 'kilometers', volumeUnit: 'liters' });
    expect(find(await insights(), 'winterPenalty')?.sentence).toContain('more kWh per km');
  });

  test('a winter counts once it has two of its three months', () => {
    const months = ['2024-04', '2024-05', '2024-06'];
    const oneWinter = ['2024-01', '2024-02', '2024-12', ...months];
    expect(winterPenaltyPercent(oneWinter, [3, 3, 3, 4, 4, 4], [12, 1, 2])).toBeNull();
    const twoWinters = ['2023-12', '2024-01', '2024-12', '2025-01', ...months];
    expect(winterPenaltyPercent(twoWinters, [3, 3, 3, 3, 4, 4, 4], [12, 1, 2])).toBe(33);
  });
});

describe('cost per trip', () => {
  function seedTrips(count: number) {
    expense(CAMRY.id, 'fuel', '2025-03-01T12:00:00Z', 4_000, {
      mileage: 10_000,
      volume: 10,
      fuelType: 'Regular',
    });
    expense(CAMRY.id, 'fuel', '2025-09-01T12:00:00Z', 4_000, {
      mileage: 11_000,
      volume: 10,
      fuelType: 'Regular',
    });
    const distances = [10, 20, 30];
    for (let i = 0; i < count; i++) {
      trip(
        CAMRY.id,
        `2025-0${4 + i}-10T12:00:00Z`,
        10_100 + i * 100,
        distances[i] ?? 10,
        i === 2 ? 'business' : 'personal'
      );
    }
  }

  test('multiplies cost per mile by the average trip', async () => {
    seedTrips(3);
    const trip = find(await insights(), 'costPerTrip');
    expect(trip?.value).toBe(1.6);
    expect(trip?.sentence).toBe(
      'Your average trip is 20 mi, at $0.08 per mile in running costs. 50% of trip distance was for business.'
    );
  });

  test('needs three trips', async () => {
    seedTrips(2);
    expect(find(await insights(), 'costPerTrip')).toBeUndefined();
  });

  test('uses kilometres when the user does', async () => {
    seedTrips(3);
    setPrefs({ distanceUnit: 'kilometers', volumeUnit: 'liters' });
    expect(find(await insights(), 'costPerTrip')?.sentence).toContain('Your average trip is 20 km');
  });

  test('converts a car in kilometres for a user in miles', async () => {
    seedTrips(3);
    setUnits('cars', METRIC);
    setUnits('user', MILES);
    const trip = find(await insights(), 'costPerTrip');
    expect(trip?.value).toBe(1.6);
    expect(trip?.sentence).toContain('Your average trip is 12 mi, at $0.13 per mile');
  });

  test('writes money in the user currency', async () => {
    seedTrips(3);
    setUnits('user', MILES, 'EUR');
    expect(find(await insights(), 'costPerTrip')?.sentence).toContain('€0.08 per mile');
  });
});

describe('cheapest station', () => {
  function fillAt(location: string, count: number, cents: number, fuelType = 'Regular') {
    for (let i = 0; i < count; i++) {
      const id = expense(CAMRY.id, 'fuel', `2025-0${1 + i}-15T12:00:00Z`, cents, {
        volume: 10,
        fuelType,
      });
      testDb.sqlite.run('UPDATE expenses SET location = ? WHERE id = ?', [location, id]);
    }
  }

  test('finds the lowest average price with three fill-ups', async () => {
    fillAt('Costco', 3, 3_000);
    fillAt('Shell', 3, 4_000);
    const station = find(await insights(), 'cheapestStation');
    expect(station?.value).toBe(3);
    expect(station?.unit).toBe('moneyPerVolume');
    expect(station?.sentence).toBe(
      'Costco averaged $3.00 per gallon of Regular over 3 fill-ups, $1.00 less than your other stations.'
    );
  });

  test('needs three fill-ups at the station and elsewhere', async () => {
    fillAt('Costco', 2, 3_000);
    fillAt('Shell', 3, 4_000);
    expect(find(await insights(), 'cheapestStation')).toBeUndefined();
  });

  test('a saving under 2% is not worth a card', async () => {
    fillAt('Costco', 3, 3_950);
    fillAt('Shell', 3, 4_000);
    expect(find(await insights(), 'cheapestStation')).toBeUndefined();
  });

  test('compares stations only within one fuel grade', async () => {
    fillAt('Costco', 3, 3_000);
    fillAt('Arco', 3, 3_050);
    fillAt('Shell', 3, 5_000, 'Premium');
    expect(find(await insights(), 'cheapestStation')).toBeUndefined();
  });

  test('converts a car in liters for a user in gallons, in the user currency', async () => {
    fillAt('Costco', 3, 3_000);
    fillAt('Shell', 3, 4_000);
    setUnits('cars', METRIC);
    setUnits('user', MILES, 'EUR');
    expect(find(await insights(), 'cheapestStation')?.sentence).toContain(
      'Costco averaged €11.36 per gallon of Regular'
    );
  });

  test('prices per liter when the user does', async () => {
    fillAt('Costco', 3, 3_000);
    fillAt('Shell', 3, 4_000);
    setPrefs({ distanceUnit: 'kilometers', volumeUnit: 'liters' });
    expect(find(await insights(), 'cheapestStation')?.sentence).toContain('per liter');
  });
});

describe('insights scope', () => {
  test("another user's cars give nothing", async () => {
    seedUser(testDb.sqlite, { id: 'stranger', email: 's@test.com', displayName: 'S' });
    expense(CAMRY.id, 'maintenance', '2025-02-10T12:00:00Z', 10_000);
    expense(CAMRY.id, 'maintenance', '2025-03-10T12:00:00Z', 20_000);
    expense(CAMRY.id, 'maintenance', '2025-06-03T12:00:00Z', 30_000);
    const list = await repo.insights('stranger', { ...RANGE, timeZone: 'UTC' });
    expect(list).toEqual([]);
    const forced = await repo.insights('stranger', {
      ...RANGE,
      timeZone: 'UTC',
      vehicleIds: [CAMRY.id],
    });
    expect(forced).toEqual([]);
  });
});

const PERF_START = Date.UTC(2018, 0, 1) / 1000;
const PERF_SPAN = 8 * 365 * 86_400;
const PERF_ROWS_PER_CAR = 3_334;

function perfRow(v: number, i: number): Array<string | number | null> {
  const fuel = i % 3 !== 0;
  const fuelType = v === 0 ? 'Level 2 (AC)' : 'Regular';
  return [
    `perf-${v}-${i}`,
    `perf-${v}`,
    fuel ? 'fuel' : 'maintenance',
    1_000 + (i % 500),
    Math.floor(PERF_START + (PERF_SPAN * i) / PERF_ROWS_PER_CAR),
    fuel ? 1_000 + i * 30 : null,
    fuel ? 10 : null,
    fuel ? fuelType : null,
    fuel ? `Station ${i % 7}` : null,
  ];
}

function seedPerfFleet(sqlite: Database): void {
  sqlite.run("INSERT INTO users (id, email, display_name) VALUES ('perf', 'p@test.com', 'P')");
  const insert = sqlite.prepare(
    "INSERT INTO expenses (id, vehicle_id, user_id, category, expense_amount, date, mileage, volume, fuel_type, location, missed_fillup) VALUES (?, ?, 'perf', ?, ?, ?, ?, ?, ?, ?, 0)"
  );
  sqlite.transaction(() => {
    for (let v = 0; v < 3; v++) {
      sqlite.run(
        "INSERT INTO vehicles (id, user_id, make, model, year, vehicle_type) VALUES (?, 'perf', 'Make', 'Model', 2017, ?)",
        [`perf-${v}`, v === 0 ? 'electric' : 'gas']
      );
      for (let i = 0; i < PERF_ROWS_PER_CAR; i++) insert.run(...perfRow(v, i));
    }
  })();
}

describe('insights performance guard', () => {
  test('a 10k-expense fleet answers in under 120 ms', async () => {
    const sqlite = new Database(':memory:');
    const migrations = loadMigrations();
    applyMigrationsUpTo(sqlite, migrations, migrations.length - 1);
    const db = drizzle(sqlite, { schema });
    seedPerfFleet(sqlite);
    const perf = new AnalyticsInsightsRepository(db, new AnalyticsQueryRepository(db));
    const end = PERF_START + PERF_SPAN;
    const query = { start: end - 365 * 86_400, end, timeZone: 'UTC' };
    await perf.insights('perf', query);
    const began = performance.now();
    const list = await perf.insights('perf', query);
    const elapsed = performance.now() - began;
    sqlite.close();
    expect(list.length).toBeGreaterThan(0);
    expect(elapsed).toBeLessThan(120);
  });
});
