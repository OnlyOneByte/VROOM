import { eq } from 'drizzle-orm';
import type { Context } from 'hono';
import { getDb } from '../../db/connection';
import { photos } from '../../db/schema';
import { AppError, NotFoundError, ValidationError } from '../../errors';
import { requireVehicleWrite } from '../../utils/sharing';
import { validateInsuranceOwnership, validateVehicleOwnership } from '../../utils/validation';
import { expenseRepository } from '../expenses/repository';
import { insuranceClaimRepository } from '../insurance/claims-repository';
import { odometerRepository } from '../odometer/repository';

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

/**
 * Ownership check for a new upload's entity, resolved through the entity tables. Existing photos
 * use validatePhotoOwnership. Throws NotFoundError on a miss and ValidationError for unknown types.
 */
export async function validateEntityOwnership(
  entityType: string,
  entityId: string,
  userId: string
): Promise<void> {
  switch (entityType) {
    case 'vehicle': {
      await validateVehicleOwnership(entityId, userId);
      break;
    }
    case 'insurance_policy': {
      await validateInsuranceOwnership(entityId, userId);
      break;
    }
    case 'insurance_claim': {
      // Ownership is transitive through the claim's policy.
      const ownerId = await insuranceClaimRepository.findOwnerUserId(entityId);
      if (ownerId !== userId) throw new NotFoundError('Insurance claim');
      break;
    }
    case 'expense': {
      // Rows on a shared vehicle are stamped with the owner's userId, so authorize through the same
      // vehicle write gate the expense routes use rather than matching userId. Odometer entries
      // follow the same pattern.
      const expense = await expenseRepository.findById(entityId);
      if (!expense) throw new NotFoundError('Expense');
      await requireVehicleWrite(expense.vehicleId, userId);
      break;
    }
    case 'odometer_entry': {
      const entry = await odometerRepository.findById(entityId);
      if (!entry) throw new NotFoundError('Odometer entry');
      await requireVehicleWrite(entry.vehicleId, userId);
      break;
    }
    default:
      throw new ValidationError(`Unknown entity type: ${entityType}`);
  }
}

/** Returns the multipart `photo` file, or throws a 400 if it is missing or not a file. */
export async function parseUploadedPhoto(c: Context): Promise<File> {
  const body = await c.req.parseBody();
  const file = body.photo;
  if (!file || !(file instanceof File)) {
    throw new AppError('No photo file provided', 400);
  }
  return file;
}

/**
 * Byte-serving response for a photo. The mimeType is client-asserted, so X-Content-Type-Options:
 * nosniff is required to stop the browser from sniffing and executing user-uploaded content.
 */
export function photoThumbnailResponse(buffer: Buffer, mimeType: string): Response {
  return new Response(buffer, {
    headers: {
      'Content-Type': mimeType,
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'private, max-age=3600',
      'Cross-Origin-Resource-Policy': 'cross-origin',
    },
  });
}
