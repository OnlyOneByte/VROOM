import { eq } from 'drizzle-orm';
import type { OAuth2Client } from 'google-auth-library';
import { type drive_v3, google } from 'googleapis';
import { users } from '../db/schema';
import { databaseService } from './database';

export interface DriveFolder {
  id: string;
  name: string;
  parents?: string[];
  webViewLink?: string;
}

export interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  parents?: string[];
  webViewLink?: string;
  size?: string;
  createdTime?: string;
  modifiedTime?: string;
}

export class GoogleDriveService {
  private oauth2Client: OAuth2Client;
  private drive: drive_v3.Drive;

  constructor(accessToken: string, refreshToken?: string) {
    this.oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      process.env.GOOGLE_REDIRECT_URI
    );

    this.oauth2Client.setCredentials({
      access_token: accessToken,
      refresh_token: refreshToken,
    });

    this.drive = google.drive({ version: 'v3', auth: this.oauth2Client });
  }

  /**
   * Create the main VROOM folder structure in Google Drive
   */
  async createVroomFolderStructure(userName: string): Promise<{
    mainFolder: DriveFolder;
    subFolders: {
      receipts: DriveFolder;
      maintenance: DriveFolder;
      photos: DriveFolder;
      backups: DriveFolder;
    };
  }> {
    try {
      // Check if VROOM folder already exists
      const existingFolder = await this.findVroomFolder(userName);
      if (existingFolder) {
        // Get existing subfolders
        const subFolders = await this.getVroomSubFolders(existingFolder.id);
        return {
          mainFolder: existingFolder,
          subFolders,
        };
      }

      // Create main VROOM folder
      const mainFolderName = `VROOM Car Tracker - ${userName}`;
      const mainFolder = await this.createFolder(mainFolderName);

      // Create subfolders
      const receiptsFolder = await this.createFolder('Receipts', mainFolder.id);
      const maintenanceFolder = await this.createFolder('Maintenance Records', mainFolder.id);
      const photosFolder = await this.createFolder('Vehicle Photos', mainFolder.id);
      const backupsFolder = await this.createFolder('Backups', mainFolder.id);

      return {
        mainFolder,
        subFolders: {
          receipts: receiptsFolder,
          maintenance: maintenanceFolder,
          photos: photosFolder,
          backups: backupsFolder,
        },
      };
    } catch (error) {
      console.error('Error creating VROOM folder structure:', error);
      throw new Error('Failed to create Google Drive folder structure');
    }
  }

  /**
   * Find existing VROOM folder for a user
   */
  private async findVroomFolder(userName: string): Promise<DriveFolder | null> {
    try {
      const folderName = `VROOM Car Tracker - ${userName}`;
      const response = await this.drive.files.list({
        q: `name='${folderName}' and mimeType='application/vnd.google-apps.folder' and trashed=false`,
        fields: 'files(id, name, parents, webViewLink)',
      });

      const folders = response.data.files;
      if (folders && folders.length > 0) {
        const folder = folders[0];
        return {
          id: folder.id || '',
          name: folder.name || '',
          parents: folder.parents,
          webViewLink: folder.webViewLink,
        } as DriveFolder;
      }
      return null;
    } catch (error) {
      console.error('Error finding VROOM folder:', error);
      return null;
    }
  }

  /**
   * Get existing subfolders in VROOM main folder
   */
  private async getVroomSubFolders(mainFolderId: string): Promise<{
    receipts: DriveFolder;
    maintenance: DriveFolder;
    photos: DriveFolder;
    backups: DriveFolder;
  }> {
    try {
      const response = await this.drive.files.list({
        q: `'${mainFolderId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`,
        fields: 'files(id, name, parents, webViewLink)',
      });

      const folders = response.data.files || [];

      // Find or create each subfolder
      const receiptsFolder = folders.find((f) => f.name === 'Receipts');
      const maintenanceFolder = folders.find((f) => f.name === 'Maintenance Records');
      const photosFolder = folders.find((f) => f.name === 'Vehicle Photos');
      const backupsFolder = folders.find((f) => f.name === 'Backups');

      // Create missing subfolders or convert existing ones
      const receipts = receiptsFolder
        ? ({
            id: receiptsFolder.id || '',
            name: receiptsFolder.name || '',
            parents: receiptsFolder.parents,
            webViewLink: receiptsFolder.webViewLink,
          } as DriveFolder)
        : await this.createFolder('Receipts', mainFolderId);

      const maintenance = maintenanceFolder
        ? ({
            id: maintenanceFolder.id || '',
            name: maintenanceFolder.name || '',
            parents: maintenanceFolder.parents,
            webViewLink: maintenanceFolder.webViewLink,
          } as DriveFolder)
        : await this.createFolder('Maintenance Records', mainFolderId);

      const photos = photosFolder
        ? ({
            id: photosFolder.id || '',
            name: photosFolder.name || '',
            parents: photosFolder.parents,
            webViewLink: photosFolder.webViewLink,
          } as DriveFolder)
        : await this.createFolder('Vehicle Photos', mainFolderId);

      const backups = backupsFolder
        ? ({
            id: backupsFolder.id || '',
            name: backupsFolder.name || '',
            parents: backupsFolder.parents,
            webViewLink: backupsFolder.webViewLink,
          } as DriveFolder)
        : await this.createFolder('Backups', mainFolderId);

      return {
        receipts,
        maintenance,
        photos,
        backups,
      };
    } catch (error) {
      console.error('Error getting VROOM subfolders:', error);
      throw new Error('Failed to get or create subfolders');
    }
  }

  /**
   * Create a folder in Google Drive
   */
  async createFolder(name: string, parentId?: string): Promise<DriveFolder> {
    try {
      const folderMetadata: drive_v3.Schema$File = {
        name,
        mimeType: 'application/vnd.google-apps.folder',
      };

      if (parentId) {
        folderMetadata.parents = [parentId];
      }

      const response = await this.drive.files.create({
        requestBody: folderMetadata,
        fields: 'id, name, parents, webViewLink',
      });

      if (!response.data) {
        throw new Error('Failed to create folder - no response data');
      }

      return response.data as DriveFolder;
    } catch (error) {
      console.error('Error creating folder:', error);
      throw new Error(`Failed to create folder: ${name}`);
    }
  }

  /**
   * Create year/month subfolders in receipts folder for organization
   */
  async createReceiptDateFolders(
    receiptsFolderId: string,
    year: number,
    month: number
  ): Promise<DriveFolder> {
    try {
      // Create year folder if it doesn't exist
      const yearFolderName = year.toString();
      let yearFolder = await this.findFolderByName(yearFolderName, receiptsFolderId);

      if (!yearFolder) {
        yearFolder = await this.createFolder(yearFolderName, receiptsFolderId);
      }

      // Create month folder if it doesn't exist
      const monthNames = [
        '01-January',
        '02-February',
        '03-March',
        '04-April',
        '05-May',
        '06-June',
        '07-July',
        '08-August',
        '09-September',
        '10-October',
        '11-November',
        '12-December',
      ];
      const monthFolderName = monthNames[month - 1];
      let monthFolder = await this.findFolderByName(monthFolderName, yearFolder.id);

      if (!monthFolder) {
        monthFolder = await this.createFolder(monthFolderName, yearFolder.id);
      }

      return monthFolder;
    } catch (error) {
      console.error('Error creating receipt date folders:', error);
      throw new Error('Failed to create date-organized folders');
    }
  }

  /**
   * Find a folder by name within a parent folder
   */
  private async findFolderByName(name: string, parentId: string): Promise<DriveFolder | null> {
    try {
      const response = await this.drive.files.list({
        q: `name='${name}' and '${parentId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`,
        fields: 'files(id, name, parents, webViewLink)',
      });

      const folders = response.data.files;
      if (folders && folders.length > 0) {
        const folder = folders[0];
        return {
          id: folder.id || '',
          name: folder.name || '',
          parents: folder.parents,
          webViewLink: folder.webViewLink,
        } as DriveFolder;
      }
      return null;
    } catch (error) {
      console.error('Error finding folder by name:', error);
      return null;
    }
  }

  /**
   * List files in a folder
   */
  async listFilesInFolder(folderId: string): Promise<DriveFile[]> {
    try {
      const response = await this.drive.files.list({
        q: `'${folderId}' in parents and trashed=false`,
        fields: 'files(id, name, mimeType, parents, webViewLink, size, createdTime, modifiedTime)',
        orderBy: 'modifiedTime desc',
      });

      const files = response.data.files || [];
      return files.map((file) => ({
        id: file.id || '',
        name: file.name || '',
        mimeType: file.mimeType || '',
        parents: file.parents,
        webViewLink: file.webViewLink,
        size: file.size,
        createdTime: file.createdTime,
        modifiedTime: file.modifiedTime,
      })) as DriveFile[];
    } catch (error) {
      console.error('Error listing files in folder:', error);
      throw new Error('Failed to list files in folder');
    }
  }

  /**
   * Get folder permissions and sharing status
   */
  async getFolderPermissions(folderId: string): Promise<drive_v3.Schema$Permission[]> {
    try {
      const response = await this.drive.permissions.list({
        fileId: folderId,
        fields: 'permissions(id, type, role, emailAddress)',
      });

      return response.data.permissions || [];
    } catch (error) {
      console.error('Error getting folder permissions:', error);
      throw new Error('Failed to get folder permissions');
    }
  }

  /**
   * Set folder permissions (make it accessible to the user)
   */
  async setFolderPermissions(
    folderId: string,
    email: string,
    role: 'reader' | 'writer' | 'owner' = 'writer'
  ): Promise<void> {
    try {
      await this.drive.permissions.create({
        fileId: folderId,
        requestBody: {
          type: 'user',
          role,
          emailAddress: email,
        },
      });
    } catch (error) {
      console.error('Error setting folder permissions:', error);
      throw new Error('Failed to set folder permissions');
    }
  }

  /**
   * Upload a file to Google Drive
   */
  async uploadFile(
    fileName: string,
    fileContent: Buffer | string,
    mimeType: string,
    parentFolderId?: string
  ): Promise<DriveFile> {
    try {
      const fileMetadata: drive_v3.Schema$File = {
        name: fileName,
      };

      if (parentFolderId) {
        fileMetadata.parents = [parentFolderId];
      }

      const media = {
        mimeType,
        body: fileContent,
      };

      const response = await this.drive.files.create({
        requestBody: fileMetadata,
        media,
        fields: 'id, name, mimeType, parents, webViewLink, size, createdTime, modifiedTime',
      });

      if (!response.data) {
        throw new Error('Failed to upload file - no response data');
      }

      return response.data as DriveFile;
    } catch (error) {
      console.error('Error uploading file:', error);
      throw new Error(`Failed to upload file: ${fileName}`);
    }
  }

  /**
   * Delete a file or folder
   */
  async deleteFile(fileId: string): Promise<void> {
    try {
      await this.drive.files.delete({
        fileId,
      });
    } catch (error) {
      console.error('Error deleting file:', error);
      throw new Error('Failed to delete file');
    }
  }
}

/**
 * Create a Google Drive service instance for a user
 */
export async function createDriveServiceForUser(userId: string): Promise<GoogleDriveService> {
  const db = databaseService.getDatabase();

  const user = await db.select().from(users).where(eq(users.id, userId)).limit(1);

  if (!user.length || !user[0].googleRefreshToken) {
    throw new Error('User not found or Google Drive access not available');
  }

  // For now, we'll use the refresh token as access token
  // In a production app, you'd want to properly refresh the access token
  return new GoogleDriveService(user[0].googleRefreshToken, user[0].googleRefreshToken);
}
