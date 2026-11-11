/**
 * stageReceiptDrafts with injected fakes and no DB or HTTP. Covers one draft per photo, skipping
 * already-imported photos, per-item parse or download failures becoming an empty draft, thumbnail
 * failures becoming null, list failures propagating, and the per-run cap. HTTP wiring is tested in
 * the route test.
 */

import { describe, expect, test } from 'bun:test';
import type { ReceiptDraft } from '../../providers/domains/vlm/prompt';
import type { PhotosMediaItem } from '../../providers/services/google-photos-service';
import {
  MAX_RECEIPT_PHOTOS_PER_RUN,
  type StageDeps,
  stageReceiptDrafts,
} from '../receipt-drafts-service';

/** Build a StageDeps over simple in-memory fakes; override any seam per test. */
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
        // Downloaded bytes encode the photo id, so the parse can be routed per photo.
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

  test('the per-run cap is passed through to the Photos read', async () => {
    let calledWith = -1;
    const deps = makeDeps({
      listReceiptPhotos: async (max) => {
        calledWith = max;
        return [];
      },
    });
    await stageReceiptDrafts(deps);
    expect(calledWith).toBe(MAX_RECEIPT_PHOTOS_PER_RUN);
    await stageReceiptDrafts(deps, 5);
    expect(calledWith).toBe(5);
  });

  test('PERSISTS NOTHING — the orchestration only reads (no write seam in StageDeps)', () => {
    // No write seam exists in StageDeps, so staging cannot persist an expense.
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
