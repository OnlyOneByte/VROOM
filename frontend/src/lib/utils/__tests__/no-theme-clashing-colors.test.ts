import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';
import { ratchet } from './_helpers/debt-ratchet';
import { collectSvelteFiles } from './_helpers/collect-svelte-files';

const SRC_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

const TAILWIND_THEME_CSS = readFileSync(
	createRequire(import.meta.url).resolve('tailwindcss/theme.css'),
	'utf-8'
);

const PALETTE_FAMILIES = [
	...new Set([...TAILWIND_THEME_CSS.matchAll(/--color-([a-z]+)-\d+:/g)].map(m => m[1]))
].join('|');

const THEME_CLASH = new RegExp(
	`(?<!dark:)\\b(?:bg|text|border)-(?:white|black|(?:${PALETTE_FAMILIES})-\\d+)(?:\\/\\d+)?\\b`
);

const RAW_CSS_COLOR = /\b(?:rgba?|hsla?)\(|#[0-9a-fA-F]{3,8}\b/;

const files = collectSvelteFiles(SRC_ROOT);
const rel = (file: string) => relative(SRC_ROOT, file).replace(/\\/g, '/');

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

const detail = hits();

ratchet({
	name: 'no theme-clashing hardcoded colors in components',
	kind: 'exclusion',
	tolerated: [
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
		expect(THEME_CLASH.test('<div class="bg-white p-4">')).toBe(true);
		expect(THEME_CLASH.test('<div class="text-gray-500">')).toBe(true);
		expect(THEME_CLASH.test('<div class="bg-black/50">')).toBe(true);
		expect(THEME_CLASH.test('<div class="dark:bg-gray-800">')).toBe(false);
		expect(THEME_CLASH.test('<div class="bg-background text-muted-foreground">')).toBe(false);
		expect(THEME_CLASH.test('<div class="border-border">')).toBe(false);
		expect(THEME_CLASH.test('<div class="bg-yellow-50 text-green-800">')).toBe(true);
		expect(THEME_CLASH.test('<div class="border-rose-200/50">')).toBe(true);
		expect(THEME_CLASH.test('<div class="bg-mauve-50">')).toBe(true);
		expect(PALETTE_FAMILIES.split('|').length).toBeGreaterThan(20);
		expect(
			files.length,
			'the .svelte walk found almost nothing — SRC_ROOT is wrong'
		).toBeGreaterThan(20);
	}
});

describe('app.css paints only with theme tokens', () => {
	const APP_CSS = readFileSync(join(SRC_ROOT, 'app.css'), 'utf-8');

	test('no raw rgb()/hsl()/hex colour literals', () => {
		const offending = APP_CSS.split('\n')
			.map((line, index) => ({ line: line.trim(), number: index + 1 }))
			.filter(({ line }) => !line.endsWith('{') && !line.endsWith(','))
			.filter(({ line }) => RAW_CSS_COLOR.test(line))
			.map(({ line, number }) => `app.css:${number} → ${line}`);
		expect(offending, 'use var(--token) instead of a literal colour').toEqual([]);
	});

	test('the literal detector is non-vacuous', () => {
		expect(RAW_CSS_COLOR.test('background-color: rgb(254 242 242) !important;')).toBe(true);
		expect(RAW_CSS_COLOR.test('color: #fff;')).toBe(true);
		expect(RAW_CSS_COLOR.test('background-color: var(--card) !important;')).toBe(false);
		expect(RAW_CSS_COLOR.test('--chart-1: oklch(0.646 0.222 41.116);')).toBe(false);
	});
});
