import { expect } from 'bun:test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { countRatchet } from '../test-helpers/debt-ratchet';

const SRC_ROOT = join(import.meta.dir, '..');

const OWNERS = new Set(['app-context.ts', 'db/connection.ts', 'db/seed.ts']);

const PATTERNS: Record<string, RegExp> = {
  'getDb()': /(?<!function )\bgetDb\(\)/g,
  'repository singleton':
    /^(?:export )?(?:const|let) \w+(?:\s*:[^=\n]+)?\s*=\s*new \w+Repository\(/gm,
};

const BASELINE: Record<string, number> = {
  'api/auth/demo.ts · getDb()': 2,
  'api/auth/routes.ts · getDb()': 8,
  'api/calendar/feed-events.ts · getDb()': 7,
  'api/calendar/routes.ts · getDb()': 6,
  'api/expenses/repository.ts · getDb()': 1,
  'api/expenses/repository.ts · repository singleton': 1,
  'api/financing/hooks.ts · getDb()': 1,
  'api/insurance/access.ts · getDb()': 1,
  'api/insurance/claims-repository.ts · getDb()': 1,
  'api/insurance/claims-repository.ts · repository singleton': 1,
  'api/insurance/repository.ts · getDb()': 1,
  'api/insurance/repository.ts · repository singleton': 1,
  'api/insurance/routes.ts · getDb()': 2,
  'api/odometer/routes.ts · getDb()': 1,
  'api/photos/photo-ref-repository.ts · getDb()': 1,
  'api/photos/photo-ref-repository.ts · repository singleton': 1,
  'api/photos/photo-repository.ts · getDb()': 1,
  'api/photos/photo-repository.ts · repository singleton': 1,
  'api/photos/receipt-drafts-route.ts · getDb()': 1,
  'api/providers/domains/llm/tools.ts · getDb()': 1,
  'api/providers/domains/storage/registry.ts · getDb()': 1,
  'api/providers/provider-status.ts · getDb()': 2,
  'api/providers/resolve.ts · getDb()': 2,
  'api/providers/routes.ts · getDb()': 7,
  'api/providers/services/google-sheets-service.ts · getDb()': 2,
  'api/reminders/routes.ts · getDb()': 3,
  'api/roles/routes.ts · getDb()': 20,
  'api/settings/repository.ts · getDb()': 2,
  'api/settings/repository.ts · repository singleton': 2,
  'api/settings/routes.ts · getDb()': 2,
  'api/shares/repository.ts · getDb()': 2,
  'api/shares/repository.ts · repository singleton': 1,
  'api/shares/routes.ts · getDb()': 8,
  'api/signup/routes.ts · getDb()': 9,
  'api/sync/activity-tracker.ts · getDb()': 1,
  'api/sync/backup-orchestrator.ts · getDb()': 2,
  'api/sync/backup.ts · getDb()': 5,
  'api/sync/restore.ts · getDb()': 1,
  'api/sync/routes.ts · getDb()': 2,
  'api/trips/service.ts · getDb()': 3,
  'api/vehicles/repository.ts · getDb()': 1,
  'api/vehicles/repository.ts · repository singleton': 1,
  'api/vehicles/routes.ts · getDb()': 3,
  'permissions/authorize.ts · getDb()': 1,
  'utils/outbound-url.ts · getDb()': 3,
  'utils/vehicle-access.ts · getDb()': 3,
};

function productionSources(dir: string = SRC_ROOT): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (['__tests__', 'test-helpers', 'node_modules', 'scripts'].includes(entry)) continue;
      out.push(...productionSources(full));
    } else if (entry.endsWith('.ts') && !entry.endsWith('.d.ts') && !entry.includes('.test.')) {
      out.push(full);
    }
  }
  return out;
}

function countConstructs(src: string): Map<string, number> {
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/[^\n]*/g, '$1');
  const counts = new Map<string, number>();
  for (const [name, pattern] of Object.entries(PATTERNS)) {
    const n = code.match(pattern)?.length ?? 0;
    if (n > 0) counts.set(name, n);
  }
  return counts;
}

countRatchet({
  name: 'database access goes through the app context',
  tolerated: BASELINE,
  guidance:
    'Reach the database through appContext() (or repos()) from backend/src/app-context.ts, and ' +
    'register new repositories in createAppContext instead of exporting a module-level instance. ' +
    'Only the context factory and the DB tooling call getDb(). New or grown sites (file · construct):',
  scan: () => {
    const counts = new Map<string, number>();
    for (const file of productionSources()) {
      const rel = relative(SRC_ROOT, file);
      if (OWNERS.has(rel)) continue;
      for (const [name, n] of countConstructs(readFileSync(file, 'utf-8'))) {
        counts.set(`${rel} · ${name}`, n);
      }
    }
    return counts;
  },
  probe: () => {
    const one = (src: string, name: string) => countConstructs(src).get(name) ?? 0;
    expect(one('const resolver = requestResolver(c, getDb());', 'getDb()')).toBe(1);
    expect(one('// getDb() in a comment', 'getDb()')).toBe(0);
    expect(one('export function getDb(): AppDatabase {', 'getDb()')).toBe(0);
    expect(
      one('export const tripRepository = new TripRepository(getDb());', 'repository singleton')
    ).toBe(1);
    expect(
      one(
        'export const analyticsInsightsRepository = new AnalyticsInsightsRepository(\n  getDb(),',
        'repository singleton'
      )
    ).toBe(1);
    expect(one('const tripRepository = new TripRepository(getDb());', 'repository singleton')).toBe(
      1
    );
    expect(
      one(
        'export const trips: TripRepository = new TripRepository(getDb());',
        'repository singleton'
      )
    ).toBe(1);
    expect(one('  const repo = new TripRepository(db);', 'repository singleton')).toBe(0);
    expect(productionSources().length).toBeGreaterThan(100);
  },
});
