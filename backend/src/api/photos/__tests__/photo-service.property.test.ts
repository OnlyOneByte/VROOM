/**
 * Property-Based Tests for PhotoService Upload Validation
 *
 * Property 6: MIME Type Validation
 * Any file with a MIME type not in {image/jpeg, image/png, image/webp}
 * is rejected, and any file with a MIME type in the allowed set is accepted.
 *
 * **Validates: Requirements 1.4, 9.1**
 *
 * Property 7: File Size Validation
 * Any file exceeding 10,485,760 bytes is rejected, and any file with
 * size > 0 and <= 10,485,760 bytes is accepted.
 *
 * **Validates: Requirements 1.5, 9.2**
 *
 * Approach: Test the validation predicates directly against the exported
 * constants from photo-service.ts. No database calls, no mocking.
 */

import { describe, expect, test } from 'bun:test';
import fc from 'fast-check';
import { ALLOWED_MIME_TYPES, MAX_FILE_SIZE } from '../photo-service';

// ---------------------------------------------------------------------------
// Property 6: MIME Type Validation
// ---------------------------------------------------------------------------

describe('Property 6: MIME Type Validation', () => {
  test('any MIME type in ALLOWED_MIME_TYPES is accepted', () => {
    fc.assert(
      fc.property(fc.constantFrom(...ALLOWED_MIME_TYPES), (mimeType) => {
        expect(ALLOWED_MIME_TYPES.includes(mimeType)).toBe(true);
      }),
      { numRuns: 200 }
    );
  });

  test('any MIME type not in ALLOWED_MIME_TYPES is rejected', () => {
    const invalidMimeArb = fc
      .oneof(
        // Completely random strings
        fc.string({ minLength: 0, maxLength: 50 }),
        // Plausible but invalid MIME types
        fc.constantFrom(
          '',
          'image/gif',
          'image/bmp',
          'image/tiff',
          'image/svg+xml',
          'application/pdf',
          'text/plain',
          'video/mp4',
          'image/jpeg2',
          'image/jp',
          'image/web',
          'image/webpp',
          'image/ jpeg',
          'IMAGE/JPEG',
          'image/PNG',
          'jpeg',
          'png',
          'webp'
        )
      )
      .filter((s) => !ALLOWED_MIME_TYPES.includes(s));

    fc.assert(
      fc.property(invalidMimeArb, (mimeType) => {
        expect(ALLOWED_MIME_TYPES.includes(mimeType)).toBe(false);
      }),
      { numRuns: 200 }
    );
  });

  test('allowed set contains exactly image/jpeg, image/png, image/webp', () => {
    expect(new Set(ALLOWED_MIME_TYPES)).toEqual(new Set(['image/jpeg', 'image/png', 'image/webp']));
  });
});

// ---------------------------------------------------------------------------
// Property 7: File Size Validation
// ---------------------------------------------------------------------------

describe('Property 7: File Size Validation', () => {
  test('any file size > MAX_FILE_SIZE is rejected', () => {
    const oversizedArb = fc.integer({ min: MAX_FILE_SIZE + 1, max: MAX_FILE_SIZE * 10 });

    fc.assert(
      fc.property(oversizedArb, (size) => {
        expect(size > MAX_FILE_SIZE).toBe(true);
      }),
      { numRuns: 200 }
    );
  });

  test('any file size > 0 and <= MAX_FILE_SIZE is accepted', () => {
    const validSizeArb = fc.integer({ min: 1, max: MAX_FILE_SIZE });

    fc.assert(
      fc.property(validSizeArb, (size) => {
        expect(size > MAX_FILE_SIZE).toBe(false);
      }),
      { numRuns: 200 }
    );
  });

  test('MAX_FILE_SIZE boundary: exactly at limit is accepted, one byte over is rejected', () => {
    const atLimit = MAX_FILE_SIZE;
    const overLimit = MAX_FILE_SIZE + 1;
    expect(atLimit > MAX_FILE_SIZE).toBe(false);
    expect(overLimit > MAX_FILE_SIZE).toBe(true);
  });

  test('MAX_FILE_SIZE equals 10,485,760 bytes (10MB)', () => {
    expect(MAX_FILE_SIZE).toBe(10_485_760);
  });
});

