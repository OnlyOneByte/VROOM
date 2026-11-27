import { Database } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { centsToMinorUnits } from '../../api/sync/backup';
import SHARED_CURRENCIES from '../../shared-currencies.json';
import { applyMigration, applyMigrationsUpTo, loadMigrations } from './migration-helpers';

const migrations = loadMigrations();
const money = migrations[28];

function seedUser(db: Database, id: string, currency: string): void {
  db.run(`INSERT INTO users (id, email, display_name) VALUES ('${id}', '${id}@x.test', '${id}')`);
  db.run(`INSERT INTO user_preferences (user_id, currency_unit) VALUES ('${id}', '${currency}')`);
  db.run(
    `INSERT INTO vehicles (id, user_id, make, model, year, purchase_price) VALUES ('${id}-v', '${id}', 'M', 'X', 2020, 2500050)`
  );
  db.run(
    `INSERT INTO vehicle_financing (id, vehicle_id, provider, original_amount, term_months, start_date, payment_amount, residual_value) VALUES ('${id}-f', '${id}-v', 'Bank', 1000000, 36, 1700000000, 37286, 149)`
  );
  db.run(`INSERT INTO insurance_policies (id, user_id, company) VALUES ('${id}-p', '${id}', 'Co')`);
  db.run(
    `INSERT INTO insurance_terms (id, policy_id, start_date, end_date, total_cost, monthly_cost) VALUES ('${id}-t', '${id}-p', 1700000000, 1730000000, 120000, 10050)`
  );
  db.run(
    `INSERT INTO insurance_claims (id, policy_id, claim_date, claim_type, payout_amount) VALUES ('${id}-c', '${id}-p', 1700000000, 'collision', 99949)`
  );
  const expense = (eid: string, amount: number, group = 'NULL', total = 'NULL') =>
    db.run(
      `INSERT INTO expenses (id, vehicle_id, user_id, category, date, expense_amount, group_id, group_total) VALUES ('${id}-${eid}', '${id}-v', '${id}', 'fuel', 1700000000, ${amount}, ${group}, ${total})`
    );
  expense('e1', 100000);
  expense('e2', 12345);
  expense('e3', 50);
  expense('g1', 3334, `'${id}-g'`, '10000');
  expense('g2', 3333, `'${id}-g'`, '10000');
  expense('g3', 3333, `'${id}-g'`, '10000');
  const split = JSON.stringify({
    method: 'absolute',
    allocations: [
      { vehicleId: 'a', amount: 3333 },
      { vehicleId: 'b', amount: 3334 },
      { vehicleId: 'c', amount: 3333 },
    ],
  });
  db.run(
    `INSERT INTO reminders (id, user_id, name, type, frequency, start_date, expense_amount, expense_split_config) VALUES ('${id}-r', '${id}', 'R', 'expense', 'monthly', 1700000000, 10000, '${split}')`
  );
  db.run(
    `INSERT INTO reminders (id, user_id, name, type, frequency, start_date, expense_amount, expense_split_config) VALUES ('${id}-r2', '${id}', 'R', 'expense', 'monthly', 1700000000, 5050, '{"method":"absolute"}')`
  );
}

function snapshot(db: Database, id: string) {
  const one = (q: string) => db.query(q).get() as Record<string, number | string | null>;
  return {
    expenses: db
      .query(
        `SELECT id, expense_amount, group_total FROM expenses WHERE user_id = '${id}' ORDER BY id`
      )
      .all() as { id: string; expense_amount: number; group_total: number | null }[],
    vehicle: one(`SELECT purchase_price FROM vehicles WHERE id = '${id}-v'`),
    financing: one(
      `SELECT original_amount, payment_amount, residual_value, excess_mileage_fee FROM vehicle_financing WHERE id = '${id}-f'`
    ),
    term: one(`SELECT total_cost, monthly_cost FROM insurance_terms WHERE id = '${id}-t'`),
    claim: one(`SELECT payout_amount FROM insurance_claims WHERE id = '${id}-c'`),
    reminder: one(
      `SELECT expense_amount, expense_split_config FROM reminders WHERE id = '${id}-r'`
    ),
    emptySplit: one(
      `SELECT expense_amount, expense_split_config FROM reminders WHERE id = '${id}-r2'`
    ),
  };
}

