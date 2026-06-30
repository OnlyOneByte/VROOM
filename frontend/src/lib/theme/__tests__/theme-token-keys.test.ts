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

/**
 * C186 (deep-review) — the `@theme inline` Tailwind color aliases must reference ONLY engine-managed raw
 * tokens. app.css maps each Tailwind color utility via `--color-<x>: var(--<rawToken>)`. The theme engine
 * (T7) swaps the RAW tokens per `data-theme`; a Tailwind utility re-resolves through its `--color-*` alias.
 * So if a `--color-foo: var(--foo)` alias references a raw token NOT in THEME_TOKEN_KEYS, switching themes
 * would leave `--color-foo` resolving to a stale/unmanaged value — a visual leak the registry/token guards
 * can't see. Certified firsthand (C186) that today all 32 color aliases map 1:1 onto the 32 managed keys;
 * this pins it so a NEW Tailwind color alias (a routine app.css edit) can't land without adding its raw
 * token to the engine (THEME_TOKEN_KEYS + the registry).
 */
describe('@theme inline color aliases reference only engine-managed tokens (C186)', () => {
  // The `--color-*: var(--x)` aliases inside the `@theme inline { ... }` block.
  const themeBlock = APP_CSS.match(/@theme[^{]*\{([\s\S]*?)\}/)?.[1] ?? '';
  const aliasedRawTokens = new Set<string>();
  for (const m of themeBlock.matchAll(/--color-[a-z0-9-]+\s*:\s*var\(--([a-z0-9-]+)\)/gim)) {
    const raw = m[1];
    if (raw) aliasedRawTokens.add(raw);
  }
  const managed = new Set<string>(THEME_TOKEN_KEYS);

  test('the @theme color-alias scan is non-vacuous', () => {
    expect(aliasedRawTokens.size).toBeGreaterThan(20);
  });

  test('every --color-* alias points at a THEME_TOKEN_KEYS-managed raw token (no stale-alias leak)', () => {
    const unmanaged = [...aliasedRawTokens].filter((t) => !managed.has(t));
    expect(
      unmanaged,
      `These Tailwind --color-* aliases reference raw tokens the theme engine does NOT manage — a theme ` +
        `switch would leave them STALE (a visual leak). Add each to THEME_TOKEN_KEYS + the registry, or ` +
        `point the alias at a managed token:\n  ${unmanaged.join(', ')}`
    ).toEqual([]);
  });
});
