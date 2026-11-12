import { readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect } from 'vitest';
import { ratchet } from './_helpers/debt-ratchet';
import { collectSvelteFiles } from './_helpers/collect-svelte-files';

const SRC_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

const THEME_CLASH =
	/(?<!dark:)\b(?:bg|text|border)-(?:white|black|gray-\d+|slate-\d+|zinc-\d+|neutral-\d+)(?:\/\d+)?\b/;

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
		expect(THEME_CLASH.test('<div class="bg-white p-4">')).toBe(true);
		expect(THEME_CLASH.test('<div class="text-gray-500">')).toBe(true);
		expect(THEME_CLASH.test('<div class="bg-black/50">')).toBe(true);
		expect(THEME_CLASH.test('<div class="dark:bg-gray-800">')).toBe(false);
		expect(THEME_CLASH.test('<div class="bg-background text-muted-foreground">')).toBe(false);
		expect(THEME_CLASH.test('<div class="border-border">')).toBe(false);
		expect(
			files.length,
			'the .svelte walk found almost nothing — SRC_ROOT is wrong'
		).toBeGreaterThan(20);
	}
});
