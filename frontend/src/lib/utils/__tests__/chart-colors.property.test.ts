/**
 * Property-Based Tests for chart-colors utilities
 *
 * Property 8: Category maps completeness
 * Property 9: assignSeriesColors length and order preservation
 * Property 10: buildChartConfig structure preservation
 * Property 11: buildCategoryPieData correctness
 * Property 12: Category key fallback safety
 */

import { describe, expect, test } from 'vitest';
import fc from 'fast-check';
import {
	CATEGORY_COLORS,
	CATEGORY_LABELS,
	CHART_COLORS,
	assignSeriesColors,
	buildChartConfig,
	buildCategoryPieData,
	getCategoryColor,
	getCategoryLabel
} from '$lib/utils/chart-colors';

const CATEGORY_ENUM = ['fuel', 'maintenance', 'financial', 'regulatory', 'enhancement', 'misc'];

// ---------------------------------------------------------------------------
// Property 8: Category maps completeness
// **Validates: Requirements 11.1, 11.2, 11.4**
// ---------------------------------------------------------------------------
describe('Property 8: Category maps completeness', () => {
	test('CATEGORY_COLORS covers the full enum and uses CSS custom property syntax', () => {
		for (const cat of CATEGORY_ENUM) {
			expect(CATEGORY_COLORS[cat]).toBeDefined();
			expect(CATEGORY_COLORS[cat]).toMatch(/^var\(--/);
		}
		expect(Object.keys(CATEGORY_COLORS).sort()).toEqual([...CATEGORY_ENUM].sort());
	});

	test('CATEGORY_LABELS covers the full enum', () => {
		for (const cat of CATEGORY_ENUM) {
			expect(CATEGORY_LABELS[cat]).toBeDefined();
			expect(typeof CATEGORY_LABELS[cat]).toBe('string');
			expect(CATEGORY_LABELS[cat]!.length).toBeGreaterThan(0);
		}
		expect(Object.keys(CATEGORY_LABELS).sort()).toEqual([...CATEGORY_ENUM].sort());
	});

	test('CHART_COLORS has 5 entries all using CSS custom property syntax', () => {
		expect(CHART_COLORS).toHaveLength(5);
		for (const color of CHART_COLORS) {
			expect(color).toMatch(/^var\(--chart-\d\)$/);
		}
	});
});

// ---------------------------------------------------------------------------
// Property 9: assignSeriesColors length and order preservation
// **Validates: Requirements 12.1, 12.3**
// ---------------------------------------------------------------------------
describe('Property 9: assignSeriesColors length and order preservation', () => {
	test('∀ string array of length N, output has length N, preserves order, all colors from CHART_COLORS', () => {
		fc.assert(
			fc.property(fc.array(fc.string({ minLength: 1 }), { minLength: 0, maxLength: 20 }), keys => {
				const result = assignSeriesColors(keys);
				expect(result).toHaveLength(keys.length);
				for (let i = 0; i < keys.length; i++) {
					expect(result[i]!.key).toBe(keys[i]);
					expect(CHART_COLORS).toContain(result[i]!.color);
					expect(result[i]!.color).toBe(CHART_COLORS[i % CHART_COLORS.length]);
				}
			}),
			{ numRuns: 200 }
		);
	});
});

// ---------------------------------------------------------------------------
// Property 10: buildChartConfig structure preservation
// **Validates: Requirements 13.1, 13.2**
// ---------------------------------------------------------------------------
describe('Property 10: buildChartConfig structure preservation', () => {
	const seriesArb = fc.array(
		fc.record({
			key: fc.string({ minLength: 1, maxLength: 20 }),
			label: fc.string({ minLength: 1, maxLength: 30 }),
			color: fc.constantFrom(...CHART_COLORS)
		}),
		{ minLength: 0, maxLength: 10 }
	);

	test('∀ series array, output has exactly one entry per input item with correct label and color', () => {
		fc.assert(
			fc.property(seriesArb, series => {
				const config = buildChartConfig(series);
				// Last entry wins for duplicate keys (same as the implementation)
				const uniqueKeys = new Set(series.map(s => s.key));
				expect(Object.keys(config)).toHaveLength(uniqueKeys.size);
				for (const s of series) {
					expect(config[s.key]).toBeDefined();
					expect(config[s.key]!.label).toBe(series.findLast(x => x.key === s.key)!.label);
					expect(config[s.key]!.color).toBe(series.findLast(x => x.key === s.key)!.color);
				}
			}),
			{ numRuns: 200 }
		);
	});
});

// ---------------------------------------------------------------------------
// Property 11: buildCategoryPieData correctness
// **Validates: Requirements 14.1, 14.2, 14.3, 14.4, 14.5**
// ---------------------------------------------------------------------------
describe('Property 11: buildCategoryPieData correctness', () => {
	const breakdownArb = fc.array(
		fc.record({
			category: fc.constantFrom(...CATEGORY_ENUM),
			amount: fc.double({ min: 0, max: 100_000, noNaN: true, noDefaultInfinity: true })
		}),
		{ minLength: 1, maxLength: 10 }
	);

	test('excludes zero-amount items', () => {
		fc.assert(
			fc.property(breakdownArb, breakdown => {
				const result = buildCategoryPieData(breakdown);
				for (const item of result) {
					expect(item.value).toBeGreaterThan(0);
				}
			}),
			{ numRuns: 200 }
		);
	});

	test('percentages sum ≈ 100 when there are non-zero items', () => {
		fc.assert(
			fc.property(breakdownArb, breakdown => {
				const result = buildCategoryPieData(breakdown);
				if (result.length === 0) return;
				const sum = result.reduce((acc, item) => acc + item.percentage, 0);
				expect(sum).toBeCloseTo(100, 1);
			}),
			{ numRuns: 200 }
		);
	});

	test('colors come from CATEGORY_COLORS and labels from CATEGORY_LABELS', () => {
		fc.assert(
			fc.property(breakdownArb, breakdown => {
				const result = buildCategoryPieData(breakdown);
				for (const item of result) {
					expect(item.color).toBe(getCategoryColor(item.key));
					expect(item.label).toBe(getCategoryLabel(item.key));
				}
			}),
			{ numRuns: 200 }
		);
	});

	test('uses provided total for percentage calculation', () => {
		const result = buildCategoryPieData(
			[
				{ category: 'fuel', amount: 25 },
				{ category: 'maintenance', amount: 75 }
			],
			200
		);
		expect(result[0]!.percentage).toBeCloseTo(12.5, 5);
		expect(result[1]!.percentage).toBeCloseTo(37.5, 5);
	});
});

// ---------------------------------------------------------------------------
// Property 12: Category key fallback safety
// **Validates: Requirements 15.1, 15.2**
// ---------------------------------------------------------------------------
describe('Property 12: Category key fallback safety', () => {
	const unknownKeyArb = fc
		.string({ minLength: 1, maxLength: 20 })
		.filter(key => !CATEGORY_ENUM.includes(key));

	test('∀ unknown key, color falls back to var(--primary)', () => {
		fc.assert(
			fc.property(unknownKeyArb, key => {
				expect(getCategoryColor(key)).toBe('var(--primary)');
			}),
			{ numRuns: 200 }
		);
	});

	test('∀ unknown key, label falls back to raw key', () => {
		fc.assert(
			fc.property(unknownKeyArb, key => {
				expect(getCategoryLabel(key)).toBe(key);
			}),
			{ numRuns: 200 }
		);
	});
});
