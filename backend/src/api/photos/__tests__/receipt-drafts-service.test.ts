import { describe, expect, test } from 'bun:test';
import { PayloadTooLargeError, SyncError, SyncErrorCode } from '../../../errors';
import type { ReceiptDraft } from '../../providers/domains/vlm/prompt';
import type { PhotosMediaItem } from '../../providers/services/google-photos-service';
import {
  MAX_RECEIPT_PHOTOS_LOOKED_AT,
  MAX_RECEIPT_PHOTOS_PER_RUN,
  MAX_SCAN_BYTES,
  ReceiptScanStopped,
  type ScanStopReason,
  type StageDeps,
  stageReceiptDrafts,
} from '../receipt-drafts-service';

function makeDeps(overrides: Partial<StageDeps> = {}): StageDeps {
  return {
    listReceiptPhotos: async () => [],
    downloadPhoto: async (id) => Buffer.from(`bytes-${id}`),
    freshUrl: async (id) => `https://photos.fake/${id}`,
    parseImage: async () => ({ amount: 10 }) as ReceiptDraft,
    isAlreadyImported: async () => false,
    ...overrides,
  };
}

function photo(id: string, mimeType = 'image/jpeg'): PhotosMediaItem {
  return { id, filename: `${id}.jpg`, baseUrl: `https://photos.fake/${id}`, mimeType };
}

