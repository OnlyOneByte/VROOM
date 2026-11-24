import type { Context } from 'hono';
import { NotFoundError, ValidationError } from '../../errors';
import { validateInsuranceOwnership } from '../../utils/validation';
import {
  assertMayTouchFinancialExpense,
  requireVehicleAccess,
  seesFinancials,
} from '../../utils/vehicle-access';
import { expenseRepository } from '../expenses/repository';
import { insuranceClaimRepository } from '../insurance/claims-repository';
import { odometerRepository } from '../odometer/repository';

export async function validateEntityOwnership(
  entityType: string,
  entityId: string,
  userId: string
): Promise<string> {
  switch (entityType) {
    case 'vehicle': {
      await requireVehicleAccess(entityId, userId, 'owner');
      return userId;
    }
    case 'insurance_policy': {
      await validateInsuranceOwnership(entityId, userId);
      return userId;
    }
    case 'insurance_claim': {
      const ownerId = await insuranceClaimRepository.findOwnerUserId(entityId);
      if (ownerId !== userId) throw new NotFoundError('Insurance claim');
      return userId;
    }
    case 'expense': {
      // Shared-vehicle rows carry the owner's userId, so authorize through the vehicle write gate.
      const expense = await expenseRepository.findById(entityId);
      if (!expense) throw new NotFoundError('Expense');
      const access = await requireVehicleAccess(expense.vehicleId, userId, 'write');
      assertMayTouchFinancialExpense(seesFinancials(access), expense.sourceType);
      return access.ownerId;
    }
    case 'odometer_entry': {
      const entry = await odometerRepository.findById(entityId);
      if (!entry) throw new NotFoundError('Odometer entry');
      return (await requireVehicleAccess(entry.vehicleId, userId, 'write')).ownerId;
    }
    default:
      throw new ValidationError(`Unknown entity type: ${entityType}`);
  }
}

export async function parseUploadedPhoto(c: Context): Promise<File> {
  const body = await c.req.parseBody().catch(() => {
    throw new ValidationError('Upload the photo as multipart/form-data');
  });
  const file = body.photo;
  if (!file || !(file instanceof File)) {
    throw new ValidationError('No photo file provided');
  }
  return file;
}

// mimeType is client-asserted; nosniff stops the browser from executing uploaded content.
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
