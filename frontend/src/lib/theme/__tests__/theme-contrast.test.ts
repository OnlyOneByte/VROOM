import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, expect, test } from 'vitest';
import { ratchet } from '#lib/utils/__tests__/_helpers/debt-ratchet.ts';
import { THEME_REGISTRY } from '../theme-registry';
import type { ThemeTokenKey, ThemeTokens } from '../theme-types';

function parseOklch(s: string): { L: number; C: number; H: number } {
	const m = s.match(/oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*[\d.]+%?)?\s*\)/);
	if (!m) throw new Error(`not an oklch() value: ${s}`);
	return { L: Number(m[1]), C: Number(m[2]), H: Number(m[3]) };
}

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

function luminance(oklch: string): number {
	const { r, g, b } = oklchToLinearRGB(oklch);
	return 0.2126 * clamp01(r) + 0.7152 * clamp01(g) + 0.0722 * clamp01(b);
}

function contrast(fg: string, bg: string): number {
	const a = luminance(fg);
	const b = luminance(bg);
	const hi = Math.max(a, b);
	const lo = Math.min(a, b);
	return (hi + 0.05) / (lo + 0.05);
}

const AA_NORMAL = 4.5;

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

describe('every built-in theme clears WCAG AA on text pairs', () => {
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

	test('a known low-contrast pair is correctly rejected (non-vacuous)', () => {
		expect(contrast('oklch(0.7 0 0)', 'oklch(0.75 0 0)')).toBeLessThan(AA_NORMAL);
	});
});

const CHART_KEYS: readonly ThemeTokenKey[] = [
	'chart-1',
	'chart-2',
	'chart-3',
	'chart-4',
	'chart-5',
	'chart-6',
	'chart-7',
	'chart-8'
];
const AA_GRAPHICAL = 3.0;
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

describe('hand-rolled bg-destructive fills name their foreground', () => {
	const SRC_ROOT = join(import.meta.dirname, '..', '..', '..');

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

	const BARE_FILL = /(?<![\w/:[\]&-])bg-destructive(?![\w/-])/;

	const appFiles = [
		...appSvelteFiles(join(SRC_ROOT, 'routes')),
		...appSvelteFiles(join(SRC_ROOT, 'lib'))
	].filter(f => !relative(SRC_ROOT, f).split(sep).join('/').startsWith('lib/components/ui/'));

	function fills(file: string): { named: string[]; unnamed: string[] } {
		const source = readFileSync(file, 'utf8');
		const named: string[] = [];
		const unnamed: string[] = [];
		for (const [, , classString] of source.matchAll(/(['"])([^'"\n]*bg-destructive[^'"\n]*)\1/g)) {
			if (!classString || !BARE_FILL.test(classString)) continue;
			(classString.includes('text-destructive-foreground') ? named : unnamed).push(classString);
		}
		return { named, unnamed };
	}

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
			expect(BARE_FILL.test('bg-destructive hover:bg-destructive/90')).toBe(true);
			expect(BARE_FILL.test('bg-destructive/60 text-white')).toBe(false);
			expect(
				appFiles.length,
				'the .svelte walk found almost nothing — SRC_ROOT is wrong'
			).toBeGreaterThan(50);
		}
	});
});
