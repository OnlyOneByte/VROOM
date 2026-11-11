/**
 * Components must paint via the semantic theme tokens, never a fixed palette color.
 *
 * VROOM theming is a pure token swap on the app.css custom properties, so a component that paints
 * with `bg-white` / `text-black` / `bg-gray-800` looks right in whichever look it was eyeballed in
 * and then clashes the moment the user switches — white-on-white, black-on-black. The correct form
 * is `bg-background` / `bg-card` / `text-foreground` / `text-muted-foreground` / `bg-primary` /
 * `*-foreground` / `border-border`.
 *
 * Scope: `bg-`/`text-`/`border-` + {white, black, gray-N, slate-N, zinc-N, neutral-N}, and only the
 * BARE class — a `dark:bg-gray-800` is theme-aware by construction and is excluded by the
 * lookbehind. An optional `/NN` opacity tail is included in the match so a scrim like `bg-black/50`
 * is caught rather than slipping past; the deliberate scrims are listed as exclusions.
 *
 * The exclusions are permanent design choices, not debt:
 *  - button / badge `text-white`: only on the `destructive` variant — white on the fixed red
 *    `bg-destructive`, identical in both looks. The shadcn-svelte convention; every other variant
 *    uses `*-foreground` tokens.
 *  - the dialog / alert-dialog / sheet overlays' `bg-black/50`: a modal scrim is a dimming backdrop
 *    and is theme-agnostic by design.
 *
 * `kind: 'exclusion'` so both directions are checked. If one of these files is refactored onto
 * theme tokens, its entry is stale and must be removed — a stale entry would silently exempt that
 * path from the guard, which is how an allowlist quietly stops protecting anything.
 */

import { readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect } from 'vitest';
import { ratchet } from './_helpers/debt-ratchet';
import { collectSvelteFiles } from './_helpers/collect-svelte-files';

// This file lives at src/lib/utils/__tests__/, so src/ is three levels up.
const SRC_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

/**
 * A bare (non-`dark:`) hardcoded palette color in a bg-/text-/border- utility.
 */
const THEME_CLASH =
	/(?<!dark:)\b(?:bg|text|border)-(?:white|black|gray-\d+|slate-\d+|zinc-\d+|neutral-\d+)(?:\/\d+)?\b/;

const files = collectSvelteFiles(SRC_ROOT);
const rel = (file: string) => relative(SRC_ROOT, file).replace(/\\/g, '/');

/** `path → first offending line`, so the failure message can still point at a line and a class. */
function hits(): Map<string, string> {
	const found = new Map<string, string>();
	for (const file of files) {
		const lines = readFileSync(file, 'utf-8').split('\n');
		for (const [index, line] of lines.entries()) {
			const match = line.match(THEME_CLASH);
			if (match && !found.has(rel(file))) {
				found.set(rel(file), `${rel(file)}:${index + 1} → ${match[0]}`);
			}
		}
	}
	return found;
}

// Computed once so the guidance can name the actual line, which a path-only list would lose. Site
// identity stays the PATH — a line number would churn on every edit above it.
const detail = hits();

ratchet({
	name: 'no theme-clashing hardcoded colors in components',
	kind: 'exclusion',
	tolerated: [
		'lib/components/ui/button/button.svelte',
		'lib/components/ui/badge/badge.svelte',
		'lib/components/ui/dialog/dialog-overlay.svelte',
		'lib/components/ui/alert-dialog/alert-dialog-overlay.svelte',
		'lib/components/ui/sheet/sheet-overlay.svelte'
	],
	guidance:
		'Theme-clashing hardcoded color(s) — these break one of the two looks. Route the color ' +
		'through a semantic theme token (bg-background / bg-card / text-foreground / ' +
		'text-muted-foreground / bg-primary / *-foreground / border-border), or — if it is a ' +
		'genuinely theme-agnostic fixed-contrast or scrim use — add it to the exclusion list with a ' +
		`reason:\n${[...detail.values()].join('\n')}\nOffending files:`,
	scan: () => [...detail.keys()],
	probe: () => {
		// Fixtures, not live sites: the five exclusions are permanent, but anchoring non-vacuity on
		// them would break the moment the kit stops needing one.
		expect(THEME_CLASH.test('<div class="bg-white p-4">')).toBe(true);
		expect(THEME_CLASH.test('<div class="text-gray-500">')).toBe(true);
		expect(THEME_CLASH.test('<div class="bg-black/50">')).toBe(true);
		// A `dark:` variant is theme-aware by construction and must NOT match.
		expect(THEME_CLASH.test('<div class="dark:bg-gray-800">')).toBe(false);
		// Nor may a theme token.
		expect(THEME_CLASH.test('<div class="bg-background text-muted-foreground">')).toBe(false);
		expect(THEME_CLASH.test('<div class="border-border">')).toBe(false);
		expect(
			files.length,
			'the .svelte walk found almost nothing — SRC_ROOT is wrong'
		).toBeGreaterThan(20);
	}
});