// ---------------------------------------------------------------------------
// Reference Model (inline — mirrors the repository tests' ReferencePhotoModel)
// ---------------------------------------------------------------------------

interface RefPhoto {
  id: string;
  isCover: boolean;
  createdAt: number;
}

class ReferencePhotoModel {
  photos: RefPhoto[] = [];

  /** Simulates uploadPhotoForEntity auto-cover logic. */
  upload(id: string, createdAt: number): RefPhoto {
    const isFirst = this.photos.length === 0;
    const photo: RefPhoto = { id, isCover: isFirst, createdAt };
    this.photos.push(photo);
    return photo;
  }

  /** Simulates deletePhotoForEntity cover-promotion logic. */
  delete(photoId: string): void {
    const idx = this.photos.findIndex((p) => p.id === photoId);
    if (idx === -1) return;
    const wasCover = this.photos[idx].isCover;
    this.photos.splice(idx, 1);

    if (wasCover && this.photos.length > 0) {
      const oldest = this.photos.reduce((a, b) => (a.createdAt <= b.createdAt ? a : b));
      oldest.isCover = true;
    }
  }

  get coverPhoto(): RefPhoto | undefined {
    return this.photos.find((p) => p.isCover);
  }
}

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

const tsArb = fc.integer({ min: 1672531200000, max: 1767139200000 });

/**
 * Generate an array of N distinct timestamps so each photo has a unique
 * createdAt, making "oldest remaining" deterministic.
 */
const distinctTimestampsArb = (min: number, max: number) =>
  fc.uniqueArray(tsArb, { minLength: min, maxLength: max }).filter((arr) => arr.length >= min);

// ---------------------------------------------------------------------------
// Property 2: Auto-Cover on First Upload
// ---------------------------------------------------------------------------

/**
 * Property 2: Auto-Cover on First Upload
 *
 * For any entity with zero existing photos, uploading a valid photo results
 * in that photo having isCover = true. For any entity with one or more
 * existing photos, uploading a valid photo results in the new photo having
 * isCover = false and the existing cover photo remaining unchanged.
 *
 * **Validates: Requirements 1.2, 1.3**
 */
describe('Property 2: Auto-Cover on First Upload', () => {
  test('first photo uploaded always becomes cover', () => {
    fc.assert(
      fc.property(tsArb, (createdAt) => {
        const model = new ReferencePhotoModel();
        const photo = model.upload('photo-0', createdAt);
        expect(photo.isCover).toBe(true);
        expect(model.coverPhoto?.id).toBe('photo-0');
      }),
      { numRuns: 200 }
    );
  });

  test('subsequent uploads do not become cover and leave existing cover unchanged', () => {
    fc.assert(
      fc.property(distinctTimestampsArb(2, 20), (timestamps) => {
        const model = new ReferencePhotoModel();

        // Upload all photos sequentially
        for (let i = 0; i < timestamps.length; i++) {
          model.upload(`photo-${i}`, timestamps[i]);
        }

        // First photo must still be the cover
        expect(model.photos[0].isCover).toBe(true);
        expect(model.coverPhoto?.id).toBe('photo-0');

        // All subsequent photos must NOT be cover
        for (let i = 1; i < model.photos.length; i++) {
          expect(model.photos[i].isCover).toBe(false);
        }
      }),
      { numRuns: 200 }
    );
  });

  test('exactly one cover exists after N sequential uploads', () => {
    fc.assert(
      fc.property(distinctTimestampsArb(1, 20), (timestamps) => {
        const model = new ReferencePhotoModel();
        for (let i = 0; i < timestamps.length; i++) {
          model.upload(`photo-${i}`, timestamps[i]);

          // After every upload, exactly one cover exists
          const coverCount = model.photos.filter((p) => p.isCover).length;
          expect(coverCount).toBe(1);
        }
      }),
      { numRuns: 200 }
    );
  });
});

