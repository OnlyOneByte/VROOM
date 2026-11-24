import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
const LAYERCHART = join(
	HERE,
	'..',
	'..',
	'..',
	'..',
	'..',
	'node_modules',
	'layerchart',
	'dist',
	'components'
);

function read(...parts: string[]): string {
	return readFileSync(join(...parts), 'utf8');
}

describe('chart entry animations target classes LayerChart renders', () => {
	test('bars grow from the bars group LayerChart draws', () => {
		expect(read(LAYERCHART, 'Bars', 'Bars.base.svelte')).toContain('<Group class="lc-bars">');
		expect(read(HERE, '..', 'bar-chart-animations.css')).toContain('.lc-bars,');
	});

	test('lines reveal along the path class LayerChart draws', () => {
		expect(read(LAYERCHART, 'Path', 'Path.svg.svelte')).toContain("clsx('lc-path'");
		expect(read(HERE, '..', 'line-chart-animations.css')).toContain('.lc-path');
	});
});