describe('stageReceiptDrafts', () => {
  test('a clean multi-photo sweep returns one draft per photo, with thumbnails', async () => {
    const parsed: Record<string, ReceiptDraft> = {
      'm-1': { amount: 12.5, category: 'fuel' },
      'm-2': { amount: 40, vendor: 'Shell' },
    };
    const deps = makeDeps({
      listReceiptPhotos: async () => [photo('m-1'), photo('m-2')],
      parseImage: async (bytes) => {
        const id = bytes.toString().replace('bytes-', '');
        return parsed[id] ?? {};
      },
    });

    const drafts = await stageReceiptDrafts(deps);
    expect(drafts).toHaveLength(2);
    expect(drafts[0]).toEqual({
      photoId: 'm-1',
      draft: { amount: 12.5, category: 'fuel' },
      thumbnailUrl: 'https://photos.fake/m-1',
    });
    expect(drafts[1]?.draft).toEqual({ amount: 40, vendor: 'Shell' });
  });

  test('an already-imported photo is filtered out', async () => {
    const deps = makeDeps({
      listReceiptPhotos: async () => [photo('m-1'), photo('m-2'), photo('m-3')],
      isAlreadyImported: async (id) => id === 'm-2',
    });
    const drafts = await stageReceiptDrafts(deps);
    expect(drafts.map((d) => d.photoId)).toEqual(['m-1', 'm-3']);
  });

  test('a per-item VLM failure degrades to an EMPTY draft, not a batch failure', async () => {
    const deps = makeDeps({
      listReceiptPhotos: async () => [photo('ok'), photo('boom'), photo('ok2')],
      parseImage: async (bytes) => {
        if (bytes.toString().includes('boom')) throw new Error('VLM exploded');
        return { amount: 5 };
      },
    });
    const drafts = await stageReceiptDrafts(deps);
    expect(drafts).toHaveLength(3);
    expect(drafts.find((d) => d.photoId === 'boom')?.draft).toEqual({});
    expect(drafts.find((d) => d.photoId === 'ok')?.draft).toEqual({ amount: 5 });
  });

  test('a per-item DOWNLOAD failure also degrades to an empty draft', async () => {
    const deps = makeDeps({
      listReceiptPhotos: async () => [photo('m-1')],
      downloadPhoto: async () => {
        throw new Error('download flaked');
      },
    });
    const drafts = await stageReceiptDrafts(deps);
    expect(drafts).toHaveLength(1);
    expect(drafts[0]?.draft).toEqual({});
  });

  test('a thumbnail-URL failure degrades thumbnailUrl to null (item still staged)', async () => {
    const deps = makeDeps({
      listReceiptPhotos: async () => [photo('m-1')],
      freshUrl: async () => {
        throw new Error('url expired');
      },
    });
    const drafts = await stageReceiptDrafts(deps);
    expect(drafts[0]?.thumbnailUrl).toBeNull();
    expect(drafts[0]?.draft).toEqual({ amount: 10 });
  });

  test('a Photos LIST/transport failure PROPAGATES (the route maps it to 502)', async () => {
    const deps = makeDeps({
      listReceiptPhotos: async () => {
        throw new Error('Photos API 503');
      },
    });
    await expect(stageReceiptDrafts(deps)).rejects.toThrow('Photos API 503');
  });

  test('the read looks past imported photos, and no more than the cap is staged', async () => {
    let calledWith = -1;
    const all = Array.from({ length: 40 }, (_, i) => photo(`m-${i}`));
    const deps = makeDeps({
      listReceiptPhotos: async (max) => {
        calledWith = max;
        return all.slice(0, max);
      },
      isAlreadyImported: async (id) => Number(id.slice(2)) < 30,
    });
    const drafts = await stageReceiptDrafts(deps);
    expect(calledWith).toBe(MAX_RECEIPT_PHOTOS_LOOKED_AT);
    expect(drafts.map((d) => d.photoId)).toEqual(all.slice(30).map((p) => p.id));
    expect(await stageReceiptDrafts(deps, 5)).toHaveLength(5);
    expect(MAX_RECEIPT_PHOTOS_PER_RUN).toBe(25);
  });

  test('a scan that reads nothing, a type that cannot be scanned and an oversized photo are marked unread', async () => {
    const downloaded: string[] = [];
    const deps = makeDeps({
      listReceiptPhotos: async () => [photo('empty'), photo('heic', 'image/heic'), photo('big')],
      downloadPhoto: async (id) => {
        downloaded.push(id);
        return id === 'big' ? Buffer.alloc(MAX_SCAN_BYTES + 1) : Buffer.from(id);
      },
      parseImage: async () => ({}),
    });
    const drafts = await stageReceiptDrafts(deps);
    expect(drafts.map((d) => [d.photoId, d.failed])).toEqual([
      ['empty', true],
      ['heic', true],
      ['big', true],
    ]);
    expect(downloaded).toEqual(['empty', 'big']);
  });

  test('a photo the download refuses as too large is marked unread and the run goes on', async () => {
    const deps = makeDeps({
      listReceiptPhotos: async () => [photo('big'), photo('ok')],
      downloadPhoto: async (id) => {
        if (id === 'big') throw new PayloadTooLargeError('The file is larger than the 8 MB limit');
        return Buffer.from(id);
      },
    });
    const drafts = await stageReceiptDrafts(deps);
    expect(drafts.map((d) => [d.photoId, d.failed ?? false])).toEqual([
      ['big', true],
      ['ok', false],
    ]);
  });

  test.each<[string, Error, ScanStopReason]>([
    ['a rejected key', new Error('VLM provider returned HTTP 401'), 'ai_key'],
    ['a rate limit', new Error('VLM provider returned HTTP 429'), 'ai_rate_limit'],
    ['lost Photos access', new SyncError(SyncErrorCode.AUTH_INVALID, 'revoked'), 'photos_access'],
  ])('%s stops the whole run after the first photo', async (_, failure, reason) => {
    let scans = 0;
    const deps = makeDeps({
      listReceiptPhotos: async () => [photo('a'), photo('b'), photo('c')],
      parseImage: async () => {
        scans++;
        throw failure;
      },
    });
    const run = stageReceiptDrafts(deps);
    await expect(run).rejects.toBeInstanceOf(ReceiptScanStopped);
    await expect(run).rejects.toMatchObject({ reason });
    expect(scans).toBe(1);
  });

  test('PERSISTS NOTHING — the orchestration only reads (no write seam in StageDeps)', () => {
    const deps = makeDeps();
    expect(Object.keys(deps).sort()).toEqual([
      'downloadPhoto',
      'freshUrl',
      'isAlreadyImported',
      'listReceiptPhotos',
      'parseImage',
    ]);
  });
});
