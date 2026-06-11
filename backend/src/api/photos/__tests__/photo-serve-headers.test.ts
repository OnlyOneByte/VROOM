/**
 * Source-scan GUARD (C133 #35, extended C227 #77) for the photo-serve security headers.
 *
 * The thumbnail/serve endpoints return user-uploaded bytes with a Content-Type taken from the stored,
 * CLIENT-asserted `mimeType` (never sniffed). Without `X-Content-Type-Options: nosniff` the browser may
 * MIME-sniff a file whose bytes are HTML/script but declared image/png and execute it — a stored-content
 * vector. ARCC Secure-HTTP-Headers makes nosniff a MANDATORY response header.
 *
 * C227 (#77): the nosniff literal + the byte-serving Response were extracted to ONE builder,
 * `photoThumbnailResponse` in helpers.ts, because the vehicle-photo sub-router's serve was MISSING
 * nosniff while the generic route had it (a real divergence on the primary photo surface). So this
 * guard now pins (a) the nosniff literal lives in the shared builder, and (b) BOTH serve routes route
 * through it — a refactor that drops the header, or re-inlines a header-incomplete Response at either
 * site, fails here and travels with the merge.
 *
 * SOURCE SCAN (not behavioral): the 200-byte serve calls the real storage provider's download(), which
 * needs network/provider bytes and isn't exercisable in the in-memory harness (the property tests model
 * it). So we pin the load-bearing literals in source. Mirrors the frontend source-scan guards.
 */

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const HELPERS_SRC = readFileSync(join(import.meta.dir, '..', 'helpers.ts'), 'utf-8');
const PHOTOS_ROUTES_SRC = readFileSync(join(import.meta.dir, '..', 'routes.ts'), 'utf-8');
const VEHICLE_PHOTO_ROUTES_SRC = readFileSync(
  join(import.meta.dir, '..', '..', 'vehicles', 'photo-routes.ts'),
  'utf-8'
);

describe('photo-serve security headers (C133 #35 / C227 #77 source guard)', () => {
  test('the shared photoThumbnailResponse builder sets nosniff + the client mimeType Content-Type', () => {
    const start = HELPERS_SRC.indexOf('export function photoThumbnailResponse');
    expect(start).toBeGreaterThan(-1);
    const block = HELPERS_SRC.slice(
      start,
      HELPERS_SRC.indexOf('}', HELPERS_SRC.indexOf('});', start))
    );
    expect(block).toContain("'Content-Type': mimeType");
    expect(block).toContain("'X-Content-Type-Options': 'nosniff'");
  });

  test('the generic photos route serves thumbnails via the shared builder', () => {
    expect(PHOTOS_ROUTES_SRC).toContain('photoThumbnailResponse(buffer, mimeType)');
  });

  test('the vehicle-photo route serves thumbnails via the shared builder (#77 — was missing nosniff)', () => {
    expect(VEHICLE_PHOTO_ROUTES_SRC).toContain('photoThumbnailResponse(buffer, mimeType)');
  });
});
