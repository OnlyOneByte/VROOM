import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
const read = (file: string) => readFileSync(join(HERE, '..', file), 'utf8');

describe('charts draw a marker for a series with only one value', () => {
	test.each(['ExpenseTrendChart.svelte', 'FuelEfficiencyTrendChart.svelte'])(
		'%s turns on LineChart points for a single data point',
		file => {
			const src = read(file);
			expect(src).toContain('points={data.length === 1}');
			expect(src).toContain('...getTrendLineProps(data.length)');
		}
	);

	test.each(['AppLineChart.svelte', 'AppAreaChart.svelte'])(
		'%s marks each series that has exactly one value',
		file => {
			const src = read(file);
			expect(src).toContain('singleValueSeriesKeys(');
			expect(src).toContain('{#snippet points()}');
			expect(src).toMatch(
				/\{#each singleValueKeys as key \(key\)\}\s*<Points\s+seriesKey=\{key\}\s+data=\{data\.filter\(row => row\[key\] != null\)\}/
			);
		}
	);
});
