import { eq } from 'drizzle-orm';
import type { Context } from 'hono';
import { getDb } from '../../db/connection';
import { odometerEntries, photos } from '../../db/schema';
import { AppError, NotFoundError, ValidationError } from '../../errors';
import {
  validateExpenseOwnership,
  validateInsuranceOwnership,
  validateVehicleOwnership,
} from '../../utils/validation';
import { insuranceClaimRepository } from '../insurance/claims-repository';

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
      // Shared validator throws NotFoundError('Vehicle') on miss/mismatch.
      await validateVehicleOwnership(entityId, userId);
      break;
    }
    case 'insurance_policy': {
      // Shared validator throws NotFoundError('Insurance policy') on miss/mismatch.
      await validateInsuranceOwnership(entityId, userId);
      break;
    }
    case 'insurance_claim': {
      // Claim ownership is transitive through its policy (claim → policy.userId);
      // no shared validator exists for this indirection, so keep it inline.
      const ownerId = await insuranceClaimRepository.findOwnerUserId(entityId);
      if (ownerId !== userId) throw new NotFoundError('Insurance claim');
      break;
    }
    case 'expense': {
      // Shared validator throws NotFoundError('Expense') on miss/mismatch.
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

/**
 * Parse the multipart upload body and return the validated `photo` File, or throw a 400 (C221 dedup).
 * The `parseBody()` → `body.photo` → `instanceof File` → AppError('No photo file provided', 400) block
 * was byte-identical at both upload routes (photos/routes.ts + vehicles/photo-routes.ts). One source of
 * truth for the upload-input contract — and the natural seam for future upload validation (size/type/
 * magic-byte sniffing, the filed #34 follow-on) so it lands in one place, not two.
 */
export async function parseUploadedPhoto(c: Context): Promise<File> {
  const body = await c.req.parseBody();
  const file = body.photo;
  if (!file || !(file instanceof File)) {
    throw new AppError('No photo file provided', 400);
  }
  return file;
}

/**
 * Build the byte-serving Response for a photo thumbnail — ONE source of truth for the serve headers
 * (C227 dedup). Both the generic photos route and the vehicle-photo sub-router served user-uploaded
 * bytes with the same header set EXCEPT one: the generic route carried `X-Content-Type-Options: nosniff`
 * (the C133/#35 fix) and the vehicle route did NOT — a real security divergence (#77), since the serve
 * uses the CLIENT-asserted, never-sniffed `mimeType`, so without nosniff a file whose bytes are
 * HTML/script but declared image/png could be MIME-sniffed + executed by the browser (a stored-content
 * vector) on the PRIMARY photo surface. Routing both through this builder closes the gap + prevents
 * future drift. nosniff is MANDATORY here (ARCC Secure-HTTP-Headers / Secure-File-Uploads).
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
