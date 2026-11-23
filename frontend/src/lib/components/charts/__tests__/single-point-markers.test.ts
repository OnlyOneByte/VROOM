import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
const read = (file: string) => readFileSync(join(HERE, '..', file), 'utf8');

describe('charts draw a marker for a value a line or area cannot show', () => {
	test.each(['AppLineChart.svelte', 'AppAreaChart.svelte'])(
		'%s marks every value with no neighbouring value',
		file => {
			const src = read(file);
			expect(src).toContain('isolatedValueRows(');
			expect(src).toContain('{#snippet points()}');
			expect(src).toMatch(
				/\{#each isolatedValues as isolated \(isolated\.key\)\}\s*<Points\s+seriesKey=\{isolated\.key\}\s+data=\{isolated\.rows\}/
			);
		}
	);

	test.each(['ExpenseTrendChart.svelte', 'FuelEfficiencyTrendChart.svelte'])(
		'%s draws through AppLineChart, so it shares the markers, axis inset and height',
		file => {
			const src = read(file);
			expect(src).toContain("import AppLineChart from './AppLineChart.svelte';");
			expect(src).toMatch(/<AppLineChart\b/);
			expect(src).not.toMatch(/from 'layerchart'/);
		}
	);
});
