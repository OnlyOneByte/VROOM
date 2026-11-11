/**
 * Theming engine — the D4 HARD GATE: every built-in theme must clear WCAG AA (4.5:1 normal text) on every
 * foreground/background token pair, in BOTH variants. D4 ("a11y is a hard gate, not best-effort") cannot be
 * verified by an eyes-on screenshot — contrast is a computed property — so this is the canonical, durable,
 * merge-surviving guard. It re-derives luminance from the oklch token values themselves, so
 * a future theme (or an edit to an existing one) that ships a low-contrast pair turns this RED before merge.
 *
 * Pure math — oklch → linear sRGB (the same matrix the browser uses) → WCAG relative luminance → ratio. No
 * DOM, no render. Validated against the shipped `default` palette (known-AA) by the same assertions below.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, expect, test } from 'vitest';
import { ratchet } from '$lib/utils/__tests__/_helpers/debt-ratchet';
import { THEME_REGISTRY } from '../theme-registry';
import type { ThemeTokenKey, ThemeTokens } from '../theme-types';

/** Parse an `oklch(L C H[/ a%])` string. Alpha is ignored — contrast is computed on the opaque color. */
function parseOklch(s: string): { L: number; C: number; H: number } {
	const m = s.match(/oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*[\d.]+%?)?\s*\)/);
	if (!m) throw new Error(`not an oklch() value: ${s}`);
	return { L: Number(m[1]), C: Number(m[2]), H: Number(m[3]) };
}

/** oklch → linear-sRGB (Björn Ottosson's OKLab matrices). Returns unclamped linear r/g/b. */
function oklchToLinearRGB(s: string): { r: number; g: number; b: number } {
	const { L, C, H } = parseOklch(s);
	const h = (H * Math.PI) / 180;
	const a = C * Math.cos(h);
	const bb = C * Math.sin(h);
	const l_ = L + 0.3963377774 * a + 0.2158037573 * bb;
	const m_ = L - 0.1055613458 * a - 0.0638541728 * bb;
	const s_ = L - 0.0894841775 * a - 1.291485548 * bb;
	const l = l_ ** 3;
	const m = m_ ** 3;
	const sCube = s_ ** 3;
	return {
		r: 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * sCube,
		g: -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * sCube,
		b: -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * sCube
	};
}

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

/** WCAG relative luminance from a linear-sRGB color (already linear → no extra de-gamma). */
function luminance(oklch: string): number {
	const { r, g, b } = oklchToLinearRGB(oklch);
	return 0.2126 * clamp01(r) + 0.7152 * clamp01(g) + 0.0722 * clamp01(b);
}

/** WCAG contrast ratio between two oklch colors. */
function contrast(fg: string, bg: string): number {
	const a = luminance(fg);
	const b = luminance(bg);
	const hi = Math.max(a, b);
	const lo = Math.min(a, b);
	return (hi + 0.05) / (lo + 0.05);
}

const AA_NORMAL = 4.5;

/**
 * Foreground/background pairs that carry body text or UI labels. Each must clear AA. `muted-foreground` is
 * checked against BOTH `background` and `muted` (it renders on both). These are the pairs a reader actually
 * reads — chart/border/ring/warning tokens are decorative or status accents (AA-large at most), so they are
 * not asserted as AA-normal here (a future enhancement could add AA-large 3:1 for those).
 *
 * `destructive` is asserted BOTH WAYS because the app uses it in both roles:
 *  - as INK (`text-destructive` — the standard inline form/fetch error style) over every surface body text
 *    lands on, so it must clear AA against `card`/`background`/`popover`/`muted`;
 *  - as a FILL (`bg-destructive` on a confirm button), where `destructive-foreground` is its label.
 * Those two roles pull the token in opposite directions in dark mode — readable red ink on a near-black
 * card has to be LIGHT, which in turn forces the button label to be DARK — which is exactly why
 * `destructive-foreground` is a per-variant token rather than a fixed white.
 */
const TEXT_PAIRS: ReadonlyArray<readonly [ThemeTokenKey, ThemeTokenKey]> = [
	['foreground', 'background'],
	['card-foreground', 'card'],
	['popover-foreground', 'popover'],
	['primary-foreground', 'primary'],
	['secondary-foreground', 'secondary'],
	['accent-foreground', 'accent'],
	['muted-foreground', 'background'],
	['muted-foreground', 'muted'],
	['sidebar-foreground', 'sidebar'],
	['sidebar-primary-foreground', 'sidebar-primary'],
	['sidebar-accent-foreground', 'sidebar-accent'],
	['destructive-foreground', 'destructive'],
	['destructive', 'card'],
	['destructive', 'background'],
	['destructive', 'popover'],
	['destructive', 'muted']
];

