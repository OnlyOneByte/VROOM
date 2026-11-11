/**
 * Source guard for the photo serve headers. Served bytes carry a client-asserted Content-Type, so
 * X-Content-Type-Options: nosniff must be set, or a browser could sniff and execute uploaded HTML.
 * Both serve routes must use the shared photoThumbnailResponse builder that sets it.
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

describe('photo-serve security headers (source guard)', () => {
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

  test('the vehicle-photo route serves thumbnails via the shared builder', () => {
    expect(VEHICLE_PHOTO_ROUTES_SRC).toContain('photoThumbnailResponse(buffer, mimeType)');
  });
});
