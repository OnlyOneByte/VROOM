import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';
import { getTrendLineProps } from '../chart-curves';

const UTILS = join(dirname(fileURLToPath(import.meta.url)), '..');

function runtimePackageImports(file: string): string[] {
	const source = readFileSync(join(UTILS, file), 'utf8');
	return [...source.matchAll(/^import\s+(?!type\s)[^;]*?from\s+['"]([^'"]+)['"]/gm)]
		.map(match => match[1] ?? '')
		.filter(specifier => !specifier.startsWith('.'));
}

describe('getTrendLineProps (single-point visibility branch)', () => {
	test('a single (or zero) data point gets an enlarged filled dot so the lone value is visible', () => {
		expect(getTrendLineProps(1).points.r).toBe(6);
		expect(getTrendLineProps(0).points.r).toBe(6);
	});

	test('two or more points use the standard trend dot (r:4)', () => {
		expect(getTrendLineProps(2).points.r).toBe(4);
		expect(getTrendLineProps(12).points.r).toBe(4);
	});
});

describe('chart-formatters stays free of chart runtime code', () => {
	test('pages load chart-formatters up front, so it imports no package at runtime', () => {
		expect(runtimePackageImports('chart-formatters.ts')).toEqual([]);
	});

	test('the curve code lives in chart-curves, which does import d3-shape', () => {
		expect(runtimePackageImports('chart-curves.ts')).toEqual(['d3-shape']);
	});
});
