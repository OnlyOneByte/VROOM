import type { Expense } from '$lib/types';
import type { SplitAllocationDraft } from '$lib/utils/expense-helpers';

export type SplitMethod = 'even' | 'absolute' | 'percentage';

export interface SplitState {
	splitMethod: SplitMethod;
	selectedVehicleIds: string[];
	splitAllocations: SplitAllocationDraft[];
}

/** Rebuilds the split editor state from a saved split group, in the method it was saved with. */
export function splitStateFromGroup(
	method: string,
	groupTotal: number,
	siblings: Expense[]
): SplitState {
	const splitMethod = (method as SplitMethod) || 'even';
	const selectedVehicleIds = siblings.map(s => s.vehicleId);

	let splitAllocations: SplitAllocationDraft[];
	if (splitMethod === 'even') {
		splitAllocations = siblings.map(s => ({ vehicleId: s.vehicleId }));
	} else if (splitMethod === 'absolute') {
		splitAllocations = siblings.map(s => ({ vehicleId: s.vehicleId, amount: s.amount }));
	} else {
		splitAllocations = siblings.map(s => ({
			vehicleId: s.vehicleId,
			percentage: groupTotal > 0 ? Math.round((s.amount / groupTotal) * 1000) / 10 : 0
		}));
	}

	return { splitMethod, selectedVehicleIds, splitAllocations };
}

/**
 * Turning split on resets the method to even. The selection is seeded with the current vehicle
 * when there is one; otherwise it is kept as it was.
 */
export function enableSplit(currentVehicleId: string, selectedVehicleIds: string[]): SplitState {
	return {
		splitMethod: 'even',
		selectedVehicleIds: currentVehicleId ? [currentVehicleId] : selectedVehicleIds,
		splitAllocations: []
	};
}

/**
 * Turning split off keeps the first selected vehicle as the single vehicle, so the user does not
 * lose their choice. Returns the vehicle to write back to the form, or null to leave it alone.
 */
export function disableSplit(selectedVehicleIds: string[]): {
	vehicleId: string | null;
	state: SplitState;
} {
	const firstId = selectedVehicleIds[0];
	return {
		vehicleId: selectedVehicleIds.length > 0 && firstId ? firstId : null,
		state: { splitMethod: 'even', selectedVehicleIds: [], splitAllocations: [] }
	};
}

export function toggleSplitVehicle(selectedVehicleIds: string[], vehicleId: string): string[] {
	return selectedVehicleIds.includes(vehicleId)
		? selectedVehicleIds.filter(id => id !== vehicleId)
		: [...selectedVehicleIds, vehicleId];
}
