import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

const CHART_5 =
	/\b(?:text|bg|border|fill|stroke|ring|outline|from|via|to|decoration|accent)-chart-5\b|var\(--chart-5\)/g;

const CATEGORY_USES: Record<string, number> = {
	'lib/components/vehicles/CostPerMileHero.svelte': 1,
	'lib/utils/expense-helpers.ts': 2,
	'lib/utils/chart-colors.ts': 2,
	'routes/+page.svelte': 2
};

function sourceFiles(dir: string): string[] {
	return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
		const full = join(dir, entry.name);
		if (entry.isDirectory()) return entry.name === '__tests__' ? [] : sourceFiles(full);
		return /\.(svelte|ts)$/.test(entry.name) ? [full] : [];
	});
}

function chart5Uses(): Record<string, number> {
	const uses: Record<string, number> = {};
	for (const file of sourceFiles(SRC)) {
		const rel = relative(SRC, file).replace(/\\/g, '/');
		if (rel.startsWith('lib/components/charts/') || rel.startsWith('lib/theme/')) continue;
		const count = readFileSync(file, 'utf8').match(CHART_5)?.length ?? 0;
		if (count > 0) uses[rel] = count;
	}
	return uses;
}

describe('status colours use the warning token, not chart-5', () => {
	test('chart-5 appears only in the category and decorative uses, and no more often', () => {
		expect(chart5Uses()).toEqual(CATEGORY_USES);
	});
});
