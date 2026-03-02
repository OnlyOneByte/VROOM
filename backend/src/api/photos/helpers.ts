import { NotFoundError, ValidationError } from '../../errors';
import type { GoogleDriveService } from '../sync/google-drive';
import { vehicleRepository } from '../vehicles/repository';

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
  userName: string
): Promise<string> {
  switch (entityType) {
    case 'vehicle': {
      const vehicle = await vehicleRepository.findById(entityId);
      if (!vehicle) throw new NotFoundError('Vehicle');

      const folderStructure = await driveService.createVroomFolderStructure(userName);
      const photosFolderId = folderStructure.subFolders.photos.id;

      const vehicleFolderName = `${vehicle.year} ${vehicle.make} ${vehicle.model}`;
      const existingFolder = await driveService.findFolder(vehicleFolderName, photosFolderId);
      if (existingFolder) {
        return existingFolder.id;
      }

      const newFolder = await driveService.createFolder(vehicleFolderName, photosFolderId);
      return newFolder.id;
    }
    default:
      throw new ValidationError(`Unknown entity type: ${entityType}`);
  }
}
