import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');

function svelteFiles(dir: string): string[] {
	return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
		const full = join(dir, entry.name);
		if (entry.isDirectory()) return svelteFiles(full);
		return entry.name.endsWith('.svelte') ? [full] : [];
	});
}

const tooltipTags = svelteFiles(SRC).flatMap(file => {
	const src = readFileSync(file, 'utf8');
	return [...src.matchAll(/<(?:Chart\.Tooltip|ChartTooltip)\b[\s\S]*?\/>/g)].map(m => ({
		file: relative(SRC, file),
		tag: m[0]
	}));
});

describe('every chart tooltip formats its value', () => {
	test('the scan finds the chart tooltips', () => {
		expect(tooltipTags.length).toBeGreaterThanOrEqual(9);
	});

	test.each(tooltipTags)('$file passes a value formatter', ({ tag }) => {
		expect(tag).toContain('valueFormatter=');
	});

	test('only pie tooltips hide the point label, because the slice name is the label', () => {
		const hidden = tooltipTags.filter(t => t.tag.includes('hideLabel')).map(t => t.file);
		expect(hidden.sort()).toEqual(
			[
				'lib/components/analytics/cross-vehicle/FinancingAnalytics.svelte',
				'lib/components/charts/AppPieChart.svelte'
			].sort()
		);
	});
});
