import { and, eq, inArray } from 'drizzle-orm';
import type { AppDatabase } from '../db/connection';
import { vehicles } from '../db/schema';
import type { DrizzleTransaction } from '../db/types';
import { NotFoundError } from '../errors';

/**
 * Assert that EVERY id in `vehicleIds` is a vehicle owned by `userId`, throwing NotFoundError if any
 * is missing or not owned. ONE source of truth for the cross-tenant ownership query that the expense
 * split-create/update and the insurance policy/term transactions each ran as a byte-identical private
 * helper (`select id from vehicles where userId AND id IN (ids)` → throw if any unowned). The C109
 * tenant-scope guard REQUIRES both predicates together (userId AND id) — a divergent copy that dropped
 * the userId leg would surface another user's vehicles into a split allocation or an insurance term
 * (a money/coverage cross-tenant write). Collapsing both copies here keeps that boundary in lockstep.
 *
 * Accepts a db OR an in-flight transaction handle (the insurance term writes run inside a tx). Empty
 * input is a no-op (nothing to own); duplicate ids are de-duped before the count check, so the
 * length-equality test is exact. NotFoundError (not ValidationError) preserves both prior callers'
 * observable error — do NOT route through validateVehicleIdsOwned, which throws a different type.
 */
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
