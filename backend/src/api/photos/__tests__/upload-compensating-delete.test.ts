/**
 * Source-scan GUARD (#34, C280) — a photo upload must compensate (best-effort delete the just-uploaded
 * provider object) if the post-upload DB writes fail.
 *
 * uploadPhotoForEntity does provider.upload (external bytes) → photoRepository.create (photo row) →
 * photoRefRepository.create (active ref). Those last two are not in the same transaction as the
 * upload, so a DB error/constraint after the bytes land would ORPHAN the external object: no DB row
 * references it, so it's never reconcilable or deletable through the app (NORTH_STAR #1, no silent
 * leak). The fix (persistUploadedPhotoOrCleanup) wraps the inserts in try/catch and best-effort
 * provider.delete(storageRef)s the object before re-throwing.
 *
 * This is a SOURCE SCAN (mirroring photo-change-tracker.test.ts / photo-serve-headers.test.ts, C220/
 * C133): a full upload needs a real storage provider's bytes (not exercisable in the in-memory harness
 * without the process-global mock.module leak trap, C38/C91). So we pin that the compensating-delete
 * EXISTS — a refactor that drops it fails here, travelling with the merge.
 */

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SERVICE_SRC = readFileSync(join(import.meta.dir, '..', 'photo-service.ts'), 'utf-8');

describe('photo upload compensates on a failed DB write (#34 orphan-byte source guard)', () => {
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
