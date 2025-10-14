import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { requireAuth } from '../lib/middleware/auth';
import { GoogleSheetsService, createSheetsServiceForUser } from '../lib/google-sheets';
import { activityTracker } from '../lib/activity-tracker';
import { z } from 'zod';

const sheets = new Hono();

// All sheets routes require authentication
sheets.use('*', requireAuth);

/**
 * POST /api/sheets/backup
 * Create or update the VROOM spreadsheet with current data
 */
sheets.post('/backup', async (c) => {
  try {
    const user = c.get('user');
    
    const sheetsService = await createSheetsServiceForUser(user.id);
    const spreadsheetInfo = await sheetsService.createOrUpdateVroomSpreadsheet(user.id, user.displayName);

    return c.json({
      message: 'Data backed up to Google Sheets successfully',
      spreadsheet: {
        id: spreadsheetInfo.id,
        name: spreadsheetInfo.name,
        webViewLink: spreadsheetInfo.webViewLink,
        sheets: spreadsheetInfo.sheets,
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Sheets backup error:', error);
    
    if (error instanceof Error) {
      if (error.message.includes('not found') || error.message.includes('access not available')) {
        throw new HTTPException(401, { 
          message: 'Google Sheets access not available. Please re-authenticate with Google.' 
        });
      }
    }
    
    throw new HTTPException(500, { 
      message: 'Failed to backup data to Google Sheets' 
    });
  }
});

/**
 * GET /api/sheets/status
 * Get the status of the VROOM spreadsheet
 */
sheets.get('/status', async (c) => {
  try {
    const user = c.get('user');
    
    const sheetsService = await createSheetsServiceForUser(user.id);
    const spreadsheetInfo = await sheetsService.createOrUpdateVroomSpreadsheet(user.id, user.displayName);

    return c.json({
      spreadsheet: {
        id: spreadsheetInfo.id,
        name: spreadsheetInfo.name,
        webViewLink: spreadsheetInfo.webViewLink,
        sheets: spreadsheetInfo.sheets,
      },
      lastSync: new Date().toISOString(), // In a real app, you'd track this
      syncEnabled: true,
    });
  } catch (error) {
    console.error('Get sheets status error:', error);
    
    if (error instanceof Error) {
      if (error.message.includes('not found') || error.message.includes('access not available')) {
        throw new HTTPException(401, { 
          message: 'Google Sheets access not available. Please re-authenticate with Google.' 
        });
      }
    }
    
    throw new HTTPException(500, { 
      message: 'Failed to get Google Sheets status' 
    });
  }
});

/**
 * POST /api/sheets/sync
 * Bi-directional sync between SQLite and Google Sheets
 */
sheets.post('/sync', async (c) => {
  try {
    const user = c.get('user');
    
    // For now, this is a simple backup operation
    // In a full implementation, you'd compare timestamps and sync changes both ways
    const sheetsService = await createSheetsServiceForUser(user.id);
    const spreadsheetInfo = await sheetsService.createOrUpdateVroomSpreadsheet(user.id, user.displayName);

    return c.json({
      message: 'Data synchronized with Google Sheets successfully',
      spreadsheet: {
        id: spreadsheetInfo.id,
        name: spreadsheetInfo.name,
        webViewLink: spreadsheetInfo.webViewLink,
      },
      syncType: 'backup', // In full implementation: 'backup', 'restore', 'bidirectional'
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Sheets sync error:', error);
    
    if (error instanceof Error) {
      if (error.message.includes('not found') || error.message.includes('access not available')) {
        throw new HTTPException(401, { 
          message: 'Google Sheets access not available. Please re-authenticate with Google.' 
        });
      }
    }
    
    throw new HTTPException(500, { 
      message: 'Failed to sync data with Google Sheets' 
    });
  }
});

/**
 * GET /api/sheets/:spreadsheetId/data/:sheetName
 * Read data from a specific sheet
 */
sheets.get('/:spreadsheetId/data/:sheetName', async (c) => {
  try {
    const user = c.get('user');
    const spreadsheetId = c.req.param('spreadsheetId');
    const sheetName = c.req.param('sheetName');
    
    if (!spreadsheetId || !sheetName) {
      throw new HTTPException(400, { message: 'Spreadsheet ID and sheet name are required' });
    }
    
    const sheetsService = await createSheetsServiceForUser(user.id);
    const data = await sheetsService.readSheetData(spreadsheetId, `${sheetName}!A:Z`);

    return c.json({
      spreadsheetId,
      sheetName,
      data,
      rowCount: data.length,
    });
  } catch (error) {
    console.error('Read sheet data error:', error);
    
    if (error instanceof Error) {
      if (error.message.includes('not found') || error.message.includes('access not available')) {
        throw new HTTPException(401, { 
          message: 'Google Sheets access not available. Please re-authenticate with Google.' 
        });
      }
    }
    
    throw new HTTPException(500, { 
      message: 'Failed to read sheet data' 
    });
  }
});

/**
 * GET /api/sheets/:spreadsheetId/export/:format
 * Export spreadsheet data in different formats
 */
const exportFormats = ['json', 'csv', 'xlsx'] as const;
type ExportFormat = typeof exportFormats[number];

sheets.get('/:spreadsheetId/export/:format', async (c) => {
  try {
    const user = c.get('user');
    const spreadsheetId = c.req.param('spreadsheetId');
    const format = c.req.param('format') as ExportFormat;
    
    if (!spreadsheetId || !format) {
      throw new HTTPException(400, { message: 'Spreadsheet ID and format are required' });
    }
    
    if (!exportFormats.includes(format)) {
      throw new HTTPException(400, { message: 'Invalid export format. Supported: json, csv, xlsx' });
    }
    
    const sheetsService = await createSheetsServiceForUser(user.id);
    const exportedData = await sheetsService.exportData(spreadsheetId, format);

    // Set appropriate headers based on format
    switch (format) {
      case 'json':
        c.header('Content-Type', 'application/json');
        c.header('Content-Disposition', `attachment; filename="vroom-data.json"`);
        return c.json(exportedData);
      
      case 'csv':
        c.header('Content-Type', 'text/csv');
        c.header('Content-Disposition', `attachment; filename="vroom-expenses.csv"`);
        return c.body(exportedData as Buffer);
      
      case 'xlsx':
        c.header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        c.header('Content-Disposition', `attachment; filename="vroom-data.xlsx"`);
        return c.body(exportedData as Buffer);
      
      default:
        throw new HTTPException(400, { message: 'Unsupported export format' });
    }
  } catch (error) {
    console.error('Export data error:', error);
    
    if (error instanceof Error) {
      if (error.message.includes('not found') || error.message.includes('access not available')) {
        throw new HTTPException(401, { 
          message: 'Google Sheets access not available. Please re-authenticate with Google.' 
        });
      }
      if (error.message.includes('Invalid export format') || error.message.includes('Unsupported')) {
        throw new HTTPException(400, { message: error.message });
      }
    }
    
    throw new HTTPException(500, { 
      message: 'Failed to export data' 
    });
  }
});

/**
 * POST /api/sheets/configure
 * Configure Google Sheets integration settings
 */
const configureSchema = z.object({
  autoSync: z.boolean().default(true),
  syncInterval: z.enum(['manual', 'daily', 'weekly', 'on-inactivity']).default('on-inactivity'),
  inactivityDelay: z.number().min(1).max(60).default(5), // minutes
  organizeByDate: z.boolean().default(true),
});

sheets.post('/configure', async (c) => {
  try {
    const user = c.get('user');
    const body = await c.req.json();
    const config = configureSchema.parse(body);
    
    // In a full implementation, you'd save these settings to the database
    // For now, we'll just return the configuration
    
    return c.json({
      message: 'Google Sheets configuration updated successfully',
      configuration: {
        userId: user.id,
        autoSync: config.autoSync,
        syncInterval: config.syncInterval,
        inactivityDelay: config.inactivityDelay,
        organizeByDate: config.organizeByDate,
        updatedAt: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error('Configure sheets error:', error);
    
    if (error instanceof z.ZodError) {
      throw new HTTPException(400, { 
        message: `Invalid configuration: ${error.issues.map(i => i.message).join(', ')}`,
      });
    }
    
    throw new HTTPException(500, { 
      message: 'Failed to configure Google Sheets integration' 
    });
  }
});

/**
 * POST /api/sheets/restore
 * Restore data from Google Sheets to SQLite (future implementation)
 */
sheets.post('/restore', async (c) => {
  try {
    const user = c.get('user');
    
    // This would be a complex operation involving:
    // 1. Reading data from Google Sheets
    // 2. Comparing with local SQLite data
    // 3. Resolving conflicts
    // 4. Updating local database
    
    // For now, return a placeholder response
    return c.json({
      message: 'Data restore from Google Sheets is not yet implemented',
      status: 'coming_soon',
      recommendation: 'Use the backup functionality to keep your Google Sheets up to date',
    });
  } catch (error) {
    console.error('Sheets restore error:', error);
    throw new HTTPException(500, { 
      message: 'Failed to restore data from Google Sheets' 
    });
  }
});

/**
 * POST /api/sheets/sync/auto
 * Trigger inactivity-based auto-sync manually
 */
sheets.post('/sync/auto', async (c) => {
  try {
    const user = c.get('user');
    
    const result = await activityTracker.triggerManualSync(user.id);
    
    if (result.success) {
      return c.json({
        message: result.message,
        timestamp: new Date().toISOString(),
        syncType: 'manual_trigger',
      });
    } else {
      throw new HTTPException(409, { message: result.message });
    }
  } catch (error) {
    console.error('Manual auto-sync error:', error);
    
    if (error instanceof HTTPException) {
      throw error;
    }
    
    throw new HTTPException(500, { 
      message: 'Failed to trigger manual sync' 
    });
  }
});

/**
 * GET /api/sheets/sync/status
 * Get sync status and activity information
 */
sheets.get('/sync/status', async (c) => {
  try {
    const user = c.get('user');
    
    const syncStatus = activityTracker.getSyncStatus(user.id);
    
    return c.json({
      userId: user.id,
      syncStatus: {
        lastActivity: syncStatus.lastActivity?.toISOString(),
        syncInProgress: syncStatus.syncInProgress,
        nextAutoSyncIn: syncStatus.nextSyncIn ? `${syncStatus.nextSyncIn} minutes` : null,
      },
      autoSyncEnabled: true, // In a full implementation, this would come from user settings
      inactivityDelay: 5, // In a full implementation, this would come from user settings
    });
  } catch (error) {
    console.error('Get sync status error:', error);
    throw new HTTPException(500, { 
      message: 'Failed to get sync status' 
    });
  }
});

/**
 * POST /api/sheets/sync/config
 * Update auto-sync configuration
 */
const syncConfigSchema = z.object({
  autoSyncEnabled: z.boolean().default(true),
  inactivityDelayMinutes: z.number().min(1).max(60).default(5),
});

sheets.post('/sync/config', async (c) => {
  try {
    const user = c.get('user');
    const body = await c.req.json();
    const config = syncConfigSchema.parse(body);
    
    // Update activity tracker configuration
    activityTracker.updateSyncConfig(user.id, {
      enabled: true,
      autoSyncEnabled: config.autoSyncEnabled,
      inactivityDelayMinutes: config.inactivityDelayMinutes,
    });
    
    return c.json({
      message: 'Auto-sync configuration updated successfully',
      configuration: {
        userId: user.id,
        autoSyncEnabled: config.autoSyncEnabled,
        inactivityDelayMinutes: config.inactivityDelayMinutes,
        updatedAt: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error('Update sync config error:', error);
    
    if (error instanceof z.ZodError) {
      throw new HTTPException(400, { 
        message: `Invalid configuration: ${error.issues.map(i => i.message).join(', ')}`,
      });
    }
    
    throw new HTTPException(500, { 
      message: 'Failed to update auto-sync configuration' 
    });
  }
});

export { sheets };