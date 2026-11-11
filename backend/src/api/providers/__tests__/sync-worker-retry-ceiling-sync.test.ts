import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MAX_RETRY_COUNT } from '../sync-worker';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..', '..', 'photos', 'photo-ref-repository.ts');

const RETRY_CEILING = /photoRefs\.retryCount\s*}\s*<\s*(\d+)/;

describe('sync-worker retry ceiling matches the repository query', () => {
  test('MAX_RETRY_COUNT is the real exported worker constant', () => {
    expect(MAX_RETRY_COUNT).toBe(3);
  });

  test('the source scan finds the photo-ref repository', () => {
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
        `re-picked forever. Keep the two in lockstep.`
    ).toBe(MAX_RETRY_COUNT);
  });
});
