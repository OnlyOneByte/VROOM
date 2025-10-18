/**
 * Sheets Sync - Handles Google Sheets sync operations
 */

import { eq } from 'drizzle-orm';
import { users } from '../../../db/schema';
import { databaseService } from '../../database';
import { GoogleSheetsService } from '../../google-sheets';
import { SettingsRepository } from '../../repositories/settings-repository';
import { logger } from '../../utils/logger';
import { SyncError, SyncErrorCode } from './sync-errors';

export interface SheetsSyncResult {
  spreadsheetId: string;
  webViewLink: string;
  lastSyncDate: string;
}

export class SheetsSync {
  private settingsRepository: SettingsRepository;

  constructor() {
    const db = databaseService.getDatabase();
    this.settingsRepository = new SettingsRepository(db);
  }

  /**
   * Sync data to Google Sheets
   */
  async syncToSheets(userId: string): Promise<SheetsSyncResult> {
    logger.info('Starting Google Sheets sync', { userId });

    const settings = await this.settingsRepository.getUserSettings(userId);

    if (!settings || !settings.googleSheetsSyncEnabled) {
      throw new SyncError(
        SyncErrorCode.VALIDATION_ERROR,
        'Google Sheets sync is not enabled for this user'
      );
    }

    const user = await this.getUserWithToken(userId);

    try {
      const sheetsService = new GoogleSheetsService(
        user.googleRefreshToken,
        user.googleRefreshToken
      );

      const spreadsheetInfo = await sheetsService.createOrUpdateVroomSpreadsheet(
        userId,
        user.displayName
      );

      await this.settingsRepository.updateLastSyncDate(userId, spreadsheetInfo.id);

      logger.info('Google Sheets sync completed', { userId, spreadsheetId: spreadsheetInfo.id });

      return {
        spreadsheetId: spreadsheetInfo.id,
        webViewLink: spreadsheetInfo.webViewLink,
        lastSyncDate: new Date().toISOString(),
      };
    } catch (error) {
      logger.error('Google Sheets sync failed', {
        userId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });

      if (error instanceof Error && error.message.includes('auth')) {
        throw new SyncError(
          SyncErrorCode.AUTH_INVALID,
          'Google Drive access not available. Please re-authenticate with Google.',
          error.message
        );
      }

      if (error instanceof SyncError) {
        throw error;
      }

      throw new SyncError(
        SyncErrorCode.NETWORK_ERROR,
        'Failed to sync to Google Sheets',
        error instanceof Error ? error.message : 'Unknown error'
      );
    }
  }

  /**
   * Get user with Google refresh token
   */
  private async getUserWithToken(userId: string): Promise<{
    id: string;
    displayName: string;
    googleRefreshToken: string;
  }> {
    const db = databaseService.getDatabase();
    const userResults = await db.select().from(users).where(eq(users.id, userId)).limit(1);

    if (!userResults.length || !userResults[0].googleRefreshToken) {
      throw new SyncError(
        SyncErrorCode.AUTH_INVALID,
        'Google Drive access not available. Please re-authenticate with Google.'
      );
    }

    return {
      id: userResults[0].id,
      displayName: userResults[0].displayName,
      googleRefreshToken: userResults[0].googleRefreshToken,
    };
  }
}

export const sheetsSync = new SheetsSync();
