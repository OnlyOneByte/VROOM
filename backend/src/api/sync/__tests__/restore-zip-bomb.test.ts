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

    const bomb = new AdmZip();
    bomb.addFile('metadata.json', Buffer.alloc(CONFIG.backup.maxUncompressedSize + 1));
    const bombBuffer = bomb.toBuffer();

    expect(bombBuffer.length).toBeLessThan(CONFIG.backup.maxFileSize);

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

    const parsed = await backupService.parseZipBackup(zip);
    expect(parsed.vehicles).toHaveLength(1);
    expect(parsed.vehicles[0].make).toBe('Honda');
  });
});

describe('parseZipBackup compression-ratio guard', () => {
  test('rejects an entry whose compression ratio exceeds the cap, even when the total size is under the cap', async () => {
    const { backupService } = await import('../backup');
    const { CONFIG } = await import('../../../config');
    const AdmZip = (await import('adm-zip')).default;

    const uncompressed = Math.floor(CONFIG.backup.maxUncompressedSize / 4);
    const bomb = new AdmZip();
    bomb.addFile('metadata.json', Buffer.alloc(uncompressed));
    const buf = bomb.toBuffer();

    expect(uncompressed).toBeLessThan(CONFIG.backup.maxUncompressedSize);
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
    for (const e of new AdmZip(zip).getEntries()) {
      if (e.header.compressedSize > 0) {
        expect(e.header.size / e.header.compressedSize).toBeLessThan(
          CONFIG.backup.maxCompressionRatio
        );
      }
    }
    await expect(backupService.parseZipBackup(zip)).resolves.toBeDefined();
  });
});
