import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');

function sourceFiles(dir: string): string[] {
	return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
		const full = join(dir, entry.name);
		if (entry.isDirectory()) return entry.name === '__tests__' ? [] : sourceFiles(full);
		return /\.(svelte|ts)$/.test(entry.name) ? [full] : [];
	});
}

const ALLOWED = ['lib/components/charts/', 'lib/components/ui/chart/', 'lib/utils/'];

describe('charts go through the shared wrappers', () => {
	test('only the chart components and chart utils import layerchart', () => {
		const importers = sourceFiles(SRC)
			.filter(file => /from ['"]layerchart['"]/.test(readFileSync(file, 'utf8')))
			.map(file => relative(SRC, file).replace(/\\/g, '/'));

		expect(importers.length).toBeGreaterThan(0);
		expect(importers.filter(file => !ALLOWED.some(dir => file.startsWith(dir)))).toEqual([]);
	});
});
