import { eq } from 'drizzle-orm';
import { getDb } from '../../db/connection';
import { expenseGroups, expenses } from '../../db/schema';
import { NotFoundError, ValidationError } from '../../errors';
import { insurancePolicyRepository } from '../insurance/repository';
import type { GoogleDriveService } from '../sync/google-drive';
import { vehicleRepository } from '../vehicles/repository';

async function validateExpenseOwnership(entityId: string, userId: string): Promise<void> {
  const db = getDb();
  const expenseRows = await db
    .select({ vehicleId: expenses.vehicleId })
    .from(expenses)
    .where(eq(expenses.id, entityId))
    .limit(1);
  const expense = expenseRows[0];
  if (!expense) throw new NotFoundError('Expense');
  const vehicle = await vehicleRepository.findByUserIdAndId(userId, expense.vehicleId);
  if (!vehicle) throw new NotFoundError('Expense');
}

async function validateExpenseGroupOwnership(entityId: string, userId: string): Promise<void> {
  const db = getDb();
  const groupRows = await db
    .select({ userId: expenseGroups.userId })
    .from(expenseGroups)
    .where(eq(expenseGroups.id, entityId))
    .limit(1);
  const group = groupRows[0];
  if (!group) throw new NotFoundError('Expense group');
  if (group.userId !== userId) throw new NotFoundError('Expense group');
}

/**
 * Validates that the authenticated user owns the entity referenced by entityType + entityId.
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
      if (!policy) throw new NotFoundError('Insurance policy');

      let ownsLinkedVehicle = false;
      for (const vid of policy.vehicleIds) {
        const vehicle = await vehicleRepository.findByUserIdAndId(userId, vid);
        if (vehicle) {
          ownsLinkedVehicle = true;
          break;
        }
      }
      if (!ownsLinkedVehicle) throw new NotFoundError('Insurance policy');
      break;
    }
    case 'expense': {
      await validateExpenseOwnership(entityId, userId);
      break;
    }
    case 'expense_group': {
      await validateExpenseGroupOwnership(entityId, userId);
      break;
    }
    default:
      throw new ValidationError(`Unknown entity type: ${entityType}`);
  }
}

/**
 * Resolves (find-or-create) the Google Drive folder for a given entity.
 * For vehicles, creates a subfolder named "{year} {make} {model}" under the
 * "Vehicle Photos" folder in the VROOM folder structure.
 * Returns the Drive folder ID.
 */
export async function resolveEntityDriveFolder(
  driveService: GoogleDriveService,
  entityType: string,
  entityId: string,
  folderName: string
): Promise<string> {
  switch (entityType) {
    case 'vehicle': {
      const vehicle = await vehicleRepository.findById(entityId);
      if (!vehicle) throw new NotFoundError('Vehicle');

      const folderStructure = await driveService.createVroomFolderStructure(folderName);
      const photosFolderId = folderStructure.subFolders.photos.id;

      const vehicleFolderName = `${vehicle.year} ${vehicle.make} ${vehicle.model}`;
      const existingFolder = await driveService.findFolder(vehicleFolderName, photosFolderId);
      if (existingFolder) {
        return existingFolder.id;
      }

      const newFolder = await driveService.createFolder(vehicleFolderName, photosFolderId);
      return newFolder.id;
    }
    case 'insurance_policy': {
      const folderStructure = await driveService.createVroomFolderStructure(folderName);
      const mainFolderId = folderStructure.mainFolder.id;

      const insuranceFolderName = 'Insurance Documents';
      const existingFolder = await driveService.findFolder(insuranceFolderName, mainFolderId);
      if (existingFolder) {
        return existingFolder.id;
      }

      const newFolder = await driveService.createFolder(insuranceFolderName, mainFolderId);
      return newFolder.id;
    }
    case 'expense':
    case 'expense_group': {
      const folderStructure = await driveService.createVroomFolderStructure(folderName);
      const mainFolderId = folderStructure.mainFolder.id;

      const expenseFolderName = 'ExpensePhotos';
      const existingFolder = await driveService.findFolder(expenseFolderName, mainFolderId);
      if (existingFolder) {
        return existingFolder.id;
      }

      const newFolder = await driveService.createFolder(expenseFolderName, mainFolderId);
      return newFolder.id;
    }
    default:
      throw new ValidationError(`Unknown entity type: ${entityType}`);
  }
}
