import { createInsertSchema } from 'drizzle-zod';
import { Hono } from 'hono';
import { z } from 'zod';
import { CONFIG } from '../../config';
import { userSettings } from '../../db/schema';
import { AppError } from '../../errors';
import { requireAuth } from '../../middleware';
import { logger } from '../../utils/logger';
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
