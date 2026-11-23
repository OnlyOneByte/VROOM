import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(HERE, '..', '+page.svelte'), 'utf8');

describe('/expenses import and export tools on mobile', () => {
	test('the inline import/export buttons render only from sm: up', () => {
		expect(SRC).toMatch(/class="hidden sm:flex[^"]*">\s*\{@render importExportActions\('outline'/);
	});

	test('below sm: the same actions sit behind one 40px icon-only menu trigger', () => {
		expect(SRC).toMatch(/<div class="shrink-0 sm:hidden">\s*<Popover\.Root/);
		expect(SRC).toMatch(
			/variant="outline" size="icon-lg" aria-label="Import and export">\s*<Ellipsis[^>]*\/>\s*<\/Button>/
		);
		expect(SRC).toMatch(/<Popover\.Content[\s\S]{0,120}\{@render importExportActions\('ghost'/);
		expect(SRC).toMatch(/<Popover\.Content[^>]*gap-2/);
	});
});
