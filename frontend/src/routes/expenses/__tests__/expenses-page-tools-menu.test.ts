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

	test('below sm: the same actions sit behind one 40px menu trigger', () => {
		expect(SRC).toMatch(/<div class="sm:hidden">\s*<Popover\.Root/);
		expect(SRC).toMatch(/variant="outline" size="lg">\s*<Ellipsis[^>]*\/>\s*Import & export/);
		expect(SRC).toMatch(/<Popover\.Content[\s\S]{0,120}\{@render importExportActions\('ghost'/);
		expect(SRC).toMatch(/<Popover\.Content[^>]*gap-2/);
	});
});
