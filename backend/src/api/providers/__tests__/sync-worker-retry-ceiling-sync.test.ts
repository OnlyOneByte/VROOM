/**
 * Regression GUARD (committed, travels with the merge) for the sync-worker retry-ceiling coupling
 * (deep-review CERTIFIED C67).
 *
 * The background photo sync-worker and the repository query that feeds it share ONE retry ceiling that
 * lives in TWO physically separate places:
 *   1. sync-worker.ts `MAX_RETRY_COUNT` — the value a TERMINAL auth failure (#144, AUTH_INVALID /
 *      PERMISSION_DENIED) jumps retryCount straight to, so the ref drops out of the work set instead of
 *      burning backoff cycles on a token that will never succeed.
 *   2. photoRefRepository.findPendingOrFailed's `${photoRefs.retryCount} < N` SQL bound — the predicate
 *      that decides which refs are STILL retryable.
 *
 * They MUST mirror: a terminal-auth ref is parked at exactly `MAX_RETRY_COUNT`, and that value must be
 * the threshold the query excludes (`retryCount < MAX_RETRY_COUNT` → a ref AT the cap is no longer
 * picked). The sync-worker comment says so, but nothing enforced it — the two `3`s are hand-written
 * literals. If they DRIFT (raise the query bound to `< 5` but leave MAX_RETRY_COUNT=3), a terminal-auth
 * ref parked at 3 satisfies `3 < 5` → it gets RE-PICKED every batch → the #144 fix silently breaks
 * (a revoked token retried forever, NORTH_STAR-#1 backoff/honesty regression) and the existing #144
 * behavioral test (which asserts the magic literal `retryCount: 3`) stays GREEN, blind to the drift.
 *
 * This guard pins the coupling: (a) MAX_RETRY_COUNT is the real exported constant, and (b) the repository
 * query's ceiling literal equals it. Edit either side out of lockstep → RED here. The one-edit→source-scan
 * pattern (C25 #36 RAW, C45 #37 atomic, C59 #94 convert) applied to the cross-module retry-ceiling invariant.
 *
 * Pure source scan + a constant import — no DB, no network. Runs in the fast suite.
 */

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MAX_RETRY_COUNT } from '../sync-worker';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..', '..', 'photos', 'photo-ref-repository.ts');

// The retry ceiling in findPendingOrFailed: `sql`${photoRefs.retryCount} < 3`` (whitespace-insensitive).
// Captures the numeric bound so we can assert it equals MAX_RETRY_COUNT.
const RETRY_CEILING = /photoRefs\.retryCount\s*}\s*<\s*(\d+)/;

describe('sync-worker retry ceiling stays in lockstep with the repository query (#144 coupling guard)', () => {
  test('MAX_RETRY_COUNT is the real exported worker constant', () => {
    // If someone un-exports or renames it, this import (and the #144 test) breaks loudly — that is the point.
    expect(MAX_RETRY_COUNT).toBe(3);
  });

  test('the scan resolves the photo-ref repository (guard is live, not a no-op)', () => {
    expect(readFileSync(REPO, 'utf8').length, `unreadable/empty: ${REPO}`).toBeGreaterThan(100);
  });

  test('findPendingOrFailed excludes refs AT the worker retry cap (query bound === MAX_RETRY_COUNT)', () => {
    const src = readFileSync(REPO, 'utf8');
    const m = src.match(RETRY_CEILING);
    expect(
      m,
      `Could not find the \`\${photoRefs.retryCount} < N\` retry-ceiling bound in findPendingOrFailed ` +
        `(${REPO}). If the predicate was refactored, update this guard to match the new shape.`
    ).not.toBeNull();

    const queryBound = Number(m?.[1]);
    expect(
      queryBound,
      `The repository's retry-ceiling bound (retryCount < ${queryBound}) has DRIFTED from the ` +
        `sync-worker's MAX_RETRY_COUNT (${MAX_RETRY_COUNT}). A terminal-auth ref is parked at ` +
        `MAX_RETRY_COUNT to drop it from the work set; if the query bound is larger, that ref is ` +
        `re-picked forever (#144 breaks). Keep the two in lockstep.`
    ).toBe(MAX_RETRY_COUNT);
  });
});
