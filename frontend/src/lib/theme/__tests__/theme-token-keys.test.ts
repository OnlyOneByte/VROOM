/**
 * Theming engine T4 guard — `THEME_TOKEN_KEYS` must stay EXACTLY the set of per-variant color custom
 * properties `src/app.css` declares. The whole engine is a value swap over these keys (R1); if app.css
 * gains/loses a token and this list doesn't track it, a theme variant would either miss a key (a visual
 * leak — the token keeps the previous theme's value) or carry a dead one. This source-scans app.css's
 * `:root` (light) and `.dark` (dark) blocks and pins three invariants:
 *   1. light and dark declare the SAME key set (per-variant parity — every variant must define every key);
 *   2. `THEME_TOKEN_KEYS` equals that set EXACTLY (no missing, no extra);
 *   3. `--radius` (the `:root`-only, variant-invariant layout token) is intentionally EXCLUDED.
 *
 * Source-scan over the live app.css (the C25/C271 merge-surviving idiom) — no DOM, no runtime theme apply.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { THEME_TOKEN_KEYS } from '../theme-types';

const APP_CSS = readFileSync(`${process.cwd()}/src/app.css`, 'utf8');

/** Extract the raw `--token` declaration names (without the leading `--`) inside a `<selector> { ... }` block. */
function declaredTokenKeys(selector: string): Set<string> {
  // Grab the FIRST brace-delimited body following the selector at column start (the :root / .dark block).
  const re = new RegExp(`${selector.replace('.', '\\.')}\\s*\\{([^}]*)\\}`);
  const body = APP_CSS.match(re)?.[1] ?? '';
  const keys = new Set<string>();
  for (const m of body.matchAll(/^\s*--([a-z0-9-]+)\s*:/gim)) {
    const key = m[1];
    if (key) keys.add(key);
  }
  return keys;
}

describe('THEME_TOKEN_KEYS mirrors the app.css per-variant token set (T4)', () => {
  const light = declaredTokenKeys(':root');
  const dark = declaredTokenKeys('.dark');

  test('the scan actually found tokens (non-vacuous)', () => {
    expect(light.size).toBeGreaterThan(20);
    expect(dark.size).toBeGreaterThan(20);
  });

  test('light (:root) and dark (.dark) declare the same key set, except the variant-invariant --radius', () => {
    // --radius is the only :root-only token (a layout value, not swapped per dark/light).
    const lightColorOnly = new Set([...light].filter((k) => k !== 'radius'));
    expect([...lightColorOnly].sort()).toEqual([...dark].sort());
  });

  test('THEME_TOKEN_KEYS equals the .dark (per-variant) token set exactly', () => {
    expect([...THEME_TOKEN_KEYS].sort()).toEqual([...dark].sort());
  });

  test('--radius is NOT a themeable per-variant key (excluded by design)', () => {
    expect(THEME_TOKEN_KEYS).not.toContain('radius');
    // ...but it IS declared in :root (proving the exclusion is deliberate, not a missed scan).
    expect(light.has('radius')).toBe(true);
  });

  test('THEME_TOKEN_KEYS has no duplicates', () => {
    expect(new Set(THEME_TOKEN_KEYS).size).toBe(THEME_TOKEN_KEYS.length);
  });
});
