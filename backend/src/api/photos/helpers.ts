import type { Context } from 'hono';
import { NotFoundError, ValidationError } from '../../errors';
import type { ResourceOf } from '../../permissions/authorize';
import type { Resource } from '../../permissions/resolve';
import { validateInsuranceOwnership } from '../../utils/validation';
import {
  assertMayTouchFinancialExpense,
  requireVehicleAccess,
  seesFinancials,
} from '../../utils/vehicle-access';
import { expenseRepository } from '../expenses/repository';
import { insuranceClaimRepository } from '../insurance/claims-repository';
import { insurancePolicyRepository } from '../insurance/repository';
import { odometerRepository } from '../odometer/repository';
import { photoRepository } from './photo-repository';

export async function validateEntityOwnership(
  entityType: string,
  entityId: string,
  userId: string
): Promise<string> {
  switch (entityType) {
    case 'vehicle':
      return (await requireVehicleAccess(entityId, userId, 'read')).ownerId;
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
      const expense = await expenseRepository.findById(entityId);
      if (!expense) throw new NotFoundError('Expense');
      const access = await requireVehicleAccess(expense.vehicleId, userId, 'read');
      assertMayTouchFinancialExpense(seesFinancials(access), expense.sourceType);
      return access.ownerId;
    }
    case 'odometer_entry': {
      const entry = await odometerRepository.findById(entityId);
      if (!entry) throw new NotFoundError('Odometer entry');
      return (await requireVehicleAccess(entry.vehicleId, userId, 'read')).ownerId;
    }
    default:
      throw new ValidationError(`Unknown entity type: ${entityType}`);
  }
}

function entityOwnerAccount(ownerId: string | null, label: string): Resource {
  if (!ownerId) throw new NotFoundError(label);
  return { kind: 'account', userId: ownerId };
}

export async function photoEntityResource(entityType: string, entityId: string): Promise<Resource> {
  switch (entityType) {
    case 'vehicle':
      return { kind: 'vehicle', vehicleId: entityId };
    case 'insurance_policy':
      return entityOwnerAccount(
        (await insurancePolicyRepository.findById(entityId))?.userId ?? null,
        'Insurance policy'
      );
    case 'insurance_claim':
      return entityOwnerAccount(
        await insuranceClaimRepository.findOwnerUserId(entityId),
        'Insurance claim'
      );
    case 'expense': {
      const expense = await expenseRepository.findById(entityId);
      if (!expense) throw new NotFoundError('Expense');
      return { kind: 'vehicle', vehicleId: expense.vehicleId };
    }
    case 'odometer_entry': {
      const entry = await odometerRepository.findById(entityId);
      if (!entry) throw new NotFoundError('Odometer entry');
      return { kind: 'vehicle', vehicleId: entry.vehicleId };
    }
    default:
      throw new ValidationError(`Unknown entity type: ${entityType}`);
  }
}

export const fromPhotoEntity: ResourceOf = (c) =>
  photoEntityResource(c.req.param('entityType') ?? '', c.req.param('entityId') ?? '');

export function withPhotoAuthor(resourceOf: ResourceOf): ResourceOf {
  return async (c) => {
    const resource = (await resourceOf(c)) as Resource;
    const photo = await photoRepository.findById(c.req.param('photoId') ?? '');
    const entityType = c.req.param('entityType') ?? 'vehicle';
    const entityId = c.req.param('entityId') ?? c.req.param('vehicleId');
    if (!photo || photo.entityType !== entityType || photo.entityId !== entityId) {
      throw new NotFoundError('Photo');
    }
    if (resource.kind !== 'vehicle') return resource;
    return { ...resource, entryCreatedBy: photo.createdBy ?? photo.userId };
  };
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
