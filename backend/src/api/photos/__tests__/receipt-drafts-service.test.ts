/**
 * Photos → auto-expense STAGE orchestration (photos-auto-expense T2) — the pure {@link
 * stageReceiptDrafts} logic, driven via injected fakes (NO DB, NO HTTP). Pins the design-§2 contract:
 *  - a clean multi-photo sweep returns one draft per photo (download → parse → fresh thumbnail);
 *  - an already-imported photo is FILTERED OUT (the idempotency cross-ref, D3/R5);
 *  - a per-item VLM/download failure degrades to an EMPTY draft for THAT item (never a batch fail);
 *  - a thumbnail-URL failure degrades that item's thumbnailUrl to null (not fatal);
 *  - a Photos LIST/transport failure PROPAGATES (the route maps it to 502 — anti-fail-open #43/#44/#144);
 *  - the D4 cap is honored (listReceiptPhotos is called with the cap).
 *
 * The HTTP wiring (provider resolution, the 400/502 mapping) is pinned separately by the route test.
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

describe('stageReceiptDrafts — the stage orchestration (T2)', () => {
  test('a clean multi-photo sweep returns one draft per photo, with thumbnails', async () => {
    const parsed: Record<string, ReceiptDraft> = {
      'm-1': { amount: 12.5, category: 'fuel' },
      'm-2': { amount: 40, vendor: 'Shell' },
    };
    const deps = makeDeps({
      listReceiptPhotos: async () => [photo('m-1'), photo('m-2')],
      parseImage: async (bytes) => {
        // The bytes carry the id (the fake download returns `bytes-<id>`), so we can route the parse.
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

  test('an already-imported photo is filtered out (the idempotency cross-ref, D3)', async () => {
    const deps = makeDeps({
      listReceiptPhotos: async () => [photo('m-1'), photo('m-2'), photo('m-3')],
      // m-2 already backs an expense (its photos:<id> clientId exists) → skip it.
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
    expect(drafts.find((d) => d.photoId === 'boom')?.draft).toEqual({}); // empty draft, not a throw
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
    expect(drafts[0]?.draft).toEqual({ amount: 10 }); // the parse still ran
  });

  test('a Photos LIST/transport failure PROPAGATES (the route maps it to 502)', async () => {
    const deps = makeDeps({
      listReceiptPhotos: async () => {
        throw new Error('Photos API 503');
      },
    });
    await expect(stageReceiptDrafts(deps)).rejects.toThrow('Photos API 503');
  });

  test('the D4 per-run cap is passed through to the Photos read', async () => {
    let calledWith = -1;
    const deps = makeDeps({
      listReceiptPhotos: async (max) => {
        calledWith = max;
        return [];
      },
    });
    await stageReceiptDrafts(deps);
    expect(calledWith).toBe(MAX_RECEIPT_PHOTOS_PER_RUN);
    // And an explicit override is honored.
    await stageReceiptDrafts(deps, 5);
    expect(calledWith).toBe(5);
  });

  test('PERSISTS NOTHING — the orchestration only reads (no write seam in StageDeps)', () => {
    // Structural guard: StageDeps exposes ONLY read seams (list/download/freshUrl/parse/isImported).
    // There is no create/write dependency, so the stage cannot persist an expense (design §2).
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
