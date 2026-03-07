/**
 * Data Migration: Auto-create Google Drive providers and backfill photo_refs.
 *
 * Runs after Drizzle schema migrations. Idempotent — safe to run multiple times.
 *
 * 1. For each user with a googleRefreshToken, creates a user_providers row
 *    (domain: 'storage', providerType: 'google-drive').
 * 2. Updates user_settings.storage_config with defaults pointing to the new provider.
 * 3. For each photo in the _photos_drive_data temp table, creates a photo_refs row
 *    linking the photo to the auto-created provider.
 * 4. Drops the _photos_drive_data temp table when done.
 */

import type { Database as BunDatabase } from 'bun:sqlite';
import { createId } from '@paralleldrive/cuid2';
import type { StorageConfig } from '../types';
import { encrypt } from '../utils/encryption';
import { logger } from '../utils/logger';

interface UserRow {
  id: string;
  google_refresh_token: string | null;
}

interface DriveDataRow {
  photo_id: string;
  drive_file_id: string | null;
  web_view_link: string | null;
}

interface PhotoRow {
  id: string;
  entity_type: string;
  entity_id: string;
}

interface CountRow {
  count: number;
}

interface TableRow {
  name: string;
}

/**
 * Run the data migration using raw SQLite for direct access.
 * This avoids Drizzle ORM overhead and works with temp tables that aren't in the schema.
 */
export async function runDataMigration(sqlite: BunDatabase): Promise<void> {
  if (migrationAlreadyRan(sqlite)) {
    logger.info('Data migration already completed — skipping');
    return;
  }

  const hasTempTable = tempTableExists(sqlite);

  logger.info('Starting data migration: auto-create providers and backfill photo_refs');

  const usersWithTokens = sqlite
    .query('SELECT id, google_refresh_token FROM users WHERE google_refresh_token IS NOT NULL')
    .all() as UserRow[];

  if (usersWithTokens.length === 0) {
    logger.info('No users with Google refresh tokens — skipping provider creation');
    cleanupTempTable(sqlite, hasTempTable);
    return;
  }

  const userProviderMap = new Map<string, string>();

  sqlite.run('BEGIN');
  try {
    const now = Date.now();
    createProvidersAndSettings(sqlite, usersWithTokens, userProviderMap, now);

    if (hasTempTable) {
      backfillPhotoRefs(sqlite, userProviderMap, now);
    }

    // Drop temp table inside the transaction so it's atomic with the data changes.
    // This prevents re-running the migration on every startup if the drop were to
    // fail outside the transaction.
    cleanupTempTable(sqlite, hasTempTable);

    sqlite.run('COMMIT');
  } catch (error) {
    sqlite.run('ROLLBACK');
    throw error;
  }

  logger.info(
    `Data migration complete: created ${userProviderMap.size} providers, updated settings`
  );
}

function migrationAlreadyRan(sqlite: BunDatabase): boolean {
  // Check if providers already exist AND the temp table is gone — meaning the
  // migration completed previously. If the temp table still exists, we need to
  // run the backfill even if providers were created via the API.
  const hasProviders = sqlite
    .query("SELECT COUNT(*) as count FROM user_providers WHERE domain = 'storage'")
    .get() as CountRow | null;
  const hasTempTable = tempTableExists(sqlite);

  // Migration already ran if providers exist and temp table was cleaned up
  return (hasProviders?.count ?? 0) > 0 && !hasTempTable;
}

function tempTableExists(sqlite: BunDatabase): boolean {
  const result = sqlite
    .query("SELECT name FROM sqlite_master WHERE type='table' AND name='_photos_drive_data'")
    .get() as TableRow | null;
  return result !== null;
}

/**
 * Create a user_providers row and update user_settings for each user with a Google token.
 */
function createProvidersAndSettings(
  sqlite: BunDatabase,
  users: UserRow[],
  userProviderMap: Map<string, string>,
  now: number
): void {
  for (const user of users) {
    // Check if this user already has a google-drive storage provider (partial retry safety)
    const existing = sqlite
      .query(
        "SELECT id FROM user_providers WHERE user_id = ? AND domain = 'storage' AND provider_type = 'google-drive' LIMIT 1"
      )
      .get(user.id) as { id: string } | null;

    if (existing) {
      // Reuse the existing provider ID so photo_ref backfill links to the right row
      userProviderMap.set(user.id, existing.id);
      continue;
    }

    const providerId = createId();
    userProviderMap.set(user.id, providerId);

    const encryptedCredentials = encrypt(
      JSON.stringify({ refreshToken: user.google_refresh_token })
    );

    sqlite.run(
      `INSERT INTO user_providers (id, user_id, domain, provider_type, display_name, credentials, config, status, created_at, updated_at)
       VALUES (?, ?, 'storage', 'google-drive', 'Google Drive', ?, '{"rootPath":"/VROOM"}', 'active', ?, ?)`,
      [providerId, user.id, encryptedCredentials, now, now]
    );

    const storageConfig: StorageConfig = {
      defaults: {
        vehicle_photos: providerId,
        expense_receipts: providerId,
        insurance_docs: providerId,
        odometer_readings: providerId,
      },
      providerCategories: {
        [providerId]: {
          vehicle_photos: { enabled: true, folderPath: '/Vehicle Photos' },
          expense_receipts: { enabled: true, folderPath: '/Receipts' },
          insurance_docs: { enabled: true, folderPath: '/Insurance' },
          odometer_readings: { enabled: true, folderPath: '/Odometer' },
        },
      },
    };

    upsertStorageConfig(sqlite, user.id, storageConfig, now);
  }
}

