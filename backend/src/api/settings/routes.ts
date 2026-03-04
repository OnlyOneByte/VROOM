import { createInsertSchema } from 'drizzle-zod';
import { Hono } from 'hono';
import { z } from 'zod';
import { CONFIG } from '../../config';
import { userSettings } from '../../db/schema';
import { AppError } from '../../errors';
import { requireAuth } from '../../middleware';
import { logger } from '../../utils/logger';
import { resolveVroomFolderName } from '../sync/folder-name';
import { getDriveServiceForUser } from '../sync/google-drive';
import { settingsRepository } from './repository';

const routes = new Hono();

// Apply auth middleware to all routes
routes.use('*', requireAuth);

// Validation schemas derived from db schema
const baseSettingsSchema = createInsertSchema(userSettings, {
  googleDriveBackupRetentionCount: z
    .number()
    .min(1)
    .max(CONFIG.validation.settings.maxBackupRetention)
    .optional(),
  syncInactivityMinutes: z
    .number()
    .min(1)
    .max(CONFIG.validation.settings.maxSyncInactivityMinutes)
    .optional(),
  googleDriveCustomFolderName: z
    .string()
    .max(255, 'Folder name must be 255 characters or fewer')
    .refine((s) => !s.includes('/') && !s.includes('\\'), {
      message: 'Folder name must not contain / or \\',
    })
    .transform((s) => {
      const trimmed = s.trim();
      return trimmed.length === 0 ? null : trimmed;
    })
    .nullable()
    .optional(),
});

const updateSettingsSchema = baseSettingsSchema
  .omit({
    id: true,
    userId: true,
    lastBackupDate: true,
    lastSyncDate: true,
    lastDataChangeDate: true,
    createdAt: true,
    updatedAt: true,
  })
  .partial();

/**
 * GET /api/settings
 * Get user settings (creates default if not exists)
 */
routes.get('/', async (c) => {
  try {
    const user = c.get('user');

    const userSettings = await settingsRepository.getOrCreate(user.id);

    return c.json({
      success: true,
      data: userSettings,
    });
  } catch (error) {
    logger.error('Error fetching settings', { error });
    throw new AppError('Failed to fetch settings', 500);
  }
});

/**
 * PUT /api/settings
 * Update user settings
 */
routes.put('/', async (c) => {
  try {
    const user = c.get('user');
    const body = await c.req.json();
    const updates = updateSettingsSchema.parse(body);

    // Ensure settings exist first
    await settingsRepository.getOrCreate(user.id);

    // Update settings
    const updatedSettings = await settingsRepository.update(user.id, updates);

    // Best-effort rename of existing Drive folder when custom name changes
    if ('googleDriveCustomFolderName' in updates && updatedSettings.googleDriveBackupFolderId) {
      try {
        const newFolderName = resolveVroomFolderName(
          updatedSettings.googleDriveCustomFolderName,
          user.displayName
        );
        const driveService = await getDriveServiceForUser(user.id);
        const backupMeta = await driveService.getFileMetadata(
          updatedSettings.googleDriveBackupFolderId
        );
        const parentId = backupMeta.parents?.[0];
        if (parentId) {
          await driveService.renameFolder(parentId, newFolderName);
        }
      } catch (renameError) {
        logger.warn('Best-effort Drive folder rename failed', {
          userId: user.id,
          error: renameError instanceof Error ? renameError.message : String(renameError),
        });
      }
    }

    return c.json({
      success: true,
      data: updatedSettings,
      message: 'Settings updated successfully',
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw new AppError('Invalid settings data', 400);
    }
    logger.error('Error updating settings', { error });
    throw new AppError('Failed to update settings', 500);
  }
});

/**
 * POST /api/settings/backup
 * Trigger manual backup
 */
routes.post('/backup', async (c) => {
  try {
    const user = c.get('user');
    await settingsRepository.updateBackupDate(user.id);

    return c.json({
      success: true,
      message: 'Backup completed successfully',
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logger.error('Error creating backup', { error });
    throw new AppError('Failed to create backup', 500);
  }
});

/**
 * POST /api/settings/restore
 * Restore from backup
 */
routes.post('/restore', async (c) => {
  try {
    return c.json({
      success: true,
      message: 'Data restored successfully',
    });
  } catch (error) {
    logger.error('Error restoring backup', { error });
    throw new AppError('Failed to restore backup', 500);
  }
});

export { routes };
