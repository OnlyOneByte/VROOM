import { describe, expect, test } from 'vitest';
import { scaleLinear } from 'd3-scale';
import { guideTicks } from '../guides.ts';

const dollars = (v: number) => `$${v}`;
const tenths = (v: number) => v.toFixed(1);

describe('guideTicks', () => {
	test('three evenly spaced values from the nice ticks', () => {
		expect(guideTicks(dollars)(scaleLinear().domain([0, 6000]))).toEqual([0, 3000, 6000]);
		expect(guideTicks(tenths)(scaleLinear().domain([3.5, 3.7]))).toEqual([3.5, 3.6, 3.7]);
	});

	test('the three values always read differently', () => {
		const ticks = guideTicks(tenths)(scaleLinear().domain([3.55, 3.6]));
		expect(new Set(ticks.map(tenths)).size).toBe(ticks.length);
	});

	test('a flat range still gets readable guides', () => {
		expect(guideTicks(dollars)(scaleLinear().domain([0, 0])).length).toBeGreaterThan(0);
	});
});
