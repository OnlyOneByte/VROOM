import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..', 'repository.ts');

const TERNARY = /skipConversion\s*\?\s*([^:?]*?)\s*:\s*((?:this\.)?\w+\([^;]*?\))/g;

const IF_ELSE = /if\s*\(\s*skipConversion\s*\)\s*\{([^}]*)\}\s*else\s*\{([^}]*)\}/g;

function hasConverted(s: string): boolean {
  return /buildConverted/.test(s);
}

describe('skipConversion dispatch orientation — truthy branch is the PURE builder, falsy is the converted twin', () => {
  test('the scan resolves the real analytics repository', () => {
    expect(readFileSync(REPO, 'utf8').length, `unreadable/empty: ${REPO}`).toBeGreaterThan(100);
  });

  test('every `skipConversion ? a : b` ternary puts the converted twin on the FALSY branch only', () => {
    const collapsed = readFileSync(REPO, 'utf8').replace(/\s+/g, ' ');
    const matches = [...collapsed.matchAll(TERNARY)].filter(
      (m) => hasConverted(m[1] ?? '') || hasConverted(m[2] ?? '')
    );
    expect(
      matches.length,
      'expected ≥3 skipConversion builder-dispatch ternary sites'
    ).toBeGreaterThanOrEqual(3);

    const inverted: string[] = [];
    for (const m of matches) {
      const truthy = m[1] ?? '';
      const falsy = m[2] ?? '';
      if (hasConverted(truthy) || !hasConverted(falsy)) {
        inverted.push(m[0].slice(0, 140));
      }
    }
    expect(
      inverted,
      `A skipConversion ternary is INVERTED — the converted twin must be on the FALSY (conversion-needed) ` +
        `branch and the pure builder on the TRUTHY (skip) branch. Flipping it routes a mixed-unit fleet to ` +
        `the raw-pooling pure builder, invisible to same-unit tests:\n${inverted.join('\n')}`
    ).toEqual([]);
  });

  test('every `if (skipConversion) {…} else {…}` dispatch puts the converted twin in the ELSE block only', () => {
    const collapsed = readFileSync(REPO, 'utf8').replace(/\s+/g, ' ');
    const matches = [...collapsed.matchAll(IF_ELSE)].filter(
      (m) => hasConverted(m[1] ?? '') || hasConverted(m[2] ?? '')
    );
    expect(
      matches.length,
      'expected ≥1 skipConversion if/else convert dispatch site'
    ).toBeGreaterThanOrEqual(1);

    const inverted: string[] = [];
    for (const m of matches) {
      const thenBlock = m[1] ?? '';
      const elseBlock = m[2] ?? '';
      if (hasConverted(thenBlock) || !hasConverted(elseBlock)) {
        inverted.push(m[0].slice(0, 160));
      }
    }
    expect(
      inverted,
      `An if (skipConversion) convert-dispatch is INVERTED — the converted twin must be in the ELSE ` +
        `(conversion-needed) block, the pure builder in the THEN (skip) block. Flipping it pools a mixed ` +
        `fleet raw:\n${inverted.join('\n')}`
    ).toEqual([]);
  });
});
