import { and, eq, inArray } from 'drizzle-orm';
import type { AppDatabase } from '../db/connection';
import { vehicles } from '../db/schema';
import type { DrizzleTransaction } from '../db/types';
import { NotFoundError } from '../errors';

// Requires both the userId and id predicates. Dropping userId would let a split or insurance write
// reach another user's vehicle. Accepts a transaction handle. Duplicate ids are removed before the
// count check.
export async function assertVehiclesOwned(
  handle: AppDatabase | DrizzleTransaction,
  vehicleIds: readonly string[],
  userId: string
): Promise<void> {
  if (vehicleIds.length === 0) return;
  const uniqueIds = [...new Set(vehicleIds)];
  const ownedVehicles = await handle
    .select({ id: vehicles.id })
    .from(vehicles)
    .where(and(inArray(vehicles.id, uniqueIds), eq(vehicles.userId, userId)));
  if (ownedVehicles.length !== uniqueIds.length) {
    throw new NotFoundError('Vehicle');
  }
}
