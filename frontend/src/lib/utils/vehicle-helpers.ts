interface VehicleLike {
	year: number;
	make: string;
	model: string;
	nickname?: string;
}

export function getVehicleDisplayName(vehicle: VehicleLike | null | undefined): string {
	if (!vehicle) return 'Unknown Vehicle';
	return vehicle.nickname || `${vehicle.year} ${vehicle.make} ${vehicle.model}`;
}
