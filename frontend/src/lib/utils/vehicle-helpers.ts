// Vehicle helper utilities
// Using a flexible type to handle both API responses and store data

interface VehicleLike {
	year: number;
	make: string;
	model: string;
	nickname?: string;
}

// Get display name for a vehicle
export function getVehicleDisplayName(vehicle: VehicleLike | null | undefined): string {
	if (!vehicle) return 'Unknown Vehicle';
	return vehicle.nickname || `${vehicle.year} ${vehicle.make} ${vehicle.model}`;
}
