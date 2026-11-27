import { Database } from 'bun:sqlite';
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const BACKEND = join(import.meta.dir, '../../..');
const VITALS_SEED = join(BACKEND, '../frontend/scripts/web-vitals-seed.mjs');

const BANDS: Record<string, [number, number]> = {
  Camry: [28, 34],
  Civic: [32, 38],
  Prius: [48, 55],
  'F-150': [17, 22],
  'Model 3': [3.6, 4.4],
};

interface Row {
  model: string;
  date: number;
  mileage: number;
  volume: number | null;
}

let dir = '';
let db: Database;

function run(args: string[]) {
  const result = Bun.spawnSync([process.execPath, '--env-file=/dev/null', ...args], {
    cwd: BACKEND,
    env: {
      PATH: process.env.PATH ?? '',
      DATABASE_URL: join(dir, 'seed.db'),
      LOG_LEVEL: 'error',
    },
  });
  if (result.exitCode !== 0) throw new Error(result.stderr.toString());
}

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'vroom-seed-'));
  run(['src/db/init.ts', '--seed']);
  run([VITALS_SEED]);
  db = new Database(join(dir, 'seed.db'), { readonly: true });
}, 120_000);

afterAll(() => {
  db?.close();
  rmSync(dir, { recursive: true, force: true });
});

function rowsByModel(sql: string): Map<string, Row[]> {
  const byModel = new Map<string, Row[]>();
  for (const row of db.query(sql).all() as Row[]) {
    byModel.set(row.model, [...(byModel.get(row.model) ?? []), row]);
  }
  return byModel;
}

describe('the seeded garage, after the web-vitals seed', () => {
  test('every car fills up inside its own economy band', () => {
    const fills = rowsByModel(
      `select v.model, e.date, e.mileage, e.volume from expenses e join vehicles v on v.id = e.vehicle_id
       where e.category = 'fuel' and e.volume > 0 and e.mileage is not null order by v.model, e.date, e.mileage`
    );
    expect([...fills.keys()].sort()).toEqual(Object.keys(BANDS).sort());
    for (const [model, rows] of fills) {
      const [low, high] = BANDS[model] as [number, number];
      const economy = rows
        .slice(1)
        .map((row, i) => (row.mileage - (rows[i] as Row).mileage) / (row.volume as number));
      expect(economy.length).toBeGreaterThan(10);
      expect({
        model,
        outside: economy.filter((e) => e < low * 0.99 || e > high * 1.01),
      }).toEqual({
        model,
        outside: [],
      });
    }
  });

  test('no car has an odometer that goes backwards', () => {
    const readings = rowsByModel(
      `select v.model, e.date, e.mileage, null as volume from expenses e join vehicles v on v.id = e.vehicle_id
       where e.mileage is not null
       union all
       select v.model, o.recorded_at, o.odometer, null from odometer_entries o join vehicles v on v.id = o.vehicle_id
       order by 1, 2, 3`
    );
    for (const [model, rows] of readings) {
      const drops = rows.slice(1).filter((row, i) => row.mileage < (rows[i] as Row).mileage);
      expect({ model, drops: drops.length }).toEqual({ model, drops: 0 });
    }
  });

  test('no car has a reading below its starting mileage, or an expense from before it was bought', () => {
    const early = db
      .query(
        `select v.model,
           (select count(*) from expenses e where e.vehicle_id = v.id and e.mileage < v.initial_mileage)
           + (select count(*) from odometer_entries o where o.vehicle_id = v.id and o.odometer < v.initial_mileage)
             as belowStart,
           (select count(*) from expenses e where e.vehicle_id = v.id and e.date < v.purchase_date) as beforePurchase
         from vehicles v order by v.model`
      )
      .all();
    expect(early).toEqual(
      Object.keys(BANDS)
        .sort()
        .map((model) => ({ model, belowStart: 0, beforePurchase: 0 }))
    );
  });

  test('charging sessions carry a valid charger type, and only charging sessions do', () => {
    const types = db
      .query(
        `select fuel_type as fuelType, charger_type as chargerType, count(*) as n from expenses
         where category = 'fuel' group by 1, 2 order by 1, 2`
      )
      .all();
    expect(types).toEqual([
      { fuelType: null, chargerType: null, n: expect.any(Number) },
      { fuelType: '87 (Regular)', chargerType: null, n: expect.any(Number) },
      { fuelType: 'DC Fast Charging', chargerType: 'dc_fast', n: expect.any(Number) },
      { fuelType: 'Level 2 (AC)', chargerType: 'home', n: expect.any(Number) },
    ]);
  });

  test('every car carries the perf load: about 1,000 fill-ups and 200 odometer readings', () => {
    const load = db
      .query(
        `select v.model,
           (select count(*) from expenses e where e.vehicle_id = v.id and e.category = 'fuel') as fills,
           (select count(*) from odometer_entries o where o.vehicle_id = v.id) as readings
         from vehicles v order by v.model`
      )
      .all() as { model: string; fills: number; readings: number }[];
    for (const car of load) {
      expect({ model: car.model, fills: car.fills >= 900, readings: car.readings }).toEqual({
        model: car.model,
        fills: true,
        readings: 200,
      });
    }
  });
});
