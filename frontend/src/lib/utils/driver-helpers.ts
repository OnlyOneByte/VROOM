import type { Driver, Vehicle } from '#lib/types/index.ts';

export function showsDriverChip(
	vehicle: Pick<Vehicle, 'carShare' | 'carShareEnabled'> | undefined
): boolean | undefined {
	if (vehicle?.carShare) return vehicle.carShare.enabled && vehicle.carShare.record;
	return vehicle?.carShareEnabled === false ? false : undefined;
}

const PALETTE_SLOT = /^chart-[1-8]$/;
const memoryKey = (vehicleId: string) => `vroom.lastDriver.${vehicleId}`;

export function driverColor(driver: Pick<Driver, 'color'>): string {
	return driver.color && PALETTE_SLOT.test(driver.color)
		? `var(--${driver.color})`
		: 'var(--muted-foreground)';
}

function withStorage<T>(use: (storage: Storage) => T, fallback: T): T {
	try {
		return use(localStorage);
	} catch {
		return fallback;
	}
}

export function rememberDriver(vehicleId: string, driverId: string | null): void {
	withStorage(storage => {
		if (driverId) storage.setItem(memoryKey(vehicleId), driverId);
		else storage.removeItem(memoryKey(vehicleId));
	}, undefined);
}

export function defaultDriverId(
	vehicleId: string,
	drivers: Driver[],
	userId: string | undefined
): string | null {
	const active = drivers.filter(d => !d.archived);
	const lastPicked = withStorage(storage => storage.getItem(memoryKey(vehicleId)), null);
	if (lastPicked && active.some(d => d.id === lastPicked)) return lastPicked;
	return active.find(d => d.userId === userId)?.id ?? null;
}
