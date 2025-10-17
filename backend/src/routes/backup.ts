import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import { backupService } from '../lib/backup-service';
import { databaseService } from '../lib/database';
import { createDriveServiceForUser } from '../lib/google-drive';
import { requireAuth } from '../lib/middleware/auth';
import { SettingsRepository } from '../lib/repositories/settings';

const backup = new Hono();

// All backup routes require authentication
backup.use('*', requireAuth);

/**
 * GET /api/backup/download/:format
 * Download a backup file (json or zip)
 */
backup.get('/download/:format', async (c) => {
  try {
    const user = c.get('user');
    const format = c.req.param('format') as 'json' | 'zip';

    if (!['json', 'zip'].includes(format)) {
      throw new HTTPException(400, {
        message: 'Invalid format. Supported: json, zip',
      });
    }

    let fileContent: Buffer;
    let mimeType: string;
    let fileName: string;

    if (format === 'json') {
      fileContent = await backupService.exportAsJson(user.id);
      mimeType = 'application/json';
      fileName = `vroom-backup-${new Date().toISOString().split('T')[0]}.json`;
    } else {
      fileContent = await backupService.exportAsZip(user.id);
      mimeType = 'application/zip';
      fileName = `vroom-backup-${new Date().toISOString().split('T')[0]}.zip`;
    }

    c.header('Content-Type', mimeType);
    c.header('Content-Disposition', `attachment; filename="${fileName}"`);
    c.header('Content-Length', fileContent.length.toString());

    return new Response(fileContent);
  } catch (error) {
    console.error('Download backup error:', error);
    throw new HTTPException(500, {
      message: 'Failed to create backup file',
    });
  }
});

/**
 * POST /api/backup/upload-to-drive
 * Upload a backup to Google Drive
 */
const uploadToDriveSchema = z.object({
  format: z.enum(['json', 'zip']).default('zip'),
});

