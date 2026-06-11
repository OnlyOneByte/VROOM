/**
 * Source-scan GUARD (C133, #35) for the photo-serve security headers.
 *
 * The thumbnail/serve endpoint (`GET /:entityType/:entityId/:photoId`) returns user-uploaded bytes
 * with a Content-Type taken from the stored, CLIENT-asserted `mimeType` (never sniffed). Without
 * `X-Content-Type-Options: nosniff` the browser may MIME-sniff a file whose bytes are HTML/script but
 * declared image/png and execute it — a stored-content vector. ARCC Secure-HTTP-Headers makes nosniff
 * a MANDATORY response header; Secure-File-Uploads says do not trust Content-Type / mitigate MIME
 * sniffing.
 *
 * This is a SOURCE SCAN (not a behavioral test) deliberately: the 200-byte-serve path calls the real
 * storage provider's download(), which needs network/provider bytes and is not exercisable in the
 * in-memory harness (the property tests model it). So we pin the load-bearing header literal in the
 * serve handler — a refactor that drops it fails here, travelling with the merge. Mirrors the
 * frontend no-hardcoded-currency / no-interpolated-arbitrary-class source-scan guards.
 */

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROUTES_SRC = readFileSync(join(import.meta.dir, '..', 'routes.ts'), 'utf-8');

describe('photo-serve security headers (C133 #35 source guard)', () => {
  test('the routes set X-Content-Type-Options: nosniff on the byte-serving response', () => {
    expect(ROUTES_SRC).toContain("'X-Content-Type-Options': 'nosniff'");
  });

  test('the nosniff header lives in the byte-serving response block (with the mimeType Content-Type)', () => {
    // Anchor on the `new Response(buffer, {...})` block (the byte-serve) and assert BOTH the
    // client-asserted Content-Type and the nosniff header appear before that block's headers close —
    // so the guard can't be satisfied by a nosniff added to some unrelated response elsewhere.
    const start = ROUTES_SRC.indexOf('new Response(buffer');
    expect(start).toBeGreaterThan(-1);
    const block = ROUTES_SRC.slice(start, ROUTES_SRC.indexOf('});', start));
    expect(block).toContain("'Content-Type': mimeType");
    expect(block).toContain("'X-Content-Type-Options': 'nosniff'");
  });
});
