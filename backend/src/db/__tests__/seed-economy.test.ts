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
  'Model 3': [3.5, 4.5],
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
        outside: economy.filter((e) => e < low - 0.5 || e > high + 0.5),
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
});
