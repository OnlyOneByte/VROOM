/**
 * Google Drive Service - Manages VROOM folder structure and file operations
 */

import { eq } from 'drizzle-orm';
import type { OAuth2Client } from 'google-auth-library';
import { type drive_v3, google } from 'googleapis';
import { getDb } from '../../db/connection';
import { users } from '../../db/schema';

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

  constructor(refreshToken: string) {
    this.oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      process.env.GOOGLE_REDIRECT_URI
    );

    this.oauth2Client.setCredentials({
      refresh_token: refreshToken,
    });

    this.drive = google.drive({ version: 'v3', auth: this.oauth2Client });
  }

  async createVroomFolderStructure(userName: string): Promise<{
    mainFolder: DriveFolder;
    subFolders: {
      receipts: DriveFolder;
      maintenance: DriveFolder;
      photos: DriveFolder;
      backups: DriveFolder;
    };
  }> {
    const existingFolder = await this.findFolder(`VROOM Car Tracker - ${userName}`);
    if (existingFolder) {
      const subFolders = await this.getOrCreateSubFolders(existingFolder.id);
      return { mainFolder: existingFolder, subFolders };
    }

    const mainFolder = await this.createFolder(`VROOM Car Tracker - ${userName}`);
    const subFolders = await this.getOrCreateSubFolders(mainFolder.id);
    return { mainFolder, subFolders };
  }

  private async getOrCreateSubFolders(parentId: string): Promise<{
    receipts: DriveFolder;
    maintenance: DriveFolder;
    photos: DriveFolder;
    backups: DriveFolder;
  }> {
    const response = await this.drive.files.list({
      q: `'${parentId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`,
      fields: 'files(id, name, parents, webViewLink)',
    });

    const folders = response.data.files || [];
    const findOrCreate = async (name: string) => {
      const found = folders.find((f) => f.name === name);
      return found
        ? ({
            id: found.id || '',
            name: found.name || '',
            parents: found.parents,
            webViewLink: found.webViewLink,
          } as DriveFolder)
        : await this.createFolder(name, parentId);
    };

    return {
      receipts: await findOrCreate('Receipts'),
      maintenance: await findOrCreate('Maintenance Records'),
      photos: await findOrCreate('Vehicle Photos'),
      backups: await findOrCreate('Backups'),
    };
  }

  async findFolder(name: string, parentId?: string): Promise<DriveFolder | null> {
    const query = parentId
      ? `name='${name}' and '${parentId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`
      : `name='${name}' and mimeType='application/vnd.google-apps.folder' and trashed=false`;

    const response = await this.drive.files.list({
      q: query,
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
  }

  async createFolder(name: string, parentId?: string): Promise<DriveFolder> {
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
      throw new Error('Failed to create folder');
    }

    return response.data as DriveFolder;
  }

  async createReceiptDateFolders(
    receiptsFolderId: string,
    year: number,
    month: number
  ): Promise<DriveFolder> {
    const yearFolder =
      (await this.findFolder(year.toString(), receiptsFolderId)) ||
      (await this.createFolder(year.toString(), receiptsFolderId));

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
    const monthName = monthNames[month - 1];

    return (
      (await this.findFolder(monthName, yearFolder.id)) ||
      (await this.createFolder(monthName, yearFolder.id))
    );
  }

  async listFilesInFolder(folderId: string): Promise<DriveFile[]> {
    const response = await this.drive.files.list({
      q: `'${folderId}' in parents and trashed=false`,
      fields: 'files(id, name, mimeType, parents, webViewLink, size, createdTime, modifiedTime)',
      orderBy: 'modifiedTime desc',
    });

    return (response.data.files || []).map((file) => ({
      id: file.id || '',
      name: file.name || '',
      mimeType: file.mimeType || '',
      parents: file.parents,
      webViewLink: file.webViewLink,
      size: file.size,
      createdTime: file.createdTime,
      modifiedTime: file.modifiedTime,
    })) as DriveFile[];
  }

  async getFolderPermissions(folderId: string): Promise<drive_v3.Schema$Permission[]> {
    const response = await this.drive.permissions.list({
      fileId: folderId,
      fields: 'permissions(id, type, role, emailAddress)',
    });
    return response.data.permissions || [];
  }

  async setFolderPermissions(
    folderId: string,
    email: string,
    role: 'reader' | 'writer' | 'owner' = 'writer'
  ): Promise<void> {
    await this.drive.permissions.create({
      fileId: folderId,
      requestBody: { type: 'user', role, emailAddress: email },
    });
  }

  async uploadFile(
    fileName: string,
    fileContent: Buffer | string,
    mimeType: string,
    parentFolderId?: string
  ): Promise<DriveFile> {
    const fileMetadata: drive_v3.Schema$File = { name: fileName };
    if (parentFolderId) {
      fileMetadata.parents = [parentFolderId];
    }

    const { Readable } = await import('node:stream');
    const buffer = Buffer.isBuffer(fileContent) ? fileContent : Buffer.from(fileContent);
    const stream = Readable.from(buffer);

    const response = await this.drive.files.create({
      requestBody: fileMetadata,
      media: { mimeType, body: stream },
      fields: 'id, name, mimeType, parents, webViewLink, size, createdTime, modifiedTime',
    });

    if (!response.data) {
      throw new Error('Failed to upload file');
    }

    return response.data as DriveFile;
  }

  async deleteFile(fileId: string): Promise<void> {
    await this.drive.files.delete({ fileId });
  }

  async downloadFile(fileId: string): Promise<Buffer> {
    const response = await this.drive.files.get(
      { fileId, alt: 'media' },
      { responseType: 'arraybuffer' }
    );
    return Buffer.from(response.data as ArrayBuffer);
  }

  async getFileMetadata(fileId: string): Promise<DriveFile> {
    const response = await this.drive.files.get({
      fileId,
      fields: 'id, name, mimeType, parents, webViewLink, size, createdTime, modifiedTime',
    });

    if (!response.data) {
      throw new Error('Failed to get file metadata');
    }

    return response.data as DriveFile;
  }
}

async function getUserToken(userId: string): Promise<string> {
  const db = getDb();
  const user = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user.length || !user[0].googleRefreshToken) {
    throw new Error('User not found or Google Drive access not available');
  }
  return user[0].googleRefreshToken;
}

export async function createDriveServiceForUser(userId: string): Promise<GoogleDriveService> {
  const token = await getUserToken(userId);
  return new GoogleDriveService(token);
}

export async function getDriveServiceForUser(userId: string): Promise<GoogleDriveService> {
  const db = getDb();
  const userInfo = await db.select().from(users).where(eq(users.id, userId)).limit(1);

  if (!userInfo.length || !userInfo[0].googleRefreshToken) {
    const error = new Error('Google Drive access not available. Please re-authenticate.');
    (error as Error & { code: string }).code = 'AUTH_INVALID';
    throw error;
  }

  return new GoogleDriveService(userInfo[0].googleRefreshToken);
}
