import { repos } from '../../app-context';
import type { ReminderWithVehicles } from './repository';

export async function withMileageDue<T extends ReminderWithVehicles>(
  rows: T[],
  fullVehicleIds: Map<string, string[]>,
  viewerId: string
): Promise<(T & { mileageDue: boolean; currentOdometer: number | null })[]> {
  const readings = new Map<string, Promise<number | null>>();
  const reading = (vehicleId: string, ownerId: string) => {
    const key = `${ownerId}:${vehicleId}`;
    let found = readings.get(key);
    if (!found) {
      found = repos().odometer.getCurrentOdometer(vehicleId, ownerId);
      readings.set(key, found);
    }
    return found;
  };
  return Promise.all(
    rows.map(async (row) => {
      const { reminder } = row;
      const cars = fullVehicleIds.get(reminder.id) ?? [];
      const [vehicleId] = cars;
      const milestone = reminder.nextDueOdometer;
      if (
        !reminder.isActive ||
        reminder.triggerMode === 'time' ||
        milestone === null ||
        cars.length !== 1 ||
        vehicleId === undefined ||
        !row.vehicleIds.includes(vehicleId)
      ) {
        return { ...row, mileageDue: false, currentOdometer: null };
      }
      const current = await reading(vehicleId, reminder.userId);
      return {
        ...row,
        mileageDue: current !== null && current >= milestone,
        currentOdometer: reminder.userId === viewerId ? current : null,
      };
    })
  );
}
