// Guards the ratchet guards. Hand-written tolerated-debt guards must use the shared helper in debt-ratchet.ts.
// Three failure modes are flagged:
//  1. Non-vacuity anchored on a live site, which becomes unsatisfiable once the list reaches zero.
//  2. Exact equality against a tolerated list, which turns a fix into a red test.
//  3. A MAX_ ceiling beside the list, which drifts from it.
// Only files that maintain a tolerated list are inspected, so ordinary domain constants are untouched.

import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const BACKEND_SRC = join(import.meta.dir, '../../');
const FRONTEND_SRC = join(import.meta.dir, '../../../../frontend/src');

// Names that mark a collection as a tolerated list rather than a domain constant.
const TOLERATED_LIST =
  /\b[A-Z0-9_]*(?:DEBT|PENDING|TOLERATED|INVENTORY|EXCLUDED|ALLOWLIST|EXEMPT)[A-Z0-9_]*\b/;
const DECLARES_TOLERATED_LIST =
  /\b(?:const|let)\s+[A-Z0-9_]*(?:DEBT|PENDING|TOLERATED|INVENTORY|EXCLUDED|ALLOWLIST|EXEMPT)[A-Z0-9_]*\b/;

const USES_HELPER = /\b(?:count)?[Rr]atchet\(\{/;

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

function testFiles(dir: string): string[] {
  const out: string[] = [];
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === 'node_modules' || entry === '.svelte-kit') continue;
      out.push(...testFiles(full));
    } else if (/\.(test|spec)\.ts$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

interface Offence {
  file: string;
  pattern: string;
  line: string;
}

const RULES: { pattern: string; test: (line: string) => boolean }[] = [
  {
    pattern: 'non-vacuity anchored on a live site',
    test: (line) =>
      /\.(?:some|get)\([^)]*\)\s*\)?\s*\.?\s*(?:toBe\(true\)|toBeGreaterThan\(0\))/.test(line),
  },
  {
    pattern: 'exact equality against the tolerated list',
    test: (line) => /toEqual\(\[\s*\.\.\./.test(line) && TOLERATED_LIST.test(line),
  },
  {
    pattern: 'a MAX_ ceiling beside a tolerated list',
    test: (line) => /\b(?:const|let)\s+MAX_[A-Z0-9_]*\s*(?::\s*number\s*)?=\s*\d+/.test(line),
  },
];

function inspectSource(src: string, file = '<fixture>'): Offence[] {
  const stripped = stripComments(src);
  if (!DECLARES_TOLERATED_LIST.test(stripped) || USES_HELPER.test(stripped)) return [];
  return stripped.split('\n').flatMap((line) =>
    RULES.filter((rule) => rule.test(line)).map((rule) => ({
      file,
      pattern: rule.pattern,
      line: line.trim(),
    }))
  );
}

function inspect(roots: string[]): Offence[] {
  const repoRoot = join(import.meta.dir, '../../../../');
  return roots.flatMap((root) =>
    testFiles(root)
      // This file quotes each anti-pattern as a fixture, so it would always flag itself.
      .filter((file) => !file.endsWith('ratchet-guard-shape.test.ts'))
      .flatMap((file) => inspectSource(readFileSync(file, 'utf-8'), relative(repoRoot, file)))
  );
}

describe('ratchet guards use the shared helper semantics', () => {
  const offences = inspect([BACKEND_SRC, FRONTEND_SRC]);

  test('the scan reads both trees (otherwise every assertion below is vacuous)', () => {
    expect(testFiles(BACKEND_SRC).length).toBeGreaterThan(100);
    expect(testFiles(FRONTEND_SRC).length).toBeGreaterThan(50);
  });

  test('the scan recognises each anti-pattern (proven on fixtures)', () => {
    // Fixture-based on purpose: anchoring this on a real offending guard would make it
    // unsatisfiable once every guard is migrated, which is the goal.
    const probe = (body: string): string[] =>
      inspectSource(`const KNOWN_DEBT = new Set<string>([]);\n${body}`).map((o) => o.pattern);

    expect(probe('expect(counts.get("api/x.ts")).toBeGreaterThan(0);')).toContain(
      'non-vacuity anchored on a live site'
    );
    expect(probe('expect(items.some(isDebt)).toBe(true);')).toContain(
      'non-vacuity anchored on a live site'
    );
    expect(probe('expect(offenders).toEqual([...KNOWN_DEBT].sort());')).toContain(
      'exact equality against the tolerated list'
    );
    expect(probe('const MAX_THINGS = 6;')).toContain('a MAX_ ceiling beside a tolerated list');

    // Every tolerated-list name in use must match, including names where the marker sits mid-name.
    for (const name of [
      'KNOWN_DEBT',
      'PENDING_VIEWPORT_OVERRIDES',
      'PENDING_UNNAMED_DESTRUCTIVE_INK',
      'INVENTORY',
      'EXCLUDED_BY_DESIGN',
      'ALLOWLIST',
      'A11Y_DEBT',
    ]) {
      expect(DECLARES_TOLERATED_LIST.test(`const ${name} = new Set([]);`), name).toBe(true);
      expect(TOLERATED_LIST.test(`expect(x).toEqual([...${name}]);`), name).toBe(true);
    }
    // And a domain constant must NOT be treated as a tolerated list.
    for (const name of ['TRIP_PURPOSES', 'SHEET_NAMES', 'SHIPPED_JOURNAL', 'RANGE_VALUES']) {
      expect(DECLARES_TOLERATED_LIST.test(`const ${name} = ['a'];`), name).toBe(false);
    }
    // And that it does NOT fire on the correct shapes.
    expect(probe('expect(unexpected).toEqual([]);')).toEqual([]);
    expect(probe('expect(stale).toEqual([]);')).toEqual([]);
  });

  test('no guard re-invents a broken ratchet', () => {
    const report = offences.map((o) => `${o.file}\n    [${o.pattern}] ${o.line}`).join('\n');
    expect(
      offences,
      'These guards maintain a tolerated-debt list without the shared helper, using a shape that ' +
        'punishes whoever fixes the last site. Route them through `ratchet`/`countRatchet` ' +
        '(backend/src/test-helpers/debt-ratchet.ts, or the frontend _helpers twin), which asserts ' +
        '"no new site" and "no stale entry" separately and proves non-vacuity on fixtures:\n' +
        report
    ).toEqual([]);
  });
});
