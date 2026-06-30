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
import { DEFAULT_THEME_ID } from '$lib/theme/theme-registry';

const CWD = process.cwd();
const APP_HTML = readFileSync(`${CWD}/src/app.html`, 'utf8');
const STORE_SRC = readFileSync(`${CWD}/src/lib/stores/theme.svelte.ts`, 'utf8');

/** Extract the store's STORAGE_KEY literal from its source (the value the head-script must read). */
function storeStorageKey(): string {
  const m = STORE_SRC.match(/const STORAGE_KEY\s*=\s*['"]([^'"]+)['"]/);
  return m?.[1] ?? '';
}

/** Extract the store's THEME_ID_KEY literal (the theme-id mirror the head-script must read pre-paint). */
function storeThemeIdKey(): string {
  const m = STORE_SRC.match(/const THEME_ID_KEY\s*=\s*['"]([^'"]+)['"]/);
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

/**
 * C201 (deep-review) — the head-script must ALSO pre-paint the THEME-ID axis, not just dark/light.
 *
 * The store comment (theme.svelte.ts) promises the `vroom-theme-id` mirror exists "so the anti-FOUC
 * head-script (app.html) + the store agree" — but T8 wired only the dark-class axis into app.html. The
 * theme-id axis is a no-op TODAY (default-only registry → applyTheme never sets data-theme), so the gap
 * is invisible; the instant a non-default theme (`instrument`) ships and a user selects it, every load
 * would paint the DEFAULT look until hydration's initialize() runs, then flash to the chosen theme — the
 * exact FOUC NORTH_STAR #3 forbids, on a SECOND axis the dark-class guard above can't see. This pins the
 * head-script's data-theme pre-paint against the store's three load-bearing theme-id constants:
 *   1. the mirror key (`vroom-theme-id` = THEME_ID_KEY) the store writes and the head-script must read,
 *   2. the DEFAULT_THEME_ID sentinel that means "no override" (head-script must NOT set data-theme for it),
 *   3. the set-data-theme-on-<html> action (mirrors applyTheme's root.setAttribute('data-theme', id)).
 * Source-of-truth: THEME_ID_KEY is parsed from the store; DEFAULT_THEME_ID is imported from the registry —
 * so a rename of either trips this unless app.html is updated in lockstep (the C190 cross-file idiom).
 */
describe('app.html head-script pre-paints the theme-id axis (C201 contract guard)', () => {
  test('the head-script reads the SAME theme-id mirror key the store writes', () => {
    const key = storeThemeIdKey();
    expect(key, 'store THEME_ID_KEY is parseable').toBeTruthy();
    // The store reads + writes the mirror via THEME_ID_KEY...
    expect(STORE_SRC).toContain('localStorage.getItem(THEME_ID_KEY)');
    expect(STORE_SRC).toContain('localStorage.setItem(THEME_ID_KEY, id)');
    // ...and the head-script must getItem that exact literal pre-paint.
    expect(APP_HTML).toContain(`localStorage.getItem('${key}')`);
  });

  test('the head-script sets data-theme on <html> (mirrors applyTheme)', () => {
    // store: root.setAttribute('data-theme', themeId)
    expect(STORE_SRC).toMatch(/setAttribute\(\s*['"]data-theme['"]/);
    // head-script: el.setAttribute('data-theme', themeId)
    expect(APP_HTML).toMatch(/setAttribute\(\s*['"]data-theme['"]/);
  });

  test('the head-script treats the DEFAULT_THEME_ID sentinel as "no override" (no data-theme set)', () => {
    // The store clears data-theme for the default id (applyTheme: id !== DEFAULT_THEME_ID guards the set);
    // the head-script must use the SAME sentinel so the identity theme stays attribute-free (app.css :root
    // serves it). DEFAULT_THEME_ID is the registry's exported constant — pin both files against it.
    expect(STORE_SRC).toMatch(/themeId\s*!==\s*DEFAULT_THEME_ID/);
    expect(APP_HTML).toContain(`!== '${DEFAULT_THEME_ID}'`);
    // ...and the head-script defaults the absent mirror to that same sentinel (matches getStoredThemeId).
    expect(APP_HTML).toMatch(new RegExp(`\\|\\|\\s*['"]${DEFAULT_THEME_ID}['"]`));
  });
});