describe('Migration 0028: money in minor units for currencies without decimals', () => {
  let db: Database;

  beforeEach(() => {
    db = new Database(':memory:');
    db.run('PRAGMA foreign_keys = ON');
    applyMigrationsUpTo(db, migrations, 27);
    seedUser(db, 'jpy', 'JPY');
    seedUser(db, 'usd', 'USD');
  });

  afterEach(() => {
    db.close();
  });

  test('divides a yen user’s amounts by 100, rounding halves away from zero', () => {
    applyMigration(db, money);
    const jpy = snapshot(db, 'jpy');
    expect(jpy.vehicle.purchase_price).toBe(25001);
    expect(jpy.financing).toEqual({
      original_amount: 10000,
      payment_amount: 373,
      residual_value: 1,
      excess_mileage_fee: null,
    });
    expect(jpy.term).toEqual({ total_cost: 1200, monthly_cost: 101 });
    expect(jpy.claim.payout_amount).toBe(999);
    expect(jpy.expenses).toEqual([
      { id: 'jpy-e1', expense_amount: 1000, group_total: null },
      { id: 'jpy-e2', expense_amount: 123, group_total: null },
      { id: 'jpy-e3', expense_amount: 1, group_total: null },
      { id: 'jpy-g1', expense_amount: 34, group_total: 100 },
      { id: 'jpy-g2', expense_amount: 33, group_total: 100 },
      { id: 'jpy-g3', expense_amount: 33, group_total: 100 },
    ]);
  });

  test('split legs and reminder allocations still add up to the total', () => {
    db.run("UPDATE expenses SET expense_amount = 50, group_total = 200 WHERE id LIKE 'jpy-g%'");
    db.run(
      "INSERT INTO expenses (id, vehicle_id, user_id, category, date, expense_amount, group_id, group_total) VALUES ('jpy-g4', 'jpy-v', 'jpy', 'fuel', 1700000000, 50, 'jpy-g', 200)"
    );
    applyMigration(db, money);
    const legs = snapshot(db, 'jpy').expenses.filter((e) => String(e.id).includes('-g')) as {
      expense_amount: number;
    }[];
    expect(legs.map((l) => l.expense_amount)).toEqual([1, 1, 0, 0]);

    const reminder = snapshot(db, 'jpy').reminder;
    expect(reminder.expense_amount).toBe(100);
    expect(JSON.parse(String(reminder.expense_split_config))).toEqual({
      method: 'absolute',
      allocations: [
        { vehicleId: 'a', amount: 33 },
        { vehicleId: 'b', amount: 34 },
        { vehicleId: 'c', amount: 33 },
      ],
    });
  });

  test('breaks equal remainders by position for reminders', () => {
    const split = JSON.stringify({
      method: 'absolute',
      allocations: [
        { vehicleId: 'a', amount: 50 },
        { vehicleId: 'b', amount: 50 },
      ],
    });
    db.run(
      `UPDATE reminders SET expense_amount = 100, expense_split_config = '${split}' WHERE id = 'jpy-r'`
    );
    applyMigration(db, money);
    const config = JSON.parse(String(snapshot(db, 'jpy').reminder.expense_split_config));
    expect(config.allocations.map((a: { amount: number }) => a.amount)).toEqual([1, 0]);
  });

  test('leaves an absolute split without allocations as it was', () => {
    applyMigration(db, money);
    expect(snapshot(db, 'jpy').emptySplit).toEqual({
      expense_amount: 51,
      expense_split_config: '{"method":"absolute"}',
    });
  });

  test('changes nothing for a two-decimal currency', () => {
    const before = snapshot(db, 'usd');
    applyMigration(db, money);
    expect(snapshot(db, 'usd')).toEqual(before);
  });

  test('a second run divides nothing again', () => {
    applyMigration(db, money);
    const once = { jpy: snapshot(db, 'jpy'), usd: snapshot(db, 'usd') };
    applyMigration(db, money);
    expect({ jpy: snapshot(db, 'jpy'), usd: snapshot(db, 'usd') }).toEqual(once);
    expect(db.query('SELECT name FROM money_unit_migrations').all()).toEqual([
      { name: '0028_money_minor_units' },
    ]);
    expect(
      db.query("SELECT name FROM sqlite_temp_master WHERE name LIKE '__money%'").all()
    ).toEqual([]);
  });

  test('agrees with the 2.0.0 backup upgrade for a forint user', () => {
    seedUser(db, 'huf', 'HUF');
    db.run("UPDATE expenses SET expense_amount = -150 WHERE id = 'huf-e3'");
    db.run("UPDATE expenses SET expense_amount = 250 WHERE id = 'huf-e2'");
    const rows = (q: string) => db.query(q).all() as Record<string, unknown>[];
    const upgraded = centsToMinorUnits({
      userPreferences: [{ currencyUnit: 'HUF' }],
      expenses: rows(
        "SELECT id, group_id AS groupId, group_total AS groupTotal, expense_amount AS expenseAmount FROM expenses WHERE user_id = 'huf' ORDER BY id"
      ),
      vehicles: rows("SELECT purchase_price AS purchasePrice FROM vehicles WHERE user_id = 'huf'"),
      reminders: rows(
        "SELECT expense_amount AS expenseAmount, expense_split_config AS expenseSplitConfig FROM reminders WHERE id = 'huf-r'"
      ),
    });

    applyMigration(db, money);
    const migrated = snapshot(db, 'huf');
    expect(migrated.expenses.map((e) => (e as { expense_amount: number }).expense_amount)).toEqual(
      (upgraded.expenses ?? []).map((e) => Number(e.expenseAmount))
    );
    expect(migrated.vehicle.purchase_price).toBe(Number(upgraded.vehicles?.[0]?.purchasePrice));
    const reminder = upgraded.reminders?.[0];
    expect(migrated.reminder.expense_amount).toBe(Number(reminder?.expenseAmount));
    expect(JSON.parse(String(migrated.reminder.expense_split_config))).toEqual(
      JSON.parse(String(reminder?.expenseSplitConfig))
    );
    expect(migrated.expenses.map((e) => (e as { expense_amount: number }).expense_amount)).toEqual([
      1000, 3, -2, 34, 33, 33,
    ]);
  });

  test('lists exactly the supported currencies that have no decimals', () => {
    const listed = [...money.sql.matchAll(/'([A-Z]{3})'/g)].map((m) => m[1]).sort();
    expect(listed).toEqual([...SHARED_CURRENCIES.noDecimals].sort());
  });
});
