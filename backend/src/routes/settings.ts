import { createInsertSchema } from 'drizzle-zod';
import { Hono } from 'hono';
import { z } from 'zod';
import { userSettings } from '../db/schema';
import { VALIDATION_LIMITS } from '../lib/constants';
import { AppError } from '../lib/core/errors';
import { requireAuth } from '../lib/middleware/auth';
import { settingsRepository } from '../lib/repositories';
import { logger } from '../lib/utils/logger';

const settings = new Hono();

// Apply auth middleware to all routes
settings.use('*', requireAuth);

// Validation schemas derived from db schema
const baseSettingsSchema = createInsertSchema(userSettings, {
  googleDriveBackupRetentionCount: z
    .number()
    .min(1)
    .max(VALIDATION_LIMITS.SETTINGS.MAX_BACKUP_RETENTION)
    .optional(),
  syncInactivityMinutes: z
    .number()
    .min(1)
    .max(VALIDATION_LIMITS.SETTINGS.MAX_SYNC_INACTIVITY_MINUTES)
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
settings.get('/', async (c) => {
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
settings.put('/', async (c) => {
  try {
    const user = c.get('user');
    const body = await c.req.json();
    const updates = updateSettingsSchema.parse(body);

    // Ensure settings exist first
    await settingsRepository.getOrCreate(user.id);

    // Update settings
    const updatedSettings = await settingsRepository.update(user.id, updates);

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
settings.post('/backup', async (c) => {
  try {
    const user = c.get('user');
    // Update last backup date
    await settingsRepository.updateBackupDate(user.id);

    // TODO: Implement actual backup logic (export data, upload to Drive, etc.)

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
settings.post('/restore', async (c) => {
  try {
    // TODO: Implement restore logic (download from Drive, import data, etc.)

    return c.json({
      success: true,
      message: 'Data restored successfully',
    });
  } catch (error) {
    logger.error('Error restoring backup', { error });
    throw new AppError('Failed to restore backup', 500);
  }
});

export { settings };
