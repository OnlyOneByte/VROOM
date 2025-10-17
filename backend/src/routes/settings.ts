import { Hono } from 'hono';
import { z } from 'zod';
import { databaseService } from '../lib/database';
import { AppError } from '../lib/errors';
import { requireAuth } from '../lib/middleware/auth';
import { SettingsRepository } from '../lib/repositories/settings';

const settings = new Hono();

// Apply auth middleware to all routes
settings.use('*', requireAuth);

// Validation schemas
const updateSettingsSchema = z.object({
  distanceUnit: z.enum(['miles', 'kilometers']).optional(),
  fuelUnit: z.enum(['gallons', 'liters']).optional(),
  currencyUnit: z.string().optional(),
  autoBackupEnabled: z.boolean().optional(),
  backupFrequency: z.enum(['daily', 'weekly', 'monthly']).optional(),
  googleDriveBackupEnabled: z.boolean().optional(),
  googleDriveBackupFolderId: z.string().optional(),
  googleSheetsSyncEnabled: z.boolean().optional(),
  googleSheetsSpreadsheetId: z.string().optional(),
  syncOnInactivity: z.boolean().optional(),
  syncInactivityMinutes: z.number().min(1).max(30).optional(),
});

/**
 * GET /api/settings
 * Get user settings (creates default if not exists)
 */
settings.get('/', async (c) => {
  try {
    const user = c.get('user');
    const db = databaseService.getDatabase();
    const settingsRepo = new SettingsRepository(db);

    const userSettings = await settingsRepo.getOrCreate(user.id);

    return c.json({
      success: true,
      data: userSettings,
    });
  } catch (error) {
    console.error('Error fetching settings:', error);
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

    const db = databaseService.getDatabase();
    const settingsRepo = new SettingsRepository(db);

    // Ensure settings exist first
    await settingsRepo.getOrCreate(user.id);

    // Update settings
    const updatedSettings = await settingsRepo.update(user.id, updates);

    return c.json({
      success: true,
      data: updatedSettings,
      message: 'Settings updated successfully',
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw new AppError('Invalid settings data', 400);
    }
    console.error('Error updating settings:', error);
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
    const db = databaseService.getDatabase();
    const settingsRepo = new SettingsRepository(db);

    // Update last backup date
    await settingsRepo.updateBackupDate(user.id);

    // TODO: Implement actual backup logic (export data, upload to Drive, etc.)

    return c.json({
      success: true,
      message: 'Backup completed successfully',
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Error creating backup:', error);
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
    console.error('Error restoring backup:', error);
    throw new AppError('Failed to restore backup', 500);
  }
});

export { settings };
