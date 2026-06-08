/**
 * StorageCapabilities helpers (D4a). The capability flags let callers branch BEFORE
 * invoking an operation a limited backend (Google Photos) can't perform.
 */

import { describe, expect, test } from 'bun:test';
import {
  capabilitiesOf,
  FULL_CRUD,
  isImageMimeType,
  type StorageProvider,
} from '../storage-provider';

/** A minimal provider that omits `capabilities` (like Drive/S3). */
const undeclared = { type: 'google-drive' } as unknown as StorageProvider;
/** A limited provider that declares reduced capabilities (like Google Photos). */
const limited = {
  type: 'google-photos',
  capabilities: { delete: false, list: false, arbitraryFiles: false },
} as unknown as StorageProvider;

describe('capabilitiesOf', () => {
  test('defaults an undeclared provider to FULL_CRUD', () => {
    expect(capabilitiesOf(undeclared)).toEqual(FULL_CRUD);
    expect(capabilitiesOf(undeclared)).toEqual({ delete: true, list: true, arbitraryFiles: true });
  });

  test('returns the declared capabilities for a limited provider', () => {
    expect(capabilitiesOf(limited)).toEqual({ delete: false, list: false, arbitraryFiles: false });
  });
});

describe('isImageMimeType', () => {
  test.each([
    ['image/jpeg', true],
    ['image/png', true],
    ['image/webp', true],
    ['application/pdf', false],
    ['text/plain', false],
  ])('%s → %p', (mime, expected) => {
    expect(isImageMimeType(mime as string)).toBe(expected);
  });
});

describe('PDF-routing decision (the photo-service gate logic)', () => {
  // The gate in photo-service is: skip/refuse when
  //   !capabilitiesOf(provider).arbitraryFiles && !isImageMimeType(file.type)
  const shouldRefuse = (p: StorageProvider, mime: string) =>
    !capabilitiesOf(p).arbitraryFiles && !isImageMimeType(mime);

  test('PDF to Google Photos is refused', () => {
    expect(shouldRefuse(limited, 'application/pdf')).toBe(true);
  });
  test('image to Google Photos is allowed', () => {
    expect(shouldRefuse(limited, 'image/jpeg')).toBe(false);
  });
  test('PDF to Drive/S3 is allowed', () => {
    expect(shouldRefuse(undeclared, 'application/pdf')).toBe(false);
  });
});
