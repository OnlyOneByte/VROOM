import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
const read = (file: string) => readFileSync(join(HERE, '..', file), 'utf8');

describe('charts draw at their height, not the container default 16:9', () => {
	test.each([
		['AppBarChart.svelte', 'height'],
		['AppLineChart.svelte', 'height'],
		['AppAreaChart.svelte', 'height']
	])('%s sizes the box around its chart container to {%s}px', (file, heightVar) => {
		const src = read(file);
		expect(src).toMatch(
			new RegExp(
				`<div style="height: \\{${heightVar}\\}px">\\s*<Chart\\.Container[^>]*class="h-full w-full"`
			)
		);
		expect(src.match(/<Chart\.Container/g)).toHaveLength(1);
	});
});
