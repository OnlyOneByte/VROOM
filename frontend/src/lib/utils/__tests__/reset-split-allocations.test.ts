/**
 * Unit tests for resetSplitAllocations — the split-method reset shared by ExpenseForm and
 * InsuranceTermForm (extracted C415, the arch dedup of two BYTE-IDENTICAL resetAllocationsForMethod
 * copies). The forms themselves are eyes-on/Playwright-blocked, so this pure helper IS the
 * merge-surviving net: it pins the per-method shape + the load-bearing 100/N-rounded-to-1-decimal
 * percentage seed, so the two forms can't drift to different per-vehicle splits for the same vehicles.
 */

import { describe, expect, test } from 'vitest';
import { resetSplitAllocations } from '$lib/utils/expense-helpers';

describe('resetSplitAllocations', () => {
	test("'even' carries NO per-vehicle rows (the backend splits evenly itself)", () => {
		expect(resetSplitAllocations('even', ['v1', 'v2', 'v3'])).toEqual([]);
	});

	test("'absolute' seeds each selected vehicle at amount 0", () => {
		expect(resetSplitAllocations('absolute', ['v1', 'v2'])).toEqual([
			{ vehicleId: 'v1', amount: 0 },
			{ vehicleId: 'v2', amount: 0 }
		]);
	});

	test("'percentage' seeds an even 100/N split", () => {
		expect(resetSplitAllocations('percentage', ['v1', 'v2'])).toEqual([
			{ vehicleId: 'v1', percentage: 50 },
			{ vehicleId: 'v2', percentage: 50 }
		]);
	});

	test("'percentage' rounds 100/3 to ONE decimal (33.3, the load-bearing rounding)", () => {
		const out = resetSplitAllocations('percentage', ['v1', 'v2', 'v3']);
		// 100/3 = 33.333… → 33.3 (round to 1 decimal). A 2-decimal copy would give 33.33 and diverge.
		expect(out.map((a) => a.percentage)).toEqual([33.3, 33.3, 33.3]);
	});

	test('empty vehicle list: even/absolute → [], percentage → [] (no NaN, no divide-by-zero)', () => {
		expect(resetSplitAllocations('even', [])).toEqual([]);
		expect(resetSplitAllocations('absolute', [])).toEqual([]);
		expect(resetSplitAllocations('percentage', [])).toEqual([]);
	});

	test('a single vehicle on percentage gets the full 100', () => {
		expect(resetSplitAllocations('percentage', ['only'])).toEqual([
			{ vehicleId: 'only', percentage: 100 }
		]);
	});
});
