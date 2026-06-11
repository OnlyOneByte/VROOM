/**
 * Source-scan GUARD (#74, C220) — the photos routes must wire `changeTracker`.
 *
 * Photo upload (POST) and delete (DELETE) mutate data that IS in the backup payload (the `photos` +
 * `photo_refs` tables, backup.ts). The auto-backup orchestrator SKIPS when
 * `!hasChangesSinceLastSync(userId)` (backup-orchestrator.ts), and that flag is bumped only by the
 * `changeTracker` middleware on a 2xx mutation. photos/routes.ts was the LONE mutating route module
 * missing `changeTracker` — so a photo-only change between backups silently failed to re-trigger the
 * next auto-backup until some OTHER tracked mutation bumped the timestamp (the #42 silent-backup-gap
 * class, NORTH_STAR #1).
 *
 * This is a SOURCE SCAN (mirroring photo-serve-headers.test.ts, C133): a full POST upload needs a real
 * storage provider's bytes (not exercisable in the in-memory harness), and the DELETE path likewise
 * routes through the provider. So we pin that the middleware is wired — a refactor that drops it fails
 * here, travelling with the merge. The middleware's own 2xx-gating + markDataChanged behavior is
 * covered by the activity-tracker tests; this guard pins the WIRING that connects photos to it.
 */

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROUTES_SRC = readFileSync(join(import.meta.dir, '..', 'routes.ts'), 'utf-8');

describe('photos routes wire changeTracker (#74 backup-gap source guard)', () => {
  test('changeTracker is imported from the middleware barrel', () => {
    expect(ROUTES_SRC).toMatch(
      /import\s*\{[^}]*\bchangeTracker\b[^}]*\}\s*from\s*'\.\.\/\.\.\/middleware'/
    );
  });

  test('changeTracker is registered as middleware on the router', () => {
    expect(ROUTES_SRC).toContain("routes.use('*', changeTracker)");
  });

  test('the mutating endpoints that depend on it still exist (POST upload + DELETE)', () => {
    // Anchors WHY the middleware matters — if these mutations are ever removed the guard can be
    // revisited, but while they exist the change-stamp must be wired.
    expect(ROUTES_SRC).toContain("routes.post('/:entityType/:entityId'");
    expect(ROUTES_SRC).toContain("routes.delete('/:entityType/:entityId/:photoId'");
  });
});
