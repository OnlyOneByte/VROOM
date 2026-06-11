import { zValidator } from '@hono/zod-validator';
import { and, eq, notExists, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import { CONFIG } from '../../config';
import { getDb } from '../../db/connection';
import { photoRefs, photos, type UserProvider, userProviders } from '../../db/schema';
import { ConflictError, NotFoundError, ValidationError } from '../../errors';
import { changeTracker, requireAuth } from '../../middleware';
import type { PhotoCategory, StorageConfig } from '../../types';
import { DEFAULT_STORAGE_CONFIG } from '../../types';
import { encrypt } from '../../utils/encryption';
import { logger } from '../../utils/logger';
import { consumePending, getPendingEmail } from '../../utils/pending-credentials';
import { commonSchemas } from '../../utils/validation';
import { photoRefRepository } from '../photos/photo-ref-repository';
import { preferencesRepository } from '../settings/repository';
import { storageProviderRegistry } from './domains/storage/registry';

/** Maps photo categories to their corresponding entity types for photo queries. */
const CATEGORY_TO_ENTITY_TYPES: Record<string, string[]> = {
  vehicle_photos: ['vehicle'],
  expense_receipts: ['expense'],
  insurance_docs: ['insurance_policy', 'insurance_claim'],
  odometer_readings: ['odometer_entry'],
};

const routes = new Hono();

// --- Helpers ---

type DbInstance =
  | ReturnType<typeof getDb>
  | Parameters<Parameters<ReturnType<typeof getDb>['transaction']>[0]>[0];

/**
 * Fetch the provider owned by `userId` with id `id`, or throw NotFoundError('Provider') (C123 arch).
 * The ownership-check + 404 was hand-repeated byte-identically at 5 route handlers (PATCH/DELETE/
 * health/backfill/sync); each then uses the returned row, so this RETURNS it. Scoped to userId — a
 * provider not owned by the caller is indistinguishable from a missing one (no cross-tenant probe).
 */
async function findOwnedProviderOrThrow(
  db: DbInstance,
  id: string,
  userId: string
): Promise<UserProvider> {
  const existing = await db
    .select()
    .from(userProviders)
    .where(and(eq(userProviders.id, id), eq(userProviders.userId, userId)))
    .limit(1);
  if (!existing[0]) {
    throw new NotFoundError('Provider');
  }
  return existing[0];
}

/**
 * Count photos of a given entity type owned by a specific user.
 * v2: uses direct photos.user_id instead of multi-branch entity JOINs.
 */
async function countUserPhotos(
  db: DbInstance,
  entityType: string,
  userId: string,
  extraConditions?: ReturnType<typeof and>
): Promise<number> {
  const conditions = [eq(photos.entityType, entityType), eq(photos.userId, userId)];
  if (extraConditions) conditions.push(extraConditions);

  const result = await db
    .select({ count: sql<number>`count(*)` })
    .from(photos)
    .where(and(...conditions));

  return result[0]?.count ?? 0;
}

/**
 * Find photo IDs of a given entity type owned by a specific user,
 * optionally filtered by additional conditions (e.g. missing refs).
 * v2: uses direct photos.user_id instead of multi-branch entity JOINs.
 */
async function findUserPhotoIds(
  db: DbInstance,
  entityType: string,
  userId: string,
  extraConditions?: ReturnType<typeof and>
): Promise<{ id: string }[]> {
  const conditions = [eq(photos.entityType, entityType), eq(photos.userId, userId)];
  if (extraConditions) conditions.push(extraConditions);

  return db
    .select({ id: photos.id })
    .from(photos)
    .where(and(...conditions));
}

/**
 * Count photoRefs for a provider in a given status ('active' | 'failed'), scoped to the
 * given entity types. The synced-vs-failed counts in /sync-status differ ONLY by the status
 * filter, so they share one helper (C92 dedup) rather than two byte-identical joined queries.
 */
async function countPhotoRefsByStatus(
  db: DbInstance,
  providerId: string,
  status: 'active' | 'pending' | 'failed',
  entityTypes: string[]
): Promise<number> {
  const result = await db
    .select({ count: sql<number>`count(*)` })
    .from(photoRefs)
    .innerJoin(photos, eq(photoRefs.photoId, photos.id))
    .where(
      and(
        eq(photoRefs.providerId, providerId),
        eq(photoRefs.status, status),
        sql`${photos.entityType} IN (${sql.join(
          entityTypes.map((t) => sql`${t}`),
          sql`, `
        )})`
      )
    );

  return result[0]?.count ?? 0;
}

/**
 * Shape a provider row for the API response. The credentials column is deliberately
 * OMITTED — secrets are never returned to the frontend (pinned by providers-routes-http.test.ts,
 * C91). Single source of truth for the GET-list / POST-create / PUT-update responses, which
 * previously hand-assembled this identical 8-field object three times (C92 dedup).
 */
function formatProviderResponse(row: UserProvider) {
  return {
    id: row.id,
    domain: row.domain,
    providerType: row.providerType,
    displayName: row.displayName,
    status: row.status,
    config: row.config ?? {},
    lastSyncAt: row.lastSyncAt?.toISOString() ?? null,
    createdAt: row.createdAt?.toISOString() ?? null,
  };
}

// Apply middleware to all routes
routes.use('*', requireAuth);
routes.use('*', changeTracker);

// GET /api/v1/providers/pending/:nonce — retrieve pending provider email after OAuth
routes.get('/pending/:nonce', async (c) => {
  const user = c.get('user');
  const nonce = c.req.param('nonce');

  const email = getPendingEmail(user.id, nonce);
  if (!email) {
    throw new NotFoundError('Pending provider credentials');
  }

  return c.json({ success: true, data: { email } });
});

// --- Zod schemas ---

/**
 * Supported provider types — validated at creation time to fail fast.
 * `fake` is accepted by the schema but additionally runtime-gated on
 * `CONFIG.allowFakeStorageProvider` in the POST handler, so it can only ever be
 * created in non-production with `ALLOW_FAKE_STORAGE=1` (the same double-gate the
 * registry uses to instantiate it). This is the seam that lets headless E2E seed
 * a storage provider — and exercise the backup/photo paths — without real OAuth.
 */
const SUPPORTED_PROVIDER_TYPES = ['google-drive', 's3', 'fake'] as const;

const createProviderSchema = z.object({
  domain: z.string().min(1, 'Domain is required'),
  providerType: z.enum(SUPPORTED_PROVIDER_TYPES, {
    message: `Provider type must be one of: ${SUPPORTED_PROVIDER_TYPES.join(', ')}`,
  }),
  displayName: z
    .string()
    .min(1, 'Display name is required')
    .max(100, 'Display name must be 100 characters or less'),
  credentials: z.record(z.string(), z.unknown()),
  config: z.record(z.string(), z.unknown()).optional(),
  nonce: z.string().uuid().optional(),
});

const updateProviderSchema = z.object({
  displayName: z.string().min(1).max(100).optional(),
  credentials: z.record(z.string(), z.unknown()).optional(),
  config: z.record(z.string(), z.unknown()).optional(),
});

// Default folder paths by provider type (for auto-populating storage_config)
const DEFAULT_FOLDER_PATHS: Record<
  string,
  Record<PhotoCategory, { enabled: boolean; folderPath: string }>
> = {
  'google-drive': {
    vehicle_photos: { enabled: true, folderPath: 'Vehicle' },
    expense_receipts: { enabled: true, folderPath: 'Receipts' },
    insurance_docs: { enabled: true, folderPath: 'Insurance' },
    odometer_readings: { enabled: true, folderPath: 'Odometer' },
  },
  s3: {
    vehicle_photos: { enabled: true, folderPath: 'vehicles' },
    expense_receipts: { enabled: true, folderPath: 'receipts' },
    insurance_docs: { enabled: true, folderPath: 'insurance' },
    odometer_readings: { enabled: true, folderPath: 'odometer' },
  },
};

// GET /api/v1/providers — list providers for authenticated user, optionally filtered by domain
routes.get('/', async (c) => {
  const user = c.get('user');
  const domain = c.req.query('domain');

  const db = getDb();

  const baseCondition = eq(userProviders.userId, user.id);
  const rows = await db
    .select()
    .from(userProviders)
    .where(domain ? and(baseCondition, eq(userProviders.domain, domain)) : baseCondition);

  // Strip credentials from response — never return secrets to the frontend
  const data = rows.map(formatProviderResponse);

  return c.json({ success: true, data });
});

/**
 * Resolve credentials and config for a new provider.
 * For google-drive: consumes pending OAuth credentials via nonce.
 * For other types: encrypts the provided credentials directly.
 */
function resolveProviderCredentials(
  userId: string,
  providerType: string,
  credentials: Record<string, unknown>,
  config: Record<string, unknown> | null,
  nonce?: string
): { encryptedCredentials: string; resolvedConfig: Record<string, unknown> | null } {
  if (providerType === 'google-drive') {
    if (!nonce) {
      throw new ValidationError('Missing nonce — please connect your Google account');
    }
    const pending = consumePending(userId, nonce);
    if (!pending) {
      throw new ValidationError('Please connect your Google account first');
    }
    return {
      encryptedCredentials: encrypt(JSON.stringify({ refreshToken: pending.refreshToken })),
      resolvedConfig: { ...(config ?? {}), accountEmail: pending.email },
    };
  }
  return {
    encryptedCredentials: encrypt(JSON.stringify(credentials)),
    resolvedConfig: config,
  };
}

// POST /api/v1/providers — create a new provider
routes.post('/', zValidator('json', createProviderSchema), async (c) => {
  const user = c.get('user');
  const body = c.req.valid('json');

  const db = getDb();

  // Domain guard: auth providers are managed through /auth routes only
  if (body.domain === 'auth') {
    throw new ValidationError('Auth providers cannot be created through this endpoint');
  }

  // Fake provider is a test-only seam — refuse it unless explicitly opted in
  // (ALLOW_FAKE_STORAGE=1 AND non-production). Same gate the registry uses to
  // instantiate it, enforced here so prod can never persist a fake row.
  if (body.providerType === 'fake' && !CONFIG.allowFakeStorageProvider) {
    throw new ValidationError('Fake storage provider is not enabled in this environment');
  }

  const { encryptedCredentials, resolvedConfig } = resolveProviderCredentials(
    user.id,
    body.providerType,
    body.credentials,
    body.config ?? null,
    body.nonce
  );

  // Use transaction to narrow TOCTOU window for duplicate check + insert
  const created = await db.transaction(async (tx) => {
    // Check for duplicate: same user + domain + providerType + accountEmail
    const existingProviders = await tx
      .select({ id: userProviders.id, config: userProviders.config })
      .from(userProviders)
      .where(
        and(
          eq(userProviders.userId, user.id),
          eq(userProviders.domain, body.domain),
          eq(userProviders.providerType, body.providerType)
        )
      );

    const newAccountEmail = (resolvedConfig as Record<string, unknown> | null)?.accountEmail as
      | string
      | undefined;

    if (newAccountEmail) {
      const duplicate = existingProviders.find((p) => {
        const cfg = p.config as Record<string, unknown> | null;
        return cfg?.accountEmail === newAccountEmail;
      });
      if (duplicate) {
        throw new ConflictError(
          `A ${body.providerType} provider with this account (${newAccountEmail}) already exists.`
        );
      }
    }

    const result = await tx
      .insert(userProviders)
      .values({
        userId: user.id,
        domain: body.domain,
        providerType: body.providerType,
        displayName: body.displayName,
        credentials: encryptedCredentials,
        config: resolvedConfig,
        status: 'active',
      })
      .returning();

    return result[0];
  });

  // If domain is 'storage', auto-populate storage_config.providerCategories
  if (body.domain === 'storage') {
    const prefs = await preferencesRepository.getOrCreate(user.id);

    const storageConfig: StorageConfig = prefs.storageConfig
      ? { ...prefs.storageConfig }
      : { ...DEFAULT_STORAGE_CONFIG };

    // Deep-clone providerCategories to avoid mutation
    storageConfig.providerCategories = { ...storageConfig.providerCategories };

    // Add default folder paths for the new provider
    const defaultPaths = DEFAULT_FOLDER_PATHS[body.providerType];
    if (defaultPaths) {
      storageConfig.providerCategories[created.id] = { ...defaultPaths };
    } else {
      // Fallback: enable all categories with generic paths
      storageConfig.providerCategories[created.id] = {
        vehicle_photos: { enabled: true, folderPath: 'vehicle-photos' },
        expense_receipts: { enabled: true, folderPath: 'receipts' },
        insurance_docs: { enabled: true, folderPath: 'insurance' },
        odometer_readings: { enabled: true, folderPath: 'odometer' },
      };
    }

    await preferencesRepository.update(user.id, { storageConfig });
  }

  return c.json({ success: true, data: formatProviderResponse(created) }, 201);
});

// PUT /api/v1/providers/:id — update provider
routes.put(
  '/:id',
  zValidator('param', commonSchemas.idParam),
  zValidator('json', updateProviderSchema),
  async (c) => {
    const user = c.get('user');
    const { id } = c.req.valid('param');
    const body = c.req.valid('json');

    const db = getDb();

    // Ownership check: verify provider belongs to user
    const existing = [await findOwnedProviderOrThrow(db, id, user.id)];

    // Domain guard: auth providers are managed through /auth routes only
    if (existing[0].domain === 'auth') {
      throw new ValidationError('Auth providers cannot be modified through this endpoint');
    }

    const updates: Record<string, unknown> = { updatedAt: new Date() };

    if (body.displayName !== undefined) {
      updates.displayName = body.displayName;
    }
    if (body.config !== undefined) {
      updates.config = body.config;
    }
    if (body.credentials !== undefined) {
      updates.credentials = encrypt(JSON.stringify(body.credentials));
    }

    // Scope the destructive write on BOTH id AND userId (#63 — the C109/#52 class). The
    // findOwnedProviderOrThrow guard above already proves ownership, so this is behavior-identical
    // today; ANDing userId here keeps the write itself tenant-scoped so a future guard-drop/reorder
    // can't turn it into a cross-tenant update (mirrors the C155 split + C168/C180 odometer fixes).
    const result = await db
      .update(userProviders)
      .set(updates)
      .where(and(eq(userProviders.id, id), eq(userProviders.userId, user.id)))
      .returning();

    const updated = result[0];

    return c.json({ success: true, data: formatProviderResponse(updated) });
  }
);

// Helper: clean up storage_config when a storage provider is deleted
async function cleanupStorageConfig(userId: string, providerId: string): Promise<void> {
  const prefs = await preferencesRepository.getOrCreate(userId);

  if (!prefs.storageConfig) return;

  const storageConfig: StorageConfig = { ...prefs.storageConfig };

  // Remove from providerCategories
  storageConfig.providerCategories = { ...storageConfig.providerCategories };
  delete storageConfig.providerCategories[providerId];

  // Null out any defaults pointing to this provider
  storageConfig.defaults = { ...storageConfig.defaults };
  const categories: PhotoCategory[] = [
    'vehicle_photos',
    'expense_receipts',
    'insurance_docs',
    'odometer_readings',
  ];
  for (const cat of categories) {
    if (storageConfig.defaults[cat] === providerId) {
      storageConfig.defaults[cat] = null;
    }
  }

  await preferencesRepository.update(userId, { storageConfig });
}

// Helper: clean up backup_config when a storage provider is deleted
async function cleanupBackupConfig(userId: string, providerId: string): Promise<void> {
  const prefs = await preferencesRepository.getOrCreate(userId);
  if (!prefs.backupConfig?.providers?.[providerId]) return;
  const updated = { ...prefs.backupConfig };
  updated.providers = { ...updated.providers };
  delete updated.providers[providerId];
  await preferencesRepository.update(userId, { backupConfig: updated });
}

// DELETE /api/v1/providers/:id — delete provider with cleanup
routes.delete('/:id', zValidator('param', commonSchemas.idParam), async (c) => {
  const user = c.get('user');
  const { id } = c.req.valid('param');

  const db = getDb();

  // Ownership check
  const existing = [await findOwnedProviderOrThrow(db, id, user.id)];

  // Domain guard: auth providers are managed through /auth routes only
  if (existing[0].domain === 'auth') {
    throw new ValidationError('Auth providers cannot be modified through this endpoint');
  }

  // If domain is 'storage', clean up storage_config references and photo_refs
  if (existing[0].domain === 'storage') {
    await cleanupStorageConfig(user.id, id);
    await cleanupBackupConfig(user.id, id);

    // Best-effort delete photo_refs for this provider
    try {
      await photoRefRepository.deleteByProvider(id);
    } catch (err) {
      logger.warn('Failed to delete photo refs during provider cleanup', {
        providerId: id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // Delete the provider row — scoped on BOTH id AND userId (#63, the C109/#52 class). Ownership is
  // already proven by findOwnedProviderOrThrow above, so this is behavior-identical today; the
  // tenant-scoped predicate keeps the destructive write safe under a future guard-drop/reorder.
  await db
    .delete(userProviders)
    .where(and(eq(userProviders.id, id), eq(userProviders.userId, user.id)));

  return c.body(null, 204);
});

// POST /api/v1/providers/:id/test — test provider connection
routes.post('/:id/test', zValidator('param', commonSchemas.idParam), async (c) => {
  const user = c.get('user');
  const { id } = c.req.valid('param');

  const db = getDb();

  // Ownership check
  const existing = [await findOwnedProviderOrThrow(db, id, user.id)];

  const providerInstance = storageProviderRegistry.createProviderInstance(existing[0]);
  const healthy = await providerInstance.healthCheck();

  return c.json({ success: true, data: { healthy } });
});

// POST /api/v1/providers/:id/backfill — create pending refs for photos missing on this provider
routes.post('/:id/backfill', zValidator('param', commonSchemas.idParam), async (c) => {
  const user = c.get('user');
  const { id } = c.req.valid('param');

  const db = getDb();

  // Ownership check (the throw is the guard; this handler doesn't use the row)
  await findOwnedProviderOrThrow(db, id, user.id);

  // Load storage config to find enabled categories for this provider
  const prefs = await preferencesRepository.getOrCreate(user.id);
  const storageConfig = prefs.storageConfig as StorageConfig | null;
  const providerCategories = storageConfig?.providerCategories?.[id];
  if (!providerCategories) {
    return c.json({ success: true, data: { created: 0 } });
  }

  let created = 0;
  await db.transaction(async (tx) => {
    for (const [category, setting] of Object.entries(providerCategories)) {
      if (!setting?.enabled) continue;
      const entityTypes = CATEGORY_TO_ENTITY_TYPES[category];
      if (!entityTypes) continue;

      for (const entityType of entityTypes) {
        // Find photos of this entity type owned by this user that don't have a ref on this provider
        const notExistsClause = notExists(
          tx
            .select({ one: sql`1` })
            .from(photoRefs)
            .where(and(eq(photoRefs.photoId, photos.id), eq(photoRefs.providerId, id)))
        );

        const missingPhotos = await findUserPhotoIds(tx, entityType, user.id, notExistsClause);

        for (const photo of missingPhotos) {
          await tx.insert(photoRefs).values({
            photoId: photo.id,
            providerId: id,
            storageRef: '',
            status: 'pending',
          });
          created++;
        }
      }
    }
  });

  return c.json({ success: true, data: { created } });
});

// GET /api/v1/providers/:id/sync-status — sync progress per category
routes.get('/:id/sync-status', zValidator('param', commonSchemas.idParam), async (c) => {
  const user = c.get('user');
  const { id } = c.req.valid('param');

  const db = getDb();

  // Ownership check (the throw is the guard; this handler doesn't use the row)
  await findOwnedProviderOrThrow(db, id, user.id);

  const result: Record<string, { total: number; synced: number; failed: number }> = {};

  for (const [category, entityTypes] of Object.entries(CATEGORY_TO_ENTITY_TYPES)) {
    // Count total photos for this category, scoped to the authenticated user
    let total = 0;
    for (const entityType of entityTypes) {
      total += await countUserPhotos(db, entityType, user.id);
    }

    result[category] = {
      total,
      synced: await countPhotoRefsByStatus(db, id, 'active', entityTypes),
      failed: await countPhotoRefsByStatus(db, id, 'failed', entityTypes),
    };
  }

  return c.json({ success: true, data: result });
});

export { routes };