describe('every built-in theme clears WCAG AA on text pairs (D4 hard gate)', () => {
	// Sanity: the converter is correct. Pure white vs pure black is exactly 21:1.
	test('the contrast converter is calibrated (white/black ≈ 21:1)', () => {
		expect(contrast('oklch(1 0 0)', 'oklch(0 0 0)')).toBeGreaterThan(20.9);
	});

	describe.each(Object.values(THEME_REGISTRY))('theme "$id"', theme => {
		describe.each(['light', 'dark'] as const)('%s variant', variant => {
			const tokens = theme[variant] as ThemeTokens;
			test.each(TEXT_PAIRS)('%s on %s ≥ AA 4.5', (fg, bg) => {
				const ratio = contrast(tokens[fg], tokens[bg]);
				expect(
					ratio,
					`${theme.id}.${variant}: ${fg} on ${bg} = ${ratio.toFixed(2)}:1 (need ≥ ${AA_NORMAL})`
				).toBeGreaterThanOrEqual(AA_NORMAL);
			});
		});
	});

	// Non-vacuity floor: a deliberately bad pair must FAIL, proving the assertion can fail.
	test('a known low-contrast pair is correctly rejected (non-vacuous)', () => {
		expect(contrast('oklch(0.7 0 0)', 'oklch(0.75 0 0)')).toBeLessThan(AA_NORMAL);
	});
});

/**
 * CHART-SERIES GRAPHICAL CONTRAST (WCAG 1.4.11, 3:1) — every NON-default theme's chart-1..5 must clear 3:1
 * against the surface they render on (`card` — analytics charts live in ChartCard). The TEXT_PAIRS gate
 * above deliberately excludes chart tokens (they carry no text), but a chart SERIES is a graphical object a
 * user must distinguish from its background, so the relevant bar is the 3:1 non-text threshold, not 4.5.
 *
 * WHY this guard exists: the scout established firsthand that all 8 then-shipped
 * non-default themes clear 3:1 chart-vs-card, and ONLY `default` falls below on three tokens — but `default`
 * is the VERBATIM app.css palette locked by the identity contract (changing it breaks that guard + is
 * a product call on the shipped look), so it is EXCLUDED here. Nothing enforced the property
 * for NEW themes: the y2k fill-in (and the remaining neobrutalist/claymorphism/brutalist/zine) could
 * ship a pale chart token below 3:1 and NO guard would catch it (contrast checks only text pairs; metadata/
 * distinctness/byte-freshness check structure, not chart legibility). This codifies the invariant so a
 * future low-contrast chart token trips RED before merge — the durable artifact from the bug-dry scout.
 */
const CHART_KEYS: readonly ThemeTokenKey[] = [
	'chart-1',
	'chart-2',
	'chart-3',
	'chart-4',
	'chart-5',
	// The palette extends to 8 so a ≥6-vehicle fleet gets distinct series colors. The new tokens are
	// held to the SAME 3:1-vs-card graphical bar as 1-5 (every non-default theme defines all 8).
	'chart-6',
	'chart-7',
	'chart-8'
];
const AA_GRAPHICAL = 3.0;
// The `default` palette had 3 chart tokens below 3:1 vs card (light chart-4 1.72 + chart-5
// 2.15, dark chart-1 2.60) — the carve-out that excluded `default` from this gate. Those 3 tokens were
// re-tuned (a minimal L nudge, hue+chroma preserved) so `default` now clears 3:1 on ALL 8 chart tokens too,
// and the `default ≡ app.css` identity guard was rebaselined in the SAME commit to the new values. With the
// carve-out gone, EVERY built-in theme (default included) is now held to the 3:1 chart-vs-card bar.
const allThemes = Object.values(THEME_REGISTRY);

describe('every built-in theme clears WCAG 3:1 on chart series vs card (graphical gate, default folded in)', () => {
	describe.each(allThemes)('theme "$id"', theme => {
		describe.each(['light', 'dark'] as const)('%s variant', variant => {
			const tokens = theme[variant] as ThemeTokens;
			test.each(CHART_KEYS)('%s on card ≥ 3:1', chart => {
				const ratio = contrast(tokens[chart], tokens.card);
				expect(
					ratio,
					`${theme.id}.${variant}: ${chart} on card = ${ratio.toFixed(2)}:1 (need ≥ ${AA_GRAPHICAL} — a chart series must be distinguishable from its surface)`
				).toBeGreaterThanOrEqual(AA_GRAPHICAL);
			});
		});
	});
});