function upsertStorageConfig(
  sqlite: BunDatabase,
  userId: string,
  storageConfig: StorageConfig,
  now: number
): void {
  const existing = sqlite.query('SELECT id FROM user_settings WHERE user_id = ?').get(userId) as {
    id: string;
  } | null;

  if (existing) {
    sqlite.run('UPDATE user_settings SET storage_config = ?, updated_at = ? WHERE user_id = ?', [
      JSON.stringify(storageConfig),
      now,
      userId,
    ]);
  } else {
    const settingsId = createId();
    sqlite.run(
      `INSERT INTO user_settings (id, user_id, storage_config, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)`,
      [settingsId, userId, JSON.stringify(storageConfig), now, now]
    );
  }
}

/**
 * Create photo_refs rows from the _photos_drive_data temp table.
 */
function backfillPhotoRefs(
  sqlite: BunDatabase,
  userProviderMap: Map<string, string>,
  now: number
): void {
  const driveData = sqlite
    .query('SELECT photo_id, drive_file_id, web_view_link FROM _photos_drive_data')
    .all() as DriveDataRow[];

  if (driveData.length === 0) return;

  const photoOwnerMap = buildPhotoOwnerMap(sqlite, driveData);
  let backfilledCount = 0;

  for (const row of driveData) {
    if (!row.drive_file_id) continue;

    const providerId = resolveProviderForPhoto(row, photoOwnerMap, userProviderMap);
    if (!providerId) continue;

    const refId = createId();
    sqlite.run(
      `INSERT INTO photo_refs (id, photo_id, provider_id, storage_ref, external_url, status, retry_count, synced_at, created_at)
       VALUES (?, ?, ?, ?, ?, 'active', 0, ?, ?)`,
      [refId, row.photo_id, providerId, row.drive_file_id, row.web_view_link, now, now]
    );
    backfilledCount++;
  }

  logger.info(`Backfilled ${backfilledCount} photo_refs from drive data`);
}

function resolveProviderForPhoto(
  row: DriveDataRow,
  photoOwnerMap: Map<string, string>,
  userProviderMap: Map<string, string>
): string | undefined {
  const ownerId = photoOwnerMap.get(row.photo_id);
  if (!ownerId) {
    logger.warn('Could not determine owner for photo — skipping', { photoId: row.photo_id });
    return undefined;
  }

  const providerId = userProviderMap.get(ownerId);
  if (!providerId) {
    logger.warn('No provider for photo owner — skipping', { photoId: row.photo_id, ownerId });
    return undefined;
  }

  return providerId;
}

/**
 * Build a map of photoId -> ownerUserId by joining photos with their parent entities.
 * Photos use polymorphic entity_type/entity_id, so we need to check each entity type.
 */
function buildPhotoOwnerMap(sqlite: BunDatabase, driveData: DriveDataRow[]): Map<string, string> {
  const photoIds = driveData.map((d) => d.photo_id);
  if (photoIds.length === 0) return new Map();

  const ownerMap = new Map<string, string>();
  const BATCH_SIZE = 500;

  for (let i = 0; i < photoIds.length; i += BATCH_SIZE) {
    const batch = photoIds.slice(i, i + BATCH_SIZE);
    const placeholders = batch.map(() => '?').join(',');
    const photos = sqlite
      .query(`SELECT id, entity_type, entity_id FROM photos WHERE id IN (${placeholders})`)
      .all(...batch) as PhotoRow[];

    for (const photo of photos) {
      const ownerId = resolveEntityOwner(sqlite, photo.entity_type, photo.entity_id);
      if (ownerId) {
        ownerMap.set(photo.id, ownerId);
      }
    }
  }

  return ownerMap;
}

function resolveEntityOwner(
  sqlite: BunDatabase,
  entityType: string,
  entityId: string
): string | undefined {
  switch (entityType) {
    case 'vehicle': {
      const row = sqlite.query('SELECT user_id FROM vehicles WHERE id = ?').get(entityId) as {
        user_id: string;
      } | null;
      return row?.user_id;
    }
    case 'expense': {
      const row = sqlite
        .query(
          'SELECT v.user_id FROM expenses e JOIN vehicles v ON e.vehicle_id = v.id WHERE e.id = ?'
        )
        .get(entityId) as { user_id: string } | null;
      return row?.user_id;
    }
    case 'expense_group': {
      const row = sqlite.query('SELECT user_id FROM expense_groups WHERE id = ?').get(entityId) as {
        user_id: string;
      } | null;
      return row?.user_id;
    }
    case 'insurance_policy': {
      const row = sqlite
        .query(
          `SELECT DISTINCT v.user_id FROM insurance_policy_vehicles ipv
           JOIN vehicles v ON ipv.vehicle_id = v.id
           WHERE ipv.policy_id = ? LIMIT 1`
        )
        .get(entityId) as { user_id: string } | null;
      return row?.user_id;
    }
    case 'odometer_entry': {
      const row = sqlite
        .query(
          'SELECT v.user_id FROM odometer_entries o JOIN vehicles v ON o.vehicle_id = v.id WHERE o.id = ?'
        )
        .get(entityId) as { user_id: string } | null;
      return row?.user_id;
    }
    default:
      return undefined;
  }
}

function cleanupTempTable(sqlite: BunDatabase, exists: boolean): void {
  if (exists) {
    sqlite.run('DROP TABLE IF EXISTS _photos_drive_data');
    logger.info('Dropped _photos_drive_data temp table');
  }
}
