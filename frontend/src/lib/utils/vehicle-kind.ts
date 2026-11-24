import { Car, Caravan, Motorbike, Truck, Van } from '@lucide/svelte';
import type { VehicleKind } from '#lib/types/vehicle.ts';

export const VEHICLE_KIND_LABELS: Record<VehicleKind, string> = {
	car: 'Car',
	motorcycle: 'Motorcycle',
	van: 'Van',
	truck: 'Truck',
	rv: 'RV',
	other: 'Other'
};

const VEHICLE_KIND_ICONS: Record<VehicleKind, typeof Car> = {
	car: Car,
	motorcycle: Motorbike,
	van: Van,
	truck: Truck,
	rv: Caravan,
	other: Car
};

export function vehicleKindIcon(kind: VehicleKind | undefined): typeof Car {
	return VEHICLE_KIND_ICONS[kind ?? 'car'] ?? Car;
}

export function vehicleKindNote(kind: VehicleKind | undefined): string | null {
	return kind && kind !== 'car' ? (VEHICLE_KIND_LABELS[kind] ?? null) : null;
}
