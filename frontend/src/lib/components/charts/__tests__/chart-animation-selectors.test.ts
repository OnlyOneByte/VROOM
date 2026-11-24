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

	test('the bars and the current-period bar wipe against one shared box, so they rise together', () => {
		const css = read(HERE, '..', 'bar-chart-animations.css');
		const clips = css.match(/clip-path:[^;]+;/g) ?? [];
		expect(clips.length).toBeGreaterThan(0);
		for (const clip of clips) expect(clip).toContain('view-box');
	});

	test('lines reveal along the path class LayerChart draws', () => {
		expect(read(LAYERCHART, 'Path', 'Path.svg.svelte')).toContain("clsx('lc-path'");
		expect(read(HERE, '..', 'line-chart-animations.css')).toContain('.lc-path');
	});
});
