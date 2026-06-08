/**
 * Security regression: restore must reject a zip bomb BEFORE inflating it.
 *
 * The upload route caps the COMPRESSED ZIP (bodyLimit, 50MB), but parseZipBackup
 * inflates each entry via getData(). A highly-compressible bomb (e.g. a 200MB+
 * run of zeros) sails past the compressed cap and would OOM on decompression.
 * parseZipBackup now sums each entry's uncompressed header.size (read from the
 * ZIP central directory, no inflation) and throws if the total exceeds
 * CONFIG.backup.maxUncompressedSize.
 *
 * createTestApp() rewrites env then dynamic-imports DB-bound modules; keep static
 * imports to the harness + bun:test and import backup/adm-zip/config dynamically.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { createTestApp, type TestApp } from '../../../test-helpers/http-client';

let ctx: TestApp;

beforeEach(async () => {
  ctx = await createTestApp();
});
afterEach(() => ctx.close());

describe('parseZipBackup zip-bomb guard', () => {
  test('rejects an archive whose uncompressed size exceeds the cap, before inflating', async () => {
    const { backupService } = await import('../backup');
    const { CONFIG } = await import('../../../config');
    const AdmZip = (await import('adm-zip')).default;

    // A single entry of (cap + 1) zero bytes: trivially compressible (so the ZIP
    // itself is tiny and well under bodyLimit) but its uncompressed header.size
    // exceeds the cap — exactly the bomb shape the guard must catch.
    const bomb = new AdmZip();
    bomb.addFile('metadata.json', Buffer.alloc(CONFIG.backup.maxUncompressedSize + 1));
    const bombBuffer = bomb.toBuffer();

    // The compressed bomb is small (proves the compressed-size limit wouldn't
    // catch it) yet must still be rejected.
    expect(bombBuffer.length).toBeLessThan(CONFIG.backup.maxFileSize);

    await expect(backupService.parseZipBackup(bombBuffer)).rejects.toThrow(/decompress/i);
  });

  test('a normal exported backup is under the cap and parses fine (control)', async () => {
    const created = await ctx.authed('POST', '/api/v1/vehicles', {
      make: 'Honda',
      model: 'Civic',
      year: 2021,
    });
    expect(created.status, await created.text()).toBeLessThan(300);

    const { backupService } = await import('../backup');
    const zip = await backupService.exportAsZip(ctx.user.id);

    // Parses without tripping the guard, and round-trips the vehicle.
    const parsed = await backupService.parseZipBackup(zip);
    expect(parsed.vehicles).toHaveLength(1);
    expect(parsed.vehicles[0].make).toBe('Honda');
  });
});
