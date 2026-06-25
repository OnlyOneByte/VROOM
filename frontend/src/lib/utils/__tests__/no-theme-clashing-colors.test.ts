/**
 * Regression GUARD (committed, travels with the merge) for the THEME-CLASH class —
 * hardcoded Tailwind palette colors in components that break dark mode (NORTH_STAR #3).
 *
 * VROOM theming is a pure token swap on app.css custom properties (theming-engine R1): a
 * component must paint via the semantic theme tokens (bg-background / bg-card / text-foreground /
 * text-muted-foreground / bg-primary / text-primary-foreground / border-border / …), NEVER a
 * fixed palette color (bg-white / text-black / bg-gray-800 / text-slate-200 …). A hardcoded
 * palette color looks fine in the light look it was eyeballed in, then clashes the moment the
 * user switches to dark (white-on-white, black-on-black) — exactly the breakage the C268/C269
 * dark-mode eyes-on sweep verified is ABSENT today. That sweep was manual + the per-shot PNGs
 * don't travel; this static scan does, and catches the whole CLASS, not just today's components.
 *
 * Scope: bg-/text-/border- + {white, black, gray-N, slate-N, zinc-N, neutral-N}, and ONLY the
 * bare class (not a `dark:` variant — a `dark:bg-gray-800` IS theme-aware by construction). A
 * leading `/` opacity modifier is allowed in the MATCH so an intentional scrim like `bg-black/50`
 * is still caught by the regex but lives on the allowlist below.
 *
 * ALLOWLIST — the 5 sites verified firsthand (C271) as intentional + theme-agnostic, NOT clashes:
 *   - button/badge `text-white`: ONLY on the `destructive` variant (white on the fixed red
 *     bg-destructive — deliberate fixed contrast, identical light+dark; the shadcn-svelte
 *     convention). Every other variant uses *-foreground theme tokens.
 *   - dialog/alert-dialog/sheet overlays `bg-black/50`: the modal SCRIM — a semi-transparent
 *     dimming backdrop is theme-agnostic by design (same in light + dark).
 * Any NEW hit is a real regression: route the color through a semantic theme token instead.
 *
 * Runs in the fast unit suite (`npm test`) — no browser, no server.
 */

import { readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';
import { collectSvelteFiles } from './_helpers/collect-svelte-files';

// This file lives at src/lib/utils/__tests__/, so src/ is three dirs up from __tests__'s parent.
const SRC_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

// Sites verified firsthand (C271) as intentional fixed-contrast / theme-agnostic scrim uses.
const ALLOWLIST = new Set<string>([
	'lib/components/ui/button/button.svelte', // destructive-variant text-white on fixed red
	'lib/components/ui/badge/badge.svelte', // destructive-variant text-white on fixed red
	'lib/components/ui/dialog/dialog-overlay.svelte', // bg-black/50 modal scrim
	'lib/components/ui/alert-dialog/alert-dialog-overlay.svelte', // bg-black/50 modal scrim
	'lib/components/ui/sheet/sheet-overlay.svelte', // bg-black/50 modal scrim
]);

// A bare (non-`dark:`) hardcoded palette color in a bg-/text-/border- utility. The negative
// lookbehind for `dark:` keeps theme-aware dark variants out; an optional `/NN` opacity tail is
// included so a scrim like `bg-black/50` matches (it lives on the allowlist).
const THEME_CLASH =
	/(?<!dark:)\b(?:bg|text|border)-(?:white|black|gray-\d+|slate-\d+|zinc-\d+|neutral-\d+)(?:\/\d+)?\b/;

describe('no theme-clashing hardcoded colors in components (dark-mode / NORTH_STAR #3 class guard)', () => {
	const files = collectSvelteFiles(SRC_ROOT);

	test('the scan actually found .svelte sources (guard is live, not a no-op)', () => {
		// If this ever hits 0, the path resolution broke and the guard is silently inert.
		expect(files.length).toBeGreaterThan(20);
	});

	test('no component uses a bare hardcoded palette color (theme tokens only), outside the allowlist', () => {
		const offenders: string[] = [];
		for (const file of files) {
			const rel = relative(SRC_ROOT, file).replace(/\\/g, '/');
			if (ALLOWLIST.has(rel)) continue;
			const src = readFileSync(file, 'utf-8');
			const lines = src.split('\n');
			for (const [i, line] of lines.entries()) {
				const m = line.match(THEME_CLASH);
				if (m) offenders.push(`${rel}:${i + 1} → ${m[0]}`);
			}
		}
		expect(
			offenders,
			`Theme-clashing hardcoded color(s) found — these break dark mode (NORTH_STAR #3). Route the ` +
				`color through a semantic theme token (bg-background / bg-card / text-foreground / ` +
				`text-muted-foreground / bg-primary / *-foreground / border-border …) instead, or — if it is a ` +
				`genuinely theme-agnostic fixed-contrast/scrim use — add it to the ALLOWLIST with a reason:\n${offenders.join('\n')}`
		).toEqual([]);
	});

	test('every ALLOWLIST entry still exists + still has a hardcoded color (no stale allowlist drift)', () => {
		// If an allowlisted file is refactored to use theme tokens (or renamed), its allowlist entry
		// is stale and should be removed — keep the allowlist honest so it can't silently over-permit.
		const stale: string[] = [];
		for (const rel of ALLOWLIST) {
			const full = join(SRC_ROOT, rel);
			let src: string;
			try {
				src = readFileSync(full, 'utf-8');
			} catch {
				stale.push(`${rel} (file missing)`);
				continue;
			}
			if (!THEME_CLASH.test(src)) stale.push(`${rel} (no longer has a hardcoded color)`);
		}
		expect(stale, `Stale ALLOWLIST entr(ies) — remove them:\n${stale.join('\n')}`).toEqual([]);
	});
});
