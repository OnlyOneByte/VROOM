/**
 * C190 (guard) — the app.html anti-FOUC head-script must MIRROR the theme store's dark-mode constants.
 *
 * app.html runs an inline `<script>` BEFORE first paint that reads the persisted theme from localStorage
 * and sets the `dark` class on <html>, so a dark-mode user doesn't get a white flash on every load
 * (NORTH_STAR #3, no-FOUC). That script is RAW HTML — outside the type system and the store's own tests —
 * so it duplicates four load-bearing constants the store owns:
 *   1. the localStorage key (`vroom-theme-preference` = STORAGE_KEY),
 *   2. the `dark` class toggled on <html>,
 *   3. the `system` sentinel (the default when unset),
 *   4. the `(prefers-color-scheme: dark)` media query (how `system` resolves).
 * If the store renames any of these and the head-script isn't updated in lockstep, dark mode silently
 * flashes light on first paint — with NOTHING going red (the store's unit tests can't see app.html). This
 * source-scan pins the contract: it reads BOTH files and asserts they agree on all four. The C25/C170
 * cross-file source-scan idiom, applied to the one theming constant that lives in two places.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';

const CWD = process.cwd();
const APP_HTML = readFileSync(`${CWD}/src/app.html`, 'utf8');
const STORE_SRC = readFileSync(`${CWD}/src/lib/stores/theme.svelte.ts`, 'utf8');

/** Extract the store's STORAGE_KEY literal from its source (the value the head-script must read). */
function storeStorageKey(): string {
  const m = STORE_SRC.match(/const STORAGE_KEY\s*=\s*['"]([^'"]+)['"]/);
  return m?.[1] ?? '';
}

describe('app.html anti-FOUC head-script mirrors the theme store (C190 contract guard)', () => {
  test('the head-script reads the SAME localStorage key the store writes', () => {
    const key = storeStorageKey();
    expect(key, 'store STORAGE_KEY is parseable').toBeTruthy();
    // The inline script must getItem the exact key the store persists to.
    expect(APP_HTML).toContain(`localStorage.getItem('${key}')`);
    // And the store itself must use it for both read + write (sanity that we parsed the real constant).
    expect(STORE_SRC).toContain(`localStorage.getItem(STORAGE_KEY)`);
    expect(STORE_SRC).toContain(`localStorage.setItem(STORAGE_KEY, preference)`);
  });

  test('the head-script toggles the SAME `dark` class the store toggles on <html>', () => {
    // store: root.classList.toggle('dark', ...)
    expect(STORE_SRC).toMatch(/classList\.toggle\(\s*['"]dark['"]/);
    // head-script: documentElement.classList.add('dark')
    expect(APP_HTML).toMatch(/classList\.add\(\s*['"]dark['"]\s*\)/);
  });

  test('the head-script resolves `system` via the SAME prefers-color-scheme query the store uses', () => {
    const QUERY = '(prefers-color-scheme: dark)';
    expect(STORE_SRC).toContain(QUERY);
    expect(APP_HTML).toContain(QUERY);
  });

  test('the head-script honors the `system` sentinel (the store default when unset)', () => {
    // The store defaults an unset/garbage value to 'system'; the head-script must treat 'system' as
    // "follow the OS", not as an explicit light/dark — else an unset user gets the wrong first paint.
    expect(STORE_SRC).toContain("return 'system'");
    expect(APP_HTML).toContain("=== 'system'");
    // And the head-script's default when the key is absent must be 'system' too (matches the store).
    expect(APP_HTML).toMatch(/\|\|\s*['"]system['"]/);
  });
});
