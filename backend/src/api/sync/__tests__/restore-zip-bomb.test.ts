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

    // Rejected before inflating — by EITHER pre-inflation guard. An all-zeros bomb is both
    // over the total-size cap AND absurdly compressible, so the #22 ratio guard (which runs
    // first) is what actually catches this shape now; the total-size guard remains the backstop
    // for a declared-size lie that keeps a plausible ratio (covered by the #22 block below).
    await expect(backupService.parseZipBackup(bombBuffer)).rejects.toThrow(
      /decompress|compression ratio|zip bomb/i
    );
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

// #22 (C55): the total-uncompressed sum trusts header.size, which is ATTACKER-DECLARED — a bomb can
// declare a small size to pass the sum, then inflate to GB on getData(). The per-entry compression-RATIO
// cap (compressedSize is the real in-file byte count) catches that before any inflation.
describe('parseZipBackup compression-ratio guard (#22)', () => {
  test('rejects an entry whose compression ratio exceeds the cap, even when the total size is under the cap', async () => {
    const { backupService } = await import('../backup');
    const { CONFIG } = await import('../../../config');
    const AdmZip = (await import('adm-zip')).default;

    // A run of zeros compresses ~1000:1+ (far above maxCompressionRatio) but is sized to stay UNDER
    // maxUncompressedSize — so ONLY the ratio guard can reject it (the total-size sum passes).
    const uncompressed = Math.floor(CONFIG.backup.maxUncompressedSize / 4); // well under the total cap
    const bomb = new AdmZip();
    bomb.addFile('metadata.json', Buffer.alloc(uncompressed));
    const buf = bomb.toBuffer();

    // Sanity: the entry is under the TOTAL cap, so the only thing that can catch it is the ratio guard.
    expect(uncompressed).toBeLessThan(CONFIG.backup.maxUncompressedSize);
    // And it really is highly compressible (proves the ratio is the discriminating signal here).
    const entry = new AdmZip(buf).getEntries()[0];
    expect(entry, 'the bomb has an entry').toBeDefined();
    expect((entry?.header.size ?? 0) / (entry?.header.compressedSize ?? 1)).toBeGreaterThan(
      CONFIG.backup.maxCompressionRatio
    );

    await expect(backupService.parseZipBackup(buf)).rejects.toThrow(/compression ratio|zip bomb/i);
  });

  test('a real exported backup compresses well within the ratio cap (control — no false positive)', async () => {
    await ctx.authed('POST', '/api/v1/vehicles', { make: 'Toyota', model: 'Camry', year: 2022 });
    const { backupService } = await import('../backup');
    const { CONFIG } = await import('../../../config');
    const AdmZip = (await import('adm-zip')).default;

    const zip = await backupService.exportAsZip(ctx.user.id);
    // Every entry's real compression ratio is far below the cap (CSV text ~3-20x), so the guard
    // never false-positives on a legitimate backup.
    for (const e of new AdmZip(zip).getEntries()) {
      if (e.header.compressedSize > 0) {
        expect(e.header.size / e.header.compressedSize).toBeLessThan(
          CONFIG.backup.maxCompressionRatio
        );
      }
    }
    // And it parses cleanly through BOTH guards.
    await expect(backupService.parseZipBackup(zip)).resolves.toBeDefined();
  });
});
