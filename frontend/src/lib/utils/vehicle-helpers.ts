// Vehicle helper utilities
// Using a flexible type to handle both API responses and store data

interface VehicleLike {
	year: number;
	make: string;
	model: string;
	nickname?: string;
	financing?: {
		isActive: boolean;
		originalAmount: number;
		currentBalance: number;
	};
}

// Get display name for a vehicle
export function getVehicleDisplayName(vehicle: VehicleLike | null | undefined): string {
	if (!vehicle) return 'Unknown Vehicle';
	return vehicle.nickname || `${vehicle.year} ${vehicle.make} ${vehicle.model}`;
}

// Calculate financing progress percentage
export function getFinancingProgress(vehicle: VehicleLike): number {
	if (!vehicle?.financing?.isActive) return 0;

	const { originalAmount, currentBalance } = vehicle.financing;
	return ((originalAmount - currentBalance) / originalAmount) * 100;
}

// Get financing type label
export function getFinancingTypeLabel(type: string): string {
	const labels: Record<string, string> = {
		loan: 'Loan',
		lease: 'Lease',
		own: 'Owned'
	};
	return labels[type] || type;
}
