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
		expect(out.map(a => a.percentage)).toEqual([33.3, 33.3, 33.3]);
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

describe('buildSplitConfig', () => {
	test("'even' carries the vehicleIds (backend computes the per-vehicle split itself)", () => {
		expect(buildSplitConfig('even', ['v1', 'v2', 'v3'], [])).toEqual({
			method: 'even',
			vehicleIds: ['v1', 'v2', 'v3']
		});
	});

	test("'absolute' maps each allocation to {vehicleId, amount}", () => {
		expect(
			buildSplitConfig(
				'absolute',
				['v1', 'v2'],
				[
					{ vehicleId: 'v1', amount: 30 },
					{ vehicleId: 'v2', amount: 70 }
				]
			)
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
			buildSplitConfig(
				'percentage',
				['v1', 'v2'],
				[
					{ vehicleId: 'v1', percentage: 60 },
					{ vehicleId: 'v2', percentage: 40 }
				]
			)
		).toEqual({
			method: 'percentage',
			allocations: [
				{ vehicleId: 'v1', percentage: 60 },
				{ vehicleId: 'v2', percentage: 40 }
			]
		});
	});

	test('a cleared absolute input (undefined amount) coalesces to 0, NOT undefined in the payload', () => {
		const out = buildSplitConfig('absolute', ['v1'], [{ vehicleId: 'v1' }]);
		expect(out).toEqual({ method: 'absolute', allocations: [{ vehicleId: 'v1', amount: 0 }] });
	});

	test('a cleared percentage input (undefined percentage) coalesces to 0', () => {
		const out = buildSplitConfig('percentage', ['v1'], [{ vehicleId: 'v1' }]);
		expect(out).toEqual({
			method: 'percentage',
			allocations: [{ vehicleId: 'v1', percentage: 0 }]
		});
	});
});
