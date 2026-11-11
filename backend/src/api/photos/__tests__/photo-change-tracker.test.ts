/**
 * Source guard: the photos routes must register changeTracker. Photo mutations are in the backup
 * payload, and the auto-backup skips when no tracked change has been recorded, so a missing tracker
 * silently skips the backup.
 */

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROUTES_SRC = readFileSync(join(import.meta.dir, '..', 'routes.ts'), 'utf-8');

describe('photos routes wire changeTracker', () => {
  test('changeTracker is imported from the middleware barrel', () => {
    expect(ROUTES_SRC).toMatch(
      /import\s*\{[^}]*\bchangeTracker\b[^}]*\}\s*from\s*'\.\.\/\.\.\/middleware'/
    );
  });

  test('changeTracker is registered as middleware on the router', () => {
    expect(ROUTES_SRC).toContain("routes.use('*', changeTracker)");
  });

  test('the mutating endpoints that depend on it still exist (POST upload + DELETE)', () => {
    expect(ROUTES_SRC).toContain("routes.post('/:entityType/:entityId'");
    expect(ROUTES_SRC).toContain("routes.delete('/:entityType/:entityId/:photoId'");
  });
});
