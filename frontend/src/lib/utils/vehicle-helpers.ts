// Get display name for a vehicle
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getVehicleDisplayName(vehicle: any | null | undefined): string {
	if (!vehicle) return 'Unknown Vehicle';
	return vehicle.nickname || `${vehicle.year} ${vehicle.make} ${vehicle.model}`;
}

// Calculate financing progress percentage
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getFinancingProgress(vehicle: any): number {
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