/**
 * DESTRUCTIVE-FILL FOREGROUND GUARD — the other half of the AA gate above. The contrast math pins that
 * `destructive-foreground` on `destructive` is readable in every theme; this pins that the app's hand-rolled
 * destructive fills actually ASK for it.
 *
 * Why an unnamed foreground is a silent failure rather than a cosmetic slip: `AlertDialogAction` renders
 * `cn(buttonVariants(), className)`, and `buttonVariants()` takes no variant — so its DEFAULT
 * `bg-primary text-primary-foreground` is always in the class list. A `class="bg-destructive …"` overrides
 * only the background, leaving `text-primary-foreground` — a colour chosen to read on the PRIMARY fill — as
 * the label on a red one. It looks fine in the `default` palette (whose primary ink happens to invert the
 * same way) and is unreadable in others: measured 2.79:1 in bento/dark and 3.04:1 in vaporwave/dark.
 *
 * Scope: only a FULL-STRENGTH `bg-destructive` fill (opacity-modified washes like `bg-destructive/10` are
 * tints under `text-destructive` ink, covered by the pairs above) and only outside `components/ui/`, whose
 * button/badge variants deliberately pair their own dark-mode composite (`dark:bg-destructive/60`) with
 * `text-white` — the carve-out `no-theme-clashing-colors.test.ts` already records.
 *
 * The assertion is exact rather than "at most these", so the pending list can only ever shrink.
 */
describe('hand-rolled bg-destructive fills name their foreground', () => {
	const SRC_ROOT = join(import.meta.dirname, '..', '..', '..');

	/** `.svelte` files under src/, excluding the kit (`lib/components/ui/`). */
	function appSvelteFiles(dir: string, acc: string[] = []): string[] {
		for (const entry of readdirSync(dir)) {
			const full = join(dir, entry);
			if (statSync(full).isDirectory()) {
				appSvelteFiles(full, acc);
			} else if (entry.endsWith('.svelte')) {
				acc.push(full);
			}
		}
		return acc;
	}

	/** A bare `bg-destructive` utility — no variant prefix (`dark:`), no opacity modifier (`/60`). */
	const BARE_FILL = /(?<![\w/:[\]&-])bg-destructive(?![\w/-])/;

	const appFiles = [
		...appSvelteFiles(join(SRC_ROOT, 'routes')),
		...appSvelteFiles(join(SRC_ROOT, 'lib'))
	].filter(f => !relative(SRC_ROOT, f).split(sep).join('/').startsWith('lib/components/ui/'));

	/** Each file's bare-destructive-fill class strings, split by whether they name the matching ink. */
	function fills(file: string): { named: string[]; unnamed: string[] } {
		const source = readFileSync(file, 'utf8');
		const named: string[] = [];
		const unnamed: string[] = [];
		// Per quoted class string: a bare destructive fill must carry the matching ink in the SAME string.
		for (const [, , classString] of source.matchAll(/(['"])([^'"\n]*bg-destructive[^'"\n]*)\1/g)) {
			if (!classString || !BARE_FILL.test(classString)) continue;
			(classString.includes('text-destructive-foreground') ? named : unnamed).push(classString);
		}
		return { named, unnamed };
	}

	/**
	 * Destructive confirm buttons that still inherit `text-primary-foreground` — a live sub-AA label
	 * in at least one theme. Fixing one means appending `text-destructive-foreground` to its class
	 * string; the ratchet then tells you to delete its entry here.
	 */
	const PENDING_UNNAMED_DESTRUCTIVE_INK: string[] = [];

	ratchet({
		name: 'bare bg-destructive fills name their own ink',
		tolerated: PENDING_UNNAMED_DESTRUCTIVE_INK,
		guidance:
			'A full-strength `bg-destructive` fill with no `text-destructive-foreground` keeps ' +
			"buttonVariants()'s `text-primary-foreground` — ink tuned for the PRIMARY fill, which is " +
			'sub-AA on red in several themes. Add the class to these:',
		scan: () =>
			appFiles
				.filter(f => fills(f).unnamed.length > 0)
				.map(f => relative(SRC_ROOT, f).split(sep).join('/')),
		probe: () => {
			// Fixtures, not live offenders: asserting that a real component still offends would break
			// as soon as the tolerated list reached zero, which is the goal state.
			expect(BARE_FILL.test('bg-destructive hover:bg-destructive/90')).toBe(true);
			expect(BARE_FILL.test('bg-destructive/60 text-white')).toBe(false);
			// And that the walk reaches the tree at all — a scan over nothing passes a subset check.
			expect(
				appFiles.length,
				'the .svelte walk found almost nothing — SRC_ROOT is wrong'
			).toBeGreaterThan(50);
		}
	});
});
