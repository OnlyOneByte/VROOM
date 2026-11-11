import { describe, expect, test } from 'vitest';
import type { Expense } from '$lib/types';
import {
	disableSplit,
	enableSplit,
	splitStateFromGroup,
	toggleSplitVehicle
} from '../split-config';

function sibling(vehicleId: string, amount: number): Expense {
	return {
		id: `e-${vehicleId}`,
		vehicleId,
		userId: 'u1',
		tags: [],
		category: 'misc',
		amount,
		date: '2026-01-15T00:00:00.000Z',
		createdAt: '2026-01-15T00:00:00.000Z',
		updatedAt: '2026-01-15T00:00:00.000Z'
	};
}

const SIBLINGS = [sibling('v1', 60), sibling('v2', 40)];

describe('splitStateFromGroup', () => {
	test('an even group keeps only the vehicle ids, with no amounts', () => {
		expect(splitStateFromGroup('even', 100, SIBLINGS)).toEqual({
			splitMethod: 'even',
			selectedVehicleIds: ['v1', 'v2'],
			splitAllocations: [{ vehicleId: 'v1' }, { vehicleId: 'v2' }]
		});
	});

	test('an absolute group carries each sibling amount as saved', () => {
		expect(splitStateFromGroup('absolute', 100, SIBLINGS).splitAllocations).toEqual([
			{ vehicleId: 'v1', amount: 60 },
			{ vehicleId: 'v2', amount: 40 }
		]);
	});

	test('a percentage group derives each share of the total to one decimal place', () => {
		expect(
			splitStateFromGroup('percentage', 300, [sibling('v1', 100), sibling('v2', 200)])
		).toMatchObject({
			splitMethod: 'percentage',
			splitAllocations: [
				{ vehicleId: 'v1', percentage: 33.3 },
				{ vehicleId: 'v2', percentage: 66.7 }
			]
		});
	});

	test('a percentage group with no total reports 0% rather than dividing by zero', () => {
		expect(
			splitStateFromGroup('percentage', 0, SIBLINGS).splitAllocations.map(a => a.percentage)
		).toEqual([0, 0]);
	});

	test('a missing method falls back to even', () => {
		expect(splitStateFromGroup('', 100, SIBLINGS).splitMethod).toBe('even');
	});

	test('an unrecognised method keeps its name and uses the percentage branch, as saved', () => {
		const state = splitStateFromGroup('custom', 100, SIBLINGS);
		expect(state.splitMethod).toBe('custom');
		expect(state.splitAllocations[0]).toEqual({ vehicleId: 'v1', percentage: 60 });
	});
});

describe('enableSplit', () => {
	test('seeds the selection with the current vehicle and resets the method to even', () => {
		expect(enableSplit('v1', [])).toEqual({
			splitMethod: 'even',
			selectedVehicleIds: ['v1'],
			splitAllocations: []
		});
	});

	test('with no current vehicle, keeps the existing selection', () => {
		expect(enableSplit('', ['v2']).selectedVehicleIds).toEqual(['v2']);
	});
});

describe('disableSplit', () => {
	test('returns the first selected vehicle to become the single vehicle', () => {
		expect(disableSplit(['v2', 'v1'])).toEqual({
			vehicleId: 'v2',
			state: { splitMethod: 'even', selectedVehicleIds: [], splitAllocations: [] }
		});
	});

	test('with nothing selected, leaves the form vehicle alone', () => {
		expect(disableSplit([]).vehicleId).toBeNull();
	});
});

describe('toggleSplitVehicle', () => {
	test('adds an unselected vehicle at the end', () => {
		expect(toggleSplitVehicle(['v1'], 'v2')).toEqual(['v1', 'v2']);
	});

	test('removes an already selected vehicle without touching the rest', () => {
		expect(toggleSplitVehicle(['v1', 'v2'], 'v1')).toEqual(['v2']);
	});
});