backup.post('/upload-to-drive', async (c) => {
  try {
    const user = c.get('user');
    const body = await c.req.json();
    const { format } = uploadToDriveSchema.parse(body);

    const db = databaseService.getDatabase();
    const settingsRepo = new SettingsRepository(db);
    const settings = await settingsRepo.getOrCreate(user.id);

    if (!settings.googleDriveBackupEnabled) {
      throw new HTTPException(400, {
        message: 'Google Drive backup is not enabled',
      });
    }

    const driveService = await createDriveServiceForUser(user.id);
    const folderStructure = await driveService.createVroomFolderStructure(user.displayName);

    // Upload backup
    const uploadResult = await backupService.uploadToGoogleDrive(
      user.id,
      driveService,
      folderStructure.subFolders.backups.id,
      format
    );

    // Update last backup date
    await settingsRepo.updateBackupDate(user.id);

    // Cleanup old backups (keep last 10)
    const deletedCount = await backupService.cleanupOldBackups(
      driveService,
      folderStructure.subFolders.backups.id,
      10
    );

    return c.json({
      message: 'Backup uploaded to Google Drive successfully',
      backup: {
        fileId: uploadResult.fileId,
        fileName: uploadResult.fileName,
        webViewLink: uploadResult.webViewLink,
        folderId: folderStructure.subFolders.backups.id,
        folderLink: folderStructure.subFolders.backups.webViewLink,
      },
      cleanedUp: deletedCount,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Upload to Drive error:', error);

    if (error instanceof z.ZodError) {
      throw new HTTPException(400, {
        message: `Invalid request data: ${error.issues.map((i) => i.message).join(', ')}`,
      });
    }

    if (error instanceof HTTPException) {
      throw error;
    }

    if (error instanceof Error) {
      if (error.message.includes('not found') || error.message.includes('access not available')) {
        throw new HTTPException(401, {
          message: 'Google Drive access not available. Please re-authenticate with Google.',
        });
      }
    }

    throw new HTTPException(500, {
      message: 'Failed to upload backup to Google Drive',
    });
  }
});

/**
 * GET /api/backup/list-drive-backups
 * List all backups in Google Drive
 */
backup.get('/list-drive-backups', async (c) => {
  try {
    const user = c.get('user');

    const driveService = await createDriveServiceForUser(user.id);
    const folderStructure = await driveService.createVroomFolderStructure(user.displayName);

    const backups = await backupService.listBackupsInDrive(
      driveService,
      folderStructure.subFolders.backups.id
    );

    return c.json({
      backups,
      folderId: folderStructure.subFolders.backups.id,
      folderLink: folderStructure.subFolders.backups.webViewLink,
      count: backups.length,
    });
  } catch (error) {
    console.error('List Drive backups error:', error);

    if (error instanceof Error) {
      if (error.message.includes('not found') || error.message.includes('access not available')) {
        throw new HTTPException(401, {
          message: 'Google Drive access not available. Please re-authenticate with Google.',
        });
      }
    }

    throw new HTTPException(500, {
      message: 'Failed to list backups from Google Drive',
    });
  }
});

/**
 * DELETE /api/backup/drive/:fileId
 * Delete a specific backup from Google Drive
 */
backup.delete('/drive/:fileId', async (c) => {
  try {
    const user = c.get('user');
    const fileId = c.req.param('fileId');

    if (!fileId) {
      throw new HTTPException(400, { message: 'File ID is required' });
    }

    const driveService = await createDriveServiceForUser(user.id);
    await driveService.deleteFile(fileId);

    return c.json({
      message: 'Backup deleted successfully',
      fileId,
    });
  } catch (error) {
    console.error('Delete backup error:', error);

    if (error instanceof Error) {
      if (error.message.includes('not found') || error.message.includes('access not available')) {
        throw new HTTPException(401, {
          message: 'Google Drive access not available. Please re-authenticate with Google.',
        });
      }
    }

    throw new HTTPException(500, {
      message: 'Failed to delete backup',
    });
  }
});

/**
 * Check if backup is due based on frequency
 */
function isBackupDue(
  lastBackupDate: Date | null,
  frequency: 'daily' | 'weekly' | 'monthly'
): {
  isDue: boolean;
  nextBackupDue?: string;
} {
  if (!lastBackupDate) {
    return { isDue: true };
  }

  const now = new Date();
  const daysSinceLastBackup = Math.floor(
    (now.getTime() - lastBackupDate.getTime()) / (1000 * 60 * 60 * 24)
  );

  const requiredDays =
    {
      daily: 1,
      weekly: 7,
      monthly: 30,
    }[frequency] ?? 7;

  if (daysSinceLastBackup < requiredDays) {
    return {
      isDue: false,
      nextBackupDue: new Date(
        lastBackupDate.getTime() + requiredDays * 24 * 60 * 60 * 1000
      ).toISOString(),
    };
  }

  return { isDue: true };
}

/**
 * POST /api/backup/auto-backup
 * Trigger automatic backup based on settings
 */
backup.post('/auto-backup', async (c) => {
  try {
    const user = c.get('user');

    const db = databaseService.getDatabase();
    const settingsRepo = new SettingsRepository(db);
    const settings = await settingsRepo.getOrCreate(user.id);

    if (!settings.autoBackupEnabled || !settings.googleDriveBackupEnabled) {
      throw new HTTPException(400, {
        message: 'Automatic backup is not enabled',
      });
    }

    // Check if backup is due
    const lastBackup = settings.lastBackupDate ? new Date(settings.lastBackupDate) : null;
    const backupCheck = isBackupDue(
      lastBackup,
      settings.backupFrequency as 'daily' | 'weekly' | 'monthly'
    );

    if (!backupCheck.isDue) {
      return c.json({
        message: 'Backup not due yet',
        lastBackup: lastBackup?.toISOString(),
        nextBackupDue: backupCheck.nextBackupDue,
        skipped: true,
      });
    }

    // Perform backup
    const driveService = await createDriveServiceForUser(user.id);
    const folderStructure = await driveService.createVroomFolderStructure(user.displayName);

    const uploadResult = await backupService.uploadToGoogleDrive(
      user.id,
      driveService,
      folderStructure.subFolders.backups.id,
      'zip'
    );

    await settingsRepo.updateBackupDate(user.id);

    // Cleanup old backups
    const deletedCount = await backupService.cleanupOldBackups(
      driveService,
      folderStructure.subFolders.backups.id,
      10
    );

    return c.json({
      message: 'Automatic backup completed successfully',
      backup: {
        fileId: uploadResult.fileId,
        fileName: uploadResult.fileName,
        webViewLink: uploadResult.webViewLink,
      },
      cleanedUp: deletedCount,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Auto backup error:', error);

    if (error instanceof HTTPException) {
      throw error;
    }

    if (error instanceof Error) {
      if (error.message.includes('not found') || error.message.includes('access not available')) {
        throw new HTTPException(401, {
          message: 'Google Drive access not available. Please re-authenticate with Google.',
        });
      }
    }

    throw new HTTPException(500, {
      message: 'Failed to perform automatic backup',
    });
  }
});

export { backup };
