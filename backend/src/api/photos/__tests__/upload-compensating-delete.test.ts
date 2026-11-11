/**
 * Source guard: if the DB writes after a provider upload fail, the uploaded object must be deleted,
 * or it is orphaned with no row pointing at it. Scans the source because a real upload needs
 * provider bytes.
 */

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SERVICE_SRC = readFileSync(join(import.meta.dir, '..', 'photo-service.ts'), 'utf-8');

describe('photo upload compensates on a failed DB write (orphan-byte source guard)', () => {
  test('the persist helper exists and is invoked by uploadPhotoForEntity', () => {
    expect(SERVICE_SRC).toContain('async function persistUploadedPhotoOrCleanup(');
    expect(SERVICE_SRC).toContain('await persistUploadedPhotoOrCleanup(');
  });

  test('the persist path catches a DB-write failure and best-effort deletes the uploaded object', () => {
    // Isolate the helper body, then assert it has a catch that calls provider.delete with the
    // upload's storageRef.externalId (the just-uploaded object) — the compensating delete.
    const start = SERVICE_SRC.indexOf('async function persistUploadedPhotoOrCleanup(');
    expect(start).toBeGreaterThan(-1);
    const next = SERVICE_SRC.indexOf('\nexport async function uploadPhotoForEntity(', start);
    const body = SERVICE_SRC.slice(start, next === -1 ? undefined : next);

    expect(body).toMatch(/}\s*catch\s*\(error\)\s*{/);
    expect(body).toMatch(/provider\.delete\(\s*{[^}]*externalId:\s*storageRef\.externalId/);
    // The original error must NOT be swallowed — it re-throws after the cleanup attempt.
    expect(body).toContain('throw error;');
  });

  test('a failed compensating delete is logged (reconcilable), not silently dropped', () => {
    expect(SERVICE_SRC).toMatch(/Failed to clean up orphaned upload/);
  });
});
