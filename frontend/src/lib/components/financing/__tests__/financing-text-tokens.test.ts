import { readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';
import { collectSvelteFiles } from '../../../utils/__tests__/_helpers/collect-svelte-files';

const FINANCING_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');
const FINANCE_TAB = join(FINANCING_DIR, '..', 'vehicles', 'FinanceTab.svelte');

const OPACITY_TEXT_TOKEN = /\btext-(?:muted-foreground|foreground|primary)\/\d+/;
const SUB_12PX_TEXT = /\btext-\[(?:[0-9]|1[01])(?:\.\d+)?px\]/;

const files = [...collectSvelteFiles(FINANCING_DIR), FINANCE_TAB];

describe('financing text uses the design-guide text tokens', () => {
	test('the matchers catch what they police', () => {
		expect(OPACITY_TEXT_TOKEN.test('class="text-muted-foreground/60"')).toBe(true);
		expect(OPACITY_TEXT_TOKEN.test('class="text-foreground/80"')).toBe(true);
		expect(OPACITY_TEXT_TOKEN.test('class="text-muted-foreground"')).toBe(false);
		expect(OPACITY_TEXT_TOKEN.test('class="bg-primary/10 text-primary"')).toBe(false);
		expect(SUB_12PX_TEXT.test('class="text-[10px]"')).toBe(true);
		expect(SUB_12PX_TEXT.test('class="text-[11.5px]"')).toBe(true);
		expect(SUB_12PX_TEXT.test('class="text-[12px]"')).toBe(false);
		expect(files.length).toBeGreaterThan(5);
	});

	test('no opacity-reduced text tokens and nothing below 12px', () => {
		const offenders = files
			.filter(file => {
				const source = readFileSync(file, 'utf8');
				return OPACITY_TEXT_TOKEN.test(source) || SUB_12PX_TEXT.test(source);
			})
			.map(file => relative(FINANCING_DIR, file));
		expect(offenders).toEqual([]);
	});
});
