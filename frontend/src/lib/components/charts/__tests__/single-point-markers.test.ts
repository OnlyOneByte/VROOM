import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
const LINE_CHARTS = [
	'AppLineChart.svelte',
	'ExpenseTrendChart.svelte',
	'FuelEfficiencyTrendChart.svelte'
];

describe('line charts draw a marker when there is only one point', () => {
	test.each(LINE_CHARTS)('%s turns on LineChart points for a single data point', file => {
		const src = readFileSync(join(HERE, '..', file), 'utf8');
		expect(src).toContain('points={data.length === 1}');
		expect(src).toContain('...getTrendLineProps(data.length)');
	});
});
