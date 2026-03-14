import { eq } from 'drizzle-orm';
import { getDb } from '../../db/connection';
import { expenses, odometerEntries, photos } from '../../db/schema';
import { NotFoundError, ValidationError } from '../../errors';
import { insurancePolicyRepository } from '../insurance/repository';
import { vehicleRepository } from '../vehicles/repository';

/**
 * Check photo ownership directly via photos.user_id.
 * Used for operations on existing photos (delete, set cover).
 */
export async function validatePhotoOwnership(photoId: string, userId: string): Promise<void> {
  const db = getDb();
  const rows = await db
    .select({ userId: photos.userId })
    .from(photos)
    .where(eq(photos.id, photoId))
    .limit(1);
  const photo = rows[0];
  if (!photo || photo.userId !== userId) throw new NotFoundError('Photo');
}

async function validateExpenseOwnership(entityId: string, userId: string): Promise<void> {
  const db = getDb();
  const rows = await db
    .select({ userId: expenses.userId })
    .from(expenses)
    .where(eq(expenses.id, entityId))
    .limit(1);
  const expense = rows[0];
  if (!expense || expense.userId !== userId) throw new NotFoundError('Expense');
}

/**
 * Validates that the authenticated user owns the entity referenced by entityType + entityId.
 *
 * v2 dual behavior:
 * - For operations on **existing photos** (delete, set cover): use validatePhotoOwnership()
 *   which checks photos.user_id directly.
 * - For **new photo uploads** (no photo row exists yet): this function validates entity
 *   ownership through the entity tables (vehicle, expense, insurance_policy, odometer_entry).
 *
 * Throws NotFoundError if the entity doesn't exist or doesn't belong to the user.
 * Throws ValidationError for unknown entity types.
 */
export async function validateEntityOwnership(
  entityType: string,
  entityId: string,
  userId: string
): Promise<void> {
  switch (entityType) {
    case 'vehicle': {
      const vehicle = await vehicleRepository.findByUserIdAndId(userId, entityId);
      if (!vehicle) throw new NotFoundError('Vehicle');
      break;
    }
    case 'insurance_policy': {
      const policy = await insurancePolicyRepository.findById(entityId);
      if (!policy || policy.userId !== userId) throw new NotFoundError('Insurance policy');
      break;
    }
    case 'expense': {
      await validateExpenseOwnership(entityId, userId);
      break;
    }
    case 'odometer_entry': {
      const db = getDb();
      const rows = await db
        .select({ userId: odometerEntries.userId })
        .from(odometerEntries)
        .where(eq(odometerEntries.id, entityId))
        .limit(1);
      const entry = rows[0];
      if (!entry || entry.userId !== userId) throw new NotFoundError('Odometer entry');
      break;
    }
    default:
      throw new ValidationError(`Unknown entity type: ${entityType}`);
  }
}