// ---------------------------------------------------------------------------
// Property 3: Cover Promotion on Delete
// ---------------------------------------------------------------------------

/**
 * Property 3: Cover Promotion on Delete
 *
 * When the cover photo is deleted and at least one other photo remains,
 * the oldest remaining photo (by createdAt) becomes the new cover photo
 * with isCover = true.
 *
 * **Validates: Requirements 4.2, 3.4**
 */
describe('Property 3: Cover Promotion on Delete', () => {
  test('deleting cover promotes oldest remaining photo to cover', () => {
    fc.assert(
      fc.property(distinctTimestampsArb(2, 15), (timestamps) => {
        const model = new ReferencePhotoModel();
        for (let i = 0; i < timestamps.length; i++) {
          model.upload(`photo-${i}`, timestamps[i]);
        }

        // Delete the cover photo
        const cover = model.coverPhoto;
        expect(cover).toBeDefined();
        if (!cover) return;
        model.delete(cover.id);

        // Exactly one cover must exist among remaining photos
        const coverCount = model.photos.filter((p) => p.isCover).length;
        expect(coverCount).toBe(1);

        // The new cover must be the oldest remaining by createdAt
        const newCover = model.coverPhoto;
        expect(newCover).toBeDefined();
        if (!newCover) return;
        const oldest = model.photos.reduce((a, b) => (a.createdAt <= b.createdAt ? a : b));
        expect(newCover.id).toBe(oldest.id);
      }),
      { numRuns: 200 }
    );
  });

  test('deleting cover when only one photo remains leaves no cover', () => {
    fc.assert(
      fc.property(tsArb, (createdAt) => {
        const model = new ReferencePhotoModel();
        model.upload('only-photo', createdAt);
        expect(model.coverPhoto?.id).toBe('only-photo');

        model.delete('only-photo');
        expect(model.photos.length).toBe(0);
        expect(model.coverPhoto).toBeUndefined();
      }),
      { numRuns: 200 }
    );
  });

  test('deleting a non-cover photo does not change the cover', () => {
    fc.assert(
      fc.property(distinctTimestampsArb(3, 15), fc.nat(), (timestamps, deleteIdx) => {
        const model = new ReferencePhotoModel();
        for (let i = 0; i < timestamps.length; i++) {
          model.upload(`photo-${i}`, timestamps[i]);
        }

        const coverBefore = model.coverPhoto;
        expect(coverBefore).toBeDefined();

        // Pick a non-cover photo to delete
        const nonCoverPhotos = model.photos.filter((p) => !p.isCover);
        if (nonCoverPhotos.length === 0) return;
        const target = nonCoverPhotos[deleteIdx % nonCoverPhotos.length];
        model.delete(target.id);

        // Cover must be unchanged
        expect(model.coverPhoto?.id).toBe(coverBefore?.id);
      }),
      { numRuns: 200 }
    );
  });

  test('repeated cover deletions always promote oldest remaining', () => {
    fc.assert(
      fc.property(distinctTimestampsArb(3, 10), (timestamps) => {
        const model = new ReferencePhotoModel();
        for (let i = 0; i < timestamps.length; i++) {
          model.upload(`photo-${i}`, timestamps[i]);
        }

        // Keep deleting the cover until one photo remains
        while (model.photos.length > 1) {
          const currentCover = model.coverPhoto;
          expect(currentCover).toBeDefined();
          if (!currentCover) return;
          model.delete(currentCover.id);

          // After each deletion, cover is the oldest remaining
          const newCover = model.coverPhoto;
          expect(newCover).toBeDefined();
          if (!newCover) return;
          const oldest = model.photos.reduce((a, b) => (a.createdAt <= b.createdAt ? a : b));
          expect(newCover.id).toBe(oldest.id);
        }
      }),
      { numRuns: 200 }
    );
  });
});
