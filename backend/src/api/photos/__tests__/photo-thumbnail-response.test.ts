/**
 * BEHAVIORAL guard for `photoThumbnailResponse` (C127) — the shared byte-serving Response builder for
 * photo thumbnails (C227 #77 dedup). The sibling photo-serve-headers.test.ts pins the security headers
 * as a SOURCE SCAN (reads helpers.ts as text), so the function itself had ZERO line coverage — nothing
 * ever CALLED it and asserted the real Response object. A source scan would still pass if the header
 * object were built but mis-wired to the Response (wrong arg, body/headers swapped, etc.). This drives
 * the real function and asserts the constructed Response's actual headers + body round-trip.
 *
 * The four headers are all load-bearing:
 *   - X-Content-Type-Options: nosniff — MANDATORY (#77/#35, ARCC Secure-HTTP-Headers): the serve uses the
 *     CLIENT-asserted, never-sniffed mimeType, so without nosniff a file whose bytes are HTML/script but
 *     declared image/png could be MIME-sniffed + executed (stored-content vector).
 *   - Content-Type = the passed mimeType (echoed verbatim).
 *   - Cache-Control: private, max-age=3600 — `private` keeps a shared proxy from caching one user's photo.
 *   - Cross-Origin-Resource-Policy: cross-origin.
 *
 * Pure function → no DB, no server.
 */

import { describe, expect, test } from 'bun:test';
import { photoThumbnailResponse } from '../helpers';

describe('photoThumbnailResponse', () => {
  test('sets all four serve headers, including the MANDATORY nosniff (#77)', () => {
    const res = photoThumbnailResponse(Buffer.from('fake-image-bytes'), 'image/png');
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(res.headers.get('Content-Type')).toBe('image/png');
    expect(res.headers.get('Cache-Control')).toBe('private, max-age=3600');
    expect(res.headers.get('Cross-Origin-Resource-Policy')).toBe('cross-origin');
  });

  test('echoes the passed mimeType verbatim (client-asserted, never sniffed)', () => {
    const res = photoThumbnailResponse(Buffer.from('x'), 'image/webp');
    expect(res.headers.get('Content-Type')).toBe('image/webp');
    // nosniff stays regardless of the declared type — that's the whole point of #77.
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
  });

  test('the buffer is served as the response body (round-trips byte-for-byte)', async () => {
    const bytes = Buffer.from('hello-thumbnail');
    const res = photoThumbnailResponse(bytes, 'image/jpeg');
    const body = Buffer.from(await res.arrayBuffer());
    expect(body.equals(bytes)).toBe(true);
  });

  test("Cache-Control is private (a shared proxy must not cache another user's photo)", () => {
    const res = photoThumbnailResponse(Buffer.from('x'), 'image/png');
    expect(res.headers.get('Cache-Control')).toContain('private');
  });
});
