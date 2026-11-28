import type { AsyncAppDatabase } from '../../../db/async-sqlite';
import { openAsyncDatabase } from '../../../db/async-sqlite';
import { ON_POSTGRES, openPostgresTestDatabase } from '../../../test-helpers/http-client';
import { pgliteTestSql, sqliteTestSql, type TestSql } from '../../../test-helpers/test-sql';
import {
  createTestDb,
  type TestExpense,
  type TestInsurancePolicy,
  type TestInsuranceTermVehicle,
  type TestUser,
  type TestVehicle,
  type TestVehicleFinancing,
} from './analytics-test-generators';

export interface AnalyticsTestDb {
  sql: TestSql;
  asyncDb: AsyncAppDatabase;
  close: () => void;
}

export async function openAnalyticsTestDb(): Promise<AnalyticsTestDb> {
  if (ON_POSTGRES) {
    const client = await openPostgresTestDatabase();
    const { appContext } = await import('../../../app-context');
    return { sql: pgliteTestSql(client), asyncDb: appContext().asyncDb, close: () => {} };
  }
  const { sqlite } = createTestDb();
  return {
    sql: sqliteTestSql(sqlite),
    asyncDb: openAsyncDatabase(sqlite).db,
    close: () => sqlite.close(),
  };
}

const epochSeconds = (date: Date, id: string): number => {
  const seconds = Math.floor(date.getTime() / 1000);
  if (Number.isNaN(seconds)) throw new Error(`Invalid date for ${id}: ${date}`);
  return seconds;
};

export async function seedUser(sql: TestSql, user: TestUser): Promise<void> {
  await sql.run('INSERT INTO users (id, email, display_name) VALUES (?, ?, ?)', [
    user.id,
    user.email,
    user.displayName,
  ]);
}

export async function seedVehicle(sql: TestSql, vehicle: TestVehicle): Promise<void> {
  await sql.run('INSERT INTO vehicles (id, user_id, make, model, year) VALUES (?, ?, ?, ?, ?)', [
    vehicle.id,
    vehicle.userId,
    vehicle.make,
    vehicle.model,
    vehicle.year,
  ]);
}

export async function seedExpense(sql: TestSql, expense: TestExpense): Promise<void> {
  const date = epochSeconds(expense.date, `expense ${expense.id}`);
  const owner = expense.userId
    ? null
    : await sql.get<{ user_id: string }>('SELECT user_id FROM vehicles WHERE id = ?', [
        expense.vehicleId,
      ]);
  await sql.run(
    'INSERT INTO expenses (id, vehicle_id, user_id, category, expense_amount, date, mileage, volume, fuel_type, missed_fillup) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [
      expense.id,
      expense.vehicleId,
      expense.userId || (owner?.user_id ?? 'unknown'),
      expense.category,
      expense.expenseAmount,
      date,
      expense.mileage,
      expense.volume,
      expense.fuelType,
      expense.missedFillup,
    ]
  );
}

export async function seedInsurancePolicy(
  sql: TestSql,
  policy: TestInsurancePolicy
): Promise<void> {
  await sql.run(
    'INSERT INTO insurance_policies (id, user_id, company, is_active) VALUES (?, ?, ?, ?)',
    [policy.id, policy.userId, policy.company, policy.isActive]
  );
}

export async function seedVehicleFinancing(sql: TestSql, fin: TestVehicleFinancing): Promise<void> {
  await sql.run(
    'INSERT INTO vehicle_financing (id, vehicle_id, financing_type, provider, original_amount, apr, term_months, start_date, payment_amount, is_active) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [
      fin.id,
      fin.vehicleId,
      fin.financingType,
      fin.provider,
      fin.originalAmount,
      fin.apr,
      fin.termMonths,
      epochSeconds(fin.startDate, `financing ${fin.id}`),
      fin.paymentAmount,
      fin.isActive,
    ]
  );
}

export async function seedInsuranceTermVehicle(
  sql: TestSql,
  row: TestInsuranceTermVehicle
): Promise<void> {
  await sql.run('INSERT INTO insurance_term_vehicles (term_id, vehicle_id) VALUES (?, ?)', [
    row.termId,
    row.vehicleId,
  ]);
}
