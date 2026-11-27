import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
const read = (file: string) => readFileSync(join(HERE, '..', file), 'utf8');

describe('time-series charts keep the first x label off the y labels', () => {
	test.each(['AppLineChart.svelte', 'AppAreaChart.svelte'])(
		'%s insets its x scale and drops ticks inside the inset',
		file => {
			const src = read(file);
			expect(src).toContain('xPadding={TIME_X_PADDING}');
			expect(src).toMatch(/xAxis: \{\s*\.\.\.\w+,\s*ticks: insetTimeTicks\(/);
		}
	);
});

describe('x labels at the plot edges stay inside the chart', () => {
	test.each(['AppLineChart.svelte', 'AppAreaChart.svelte', 'AppBarChart.svelte'])(
		'%s draws its x tick labels with EdgeTickLabel',
		file => {
			const src = read(file);
			expect(src).toMatch(/<EdgeTickLabel \{props\}( clearGutter)? \/>/);
			expect(src).toContain('tickLabel: edgeTickLabel');
		}
	);
});
