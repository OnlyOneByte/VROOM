import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
const read = (file: string) => readFileSync(join(HERE, '..', file), 'utf8');

describe('time-series charts keep the first x label off the y labels', () => {
	test.each([
		'AppLineChart.svelte',
		'AppAreaChart.svelte',
		'ExpenseTrendChart.svelte',
		'FuelEfficiencyTrendChart.svelte'
	])('%s insets its x scale from the y axis', file => {
		expect(read(file)).toMatch(/padding=\{CHART_PADDING\}\s+xPadding=\{TIME_X_PADDING\}/);
	});
});
