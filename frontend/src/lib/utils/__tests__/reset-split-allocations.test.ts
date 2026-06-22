/**
 * Unit tests for resetSplitAllocations — the split-method reset shared by ExpenseForm and
 * InsuranceTermForm (extracted C415, the arch dedup of two BYTE-IDENTICAL resetAllocationsForMethod
 * copies). The forms themselves are eyes-on/Playwright-blocked, so this pure helper IS the
 * merge-surviving net: it pins the per-method shape + the load-bearing 100/N-rounded-to-1-decimal
 * percentage seed, so the two forms can't drift to different per-vehicle splits for the same vehicles.
 */

import { describe, expect, test } from 'vitest';
import { buildSplitConfig, resetSplitAllocations } from '$lib/utils/expense-helpers';

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

/**
 * Unit tests for buildSplitConfig — the API-union builder shared by ExpenseForm and ReminderForm
 * (extracted C23, dedup of two near-byte-identical local `buildSplitConfig` copies; ReminderForm's was
 * added C22 with the T4 split, immediately creating the drift vector). Both forms are
 * eyes-on/Playwright-blocked, so this pure helper IS the merge-surviving net: it pins the per-method
 * shape + the missing-value→0 coalesce, so the two forms can't drift to a different materialized split
 * for the same state. Pairs with resetSplitAllocations above (the seed) — together they bracket the
 * split-config lifecycle.
 */
describe('buildSplitConfig', () => {
	test("'even' carries the vehicleIds (backend computes the per-vehicle split itself)", () => {
		expect(buildSplitConfig('even', ['v1', 'v2', 'v3'], [])).toEqual({
			method: 'even',
			vehicleIds: ['v1', 'v2', 'v3']
		});
	});

	test("'absolute' maps each allocation to {vehicleId, amount}", () => {
		expect(
			buildSplitConfig('absolute', ['v1', 'v2'], [
				{ vehicleId: 'v1', amount: 30 },
				{ vehicleId: 'v2', amount: 70 }
			])
		).toEqual({
			method: 'absolute',
			allocations: [
				{ vehicleId: 'v1', amount: 30 },
				{ vehicleId: 'v2', amount: 70 }
			]
		});
	});

	test("'percentage' maps each allocation to {vehicleId, percentage}", () => {
		expect(
			buildSplitConfig('percentage', ['v1', 'v2'], [
				{ vehicleId: 'v1', percentage: 60 },
				{ vehicleId: 'v2', percentage: 40 }
			])
		).toEqual({
			method: 'percentage',
			allocations: [
				{ vehicleId: 'v1', percentage: 60 },
				{ vehicleId: 'v2', percentage: 40 }
			]
		});
	});

	test('a cleared absolute input (undefined amount) coalesces to 0, NOT undefined in the payload', () => {
		// A divergent copy that dropped `?? 0` would emit {vehicleId, amount: undefined} → a backend
		// schema reject (amount is z.number()). The coalesce is the load-bearing bit.
		const out = buildSplitConfig('absolute', ['v1'], [{ vehicleId: 'v1' }]);
		expect(out).toEqual({ method: 'absolute', allocations: [{ vehicleId: 'v1', amount: 0 }] });
	});

	test('a cleared percentage input (undefined percentage) coalesces to 0', () => {
		const out = buildSplitConfig('percentage', ['v1'], [{ vehicleId: 'v1' }]);
		expect(out).toEqual({ method: 'percentage', allocations: [{ vehicleId: 'v1', percentage: 0 }] });
	});
});
