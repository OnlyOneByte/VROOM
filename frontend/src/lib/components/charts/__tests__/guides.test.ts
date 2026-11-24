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

	test('every guide reads as its true value, never a rounded one', () => {
		const whole = (v: number) => v.toFixed(0);
		for (const domain of [
			[27, 30],
			[0, 35],
			[0, 140],
			[3, 7]
		] as const) {
			for (const tick of guideTicks(whole)(scaleLinear().domain(domain))) {
				expect(Number(whole(tick))).toBe(tick);
			}
		}
	});

	test('an axis that ends between round values still gets three guides across most of it', () => {
		expect(guideTicks(tenths)(scaleLinear().domain([0, 35]))).toEqual([0, 15, 30]);
		expect(guideTicks(dollars)(scaleLinear().domain([0, 140]))).toEqual([0, 70, 140]);
	});

	test('when three guides would leave much of a short axis bare, every distinct tick shows', () => {
		const whole = (v: number) => v.toFixed(0);
		expect(guideTicks(whole)(scaleLinear().domain([27, 30]))).toEqual([27, 28, 29, 30]);
	});

	test('a flat range still gets readable guides', () => {
		expect(guideTicks(dollars)(scaleLinear().domain([0, 0])).length).toBeGreaterThan(0);
	});
});
