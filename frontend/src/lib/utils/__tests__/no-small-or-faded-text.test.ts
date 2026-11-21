import { readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect } from 'vitest';
import { ratchet } from './_helpers/debt-ratchet';
import { collectSvelteFiles } from './_helpers/collect-svelte-files';

const SRC_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

const BELOW_TEXT_XS =
	/\btext-\[(?:\d|1[01])(?:\.\d+)?px\]|\btext-\[0?\.(?:[0-6]\d*|7(?:[0-4]\d*)?)rem\]/;
const FADED_TEXT_TOKEN =
	/\btext-(?:[a-z]+-)*(?:foreground|primary|destructive|success|warning)\/(?:\d+\b|\[)/;

const files = collectSvelteFiles(SRC_ROOT);
const rel = (file: string) => relative(SRC_ROOT, file).replace(/\\/g, '/');

function offenders(): Map<string, string> {
	const found = new Map<string, string>();
	for (const file of files) {
		const lines = readFileSync(file, 'utf-8').split('\n');
		for (const [index, line] of lines.entries()) {
			const match = line.match(BELOW_TEXT_XS) ?? line.match(FADED_TEXT_TOKEN);
			if (match && !found.has(rel(file))) {
				found.set(rel(file), `${rel(file)}:${index + 1} → ${match[0]}`);
			}
		}
	}
	return found;
}

const detail = offenders();

ratchet({
	name: 'no text below text-xs and no opacity on text tokens',
	tolerated: [],
	guidance:
		'Text below 12px or a text token with an opacity modifier (UIQuality.md, Typography and ' +
		'"Opacity eats contrast"). Use text-xs as the floor and the token as-is ' +
		`(text-muted-foreground, text-foreground, text-primary):\n${[...detail.values()].join('\n')}\nOffending files:`,
	scan: () => [...detail.keys()],
	probe: () => {
		expect(BELOW_TEXT_XS.test('<span class="text-[10px]">')).toBe(true);
		expect(BELOW_TEXT_XS.test('<span class="text-[11.5px]">')).toBe(true);
		expect(BELOW_TEXT_XS.test('<span class="text-[0.625rem]">')).toBe(true);
		expect(BELOW_TEXT_XS.test('<span class="text-[0.7rem]">')).toBe(true);
		expect(BELOW_TEXT_XS.test('<span class="text-[.7rem]">')).toBe(true);
		expect(BELOW_TEXT_XS.test('<span class="text-[12px] text-xs">')).toBe(false);
		expect(BELOW_TEXT_XS.test('<span class="text-[0.75rem]">')).toBe(false);
		expect(FADED_TEXT_TOKEN.test('<p class="text-muted-foreground/60">')).toBe(true);
		expect(FADED_TEXT_TOKEN.test('<p class="hover:text-primary/80">')).toBe(true);
		expect(FADED_TEXT_TOKEN.test('<p class="text-destructive/90">')).toBe(true);
		expect(FADED_TEXT_TOKEN.test('<p class="text-primary/[0.8]">')).toBe(true);
		expect(FADED_TEXT_TOKEN.test('<p class="text-muted-foreground bg-primary/10">')).toBe(false);
		expect(
			files.length,
			'the .svelte walk found almost nothing — SRC_ROOT is wrong'
		).toBeGreaterThan(20);
	}
});
