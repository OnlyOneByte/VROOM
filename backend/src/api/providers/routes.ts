import { and, eq, notExists, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import { CONFIG } from '../../config';
import { getDb } from '../../db/connection';
import { photoRefs, photos, type UserProvider, userProviders } from '../../db/schema';
import { ConflictError, NotFoundError, ValidationError } from '../../errors';
import { changeTracker, requireAuth } from '../../middleware';
import type { CategorySetting, PhotoCategory, StorageConfig } from '../../types';
import { DEFAULT_STORAGE_CONFIG, PHOTO_CATEGORIES } from '../../types';
import { encrypt } from '../../utils/encryption';
import { logger } from '../../utils/logger';
import { consumePending, getPendingEmail } from '../../utils/pending-credentials';
import { commonSchemas, zValidator } from '../../utils/validation';
import { photoRefRepository } from '../photos/photo-ref-repository';
import { preferencesRepository } from '../settings/repository';
import { storageProviderRegistry } from './domains/storage/registry';
import { CATEGORY_TO_ENTITY_TYPES } from './domains/storage/storage-provider';

function isPhotoCategory(value: string): value is PhotoCategory {
  return (PHOTO_CATEGORIES as readonly string[]).includes(value);
}

const routes = new Hono();

type DbInstance =
  | ReturnType<typeof getDb>
  | Parameters<Parameters<ReturnType<typeof getDb>['transaction']>[0]>[0];

/** A provider owned by another user is indistinguishable from a missing one, so no cross-tenant probing. */
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

/** Credentials are omitted: secrets are never returned to the frontend. */
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

routes.use('*', requireAuth);
routes.use('*', changeTracker);

routes.get('/pending/:nonce', async (c) => {
  const user = c.get('user');
  const nonce = c.req.param('nonce');

  const email = getPendingEmail(user.id, nonce);
  if (!email) {
    throw new NotFoundError('Pending provider credentials');
  }

  return c.json({ success: true, data: { email } });
});

// Model provider types are shared by the `vlm` and `llm` domains; the same type string is valid in either.
const MODEL_PROVIDER_TYPES = ['openai-compatible', 'anthropic', 'gemini', 'ollama'] as const;
type ModelProviderType = (typeof MODEL_PROVIDER_TYPES)[number];
const MODEL_DOMAINS = ['vlm', 'llm'] as const;
type ModelDomain = (typeof MODEL_DOMAINS)[number];
const SUPPORTED_PROVIDER_TYPES = ['google-drive', 's3', 'fake', ...MODEL_PROVIDER_TYPES] as const;

function isModelProviderType(providerType: string): providerType is ModelProviderType {
  return (MODEL_PROVIDER_TYPES as readonly string[]).includes(providerType);
}
function isModelDomain(domain: string): domain is ModelDomain {
  return (MODEL_DOMAINS as readonly string[]).includes(domain);
}
function modelDomainLabel(domain: string): string {
  return domain === 'llm' ? 'LLM' : 'VLM';
}

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

const DEFAULT_FOLDER_PATHS: Record<string, Record<PhotoCategory, string>> = {
  'google-drive': {
    vehicle_photos: 'Vehicle',
    expense_receipts: 'Receipts',
    insurance_docs: 'Insurance',
    odometer_readings: 'Odometer',
  },
  s3: {
    vehicle_photos: 'vehicles',
    expense_receipts: 'receipts',
    insurance_docs: 'insurance',
    odometer_readings: 'odometer',
  },
};
const FALLBACK_FOLDER_PATHS: Record<PhotoCategory, string> = {
  vehicle_photos: 'vehicle-photos',
  expense_receipts: 'receipts',
  insurance_docs: 'insurance',
  odometer_readings: 'odometer',
};

function defaultCategorySettings(providerType: string): Record<PhotoCategory, CategorySetting> {
  const paths = DEFAULT_FOLDER_PATHS[providerType] ?? FALLBACK_FOLDER_PATHS;
  return Object.fromEntries(
    PHOTO_CATEGORIES.map((cat) => [cat, { enabled: true, folderPath: paths[cat] }])
  ) as Record<PhotoCategory, CategorySetting>;
}

routes.get('/', async (c) => {
  const user = c.get('user');
  const domain = c.req.query('domain');

  const db = getDb();

  const baseCondition = eq(userProviders.userId, user.id);
  const rows = await db
    .select()
    .from(userProviders)
    .where(domain ? and(baseCondition, eq(userProviders.domain, domain)) : baseCondition);

  const data = rows.map(formatProviderResponse);

  return c.json({ success: true, data });
});

/** Shared by CREATE and PUT so an edit cannot persist a config the provider can never run with. */
function validateStorageProviderConfig(
  providerType: string,
  config: Record<string, unknown> | null
): void {
  if (providerType === 's3') {
    const c = config ?? {};
    if (!c.endpoint || !c.bucket || !c.region) {
      throw new ValidationError('S3 config must include endpoint, bucket, and region');
    }
  }
}

/**
 * Config-shape and credentials checks are split so a config-only PUT does not demand the api key
 * again; the key is already stored encrypted.
 */
function validateModelConfigShape(
  domain: string,
  providerType: ModelProviderType,
  config: Record<string, unknown> | null
): void {
  const label = modelDomainLabel(domain);
  const cfg = config ?? {};
  if (!cfg.model || typeof cfg.model !== 'string') {
    throw new ValidationError(`${label} config must include a model name`);
  }
  if (
    (providerType === 'ollama' || providerType === 'openai-compatible') &&
    (!cfg.baseUrl || typeof cfg.baseUrl !== 'string')
  ) {
    throw new ValidationError(`Self-hosted or OpenAI-compatible ${label} requires a base URL`);
  }
}

function validateModelCredentials(
  domain: string,
  providerType: ModelProviderType,
  credentials: Record<string, unknown>
): void {
  if (providerType !== 'ollama' && !credentials.apiKey) {
    throw new ValidationError(`${modelDomainLabel(domain)} provider requires an API key`);
  }
}

function resolveProviderCredentials(
  userId: string,
  domain: string,
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
  if (isModelProviderType(providerType)) {
    validateModelConfigShape(domain, providerType, config);
    validateModelCredentials(domain, providerType, credentials);
    return {
      encryptedCredentials: encrypt(JSON.stringify(credentials)),
      resolvedConfig: config,
    };
  }
  validateStorageProviderConfig(providerType, config);
  return {
    encryptedCredentials: encrypt(JSON.stringify(credentials)),
    resolvedConfig: config,
  };
}

routes.post('/', zValidator('json', createProviderSchema), async (c) => {
  const user = c.get('user');
  const body = c.req.valid('json');

  const db = getDb();

  if (body.domain === 'auth') {
    throw new ValidationError('Auth providers cannot be created through this endpoint');
  }

  if (body.providerType === 'fake' && !CONFIG.allowFakeStorageProvider) {
    throw new ValidationError('Fake storage provider is not enabled in this environment');
  }

  // Model types and model domains must match in both directions, or the domain-keyed registries misroute the row.
  if (isModelProviderType(body.providerType) !== isModelDomain(body.domain)) {
    throw new ValidationError(
      'A model provider type requires domain "vlm" or "llm", and vice-versa'
    );
  }

  const { encryptedCredentials, resolvedConfig } = resolveProviderCredentials(
    user.id,
    body.domain,
    body.providerType,
    body.credentials,
    body.config ?? null,
    body.nonce
  );

  // Synchronous on purpose: bun-sqlite cannot hold a transaction across awaits, so the duplicate
  // check and the insert must run without yielding or a racing request can insert the same account twice.
  const created = db.transaction((tx) => {
    const existingProviders = tx
      .select({ id: userProviders.id, config: userProviders.config })
      .from(userProviders)
      .where(
        and(
          eq(userProviders.userId, user.id),
          eq(userProviders.domain, body.domain),
          eq(userProviders.providerType, body.providerType)
        )
      )
      .all();

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

    return tx
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
      .returning()
      .get();
  });

  if (body.domain === 'storage') {
    const prefs = await preferencesRepository.getOrCreate(user.id);

    const storageConfig: StorageConfig = prefs.storageConfig
      ? { ...prefs.storageConfig }
      : { ...DEFAULT_STORAGE_CONFIG };

    storageConfig.providerCategories = { ...storageConfig.providerCategories };

    storageConfig.providerCategories[created.id] = defaultCategorySettings(body.providerType);

    await preferencesRepository.update(user.id, { storageConfig });
  }

  return c.json({ success: true, data: formatProviderResponse(created) }, 201);
});

routes.put(
  '/:id',
  zValidator('param', commonSchemas.idParam),
  zValidator('json', updateProviderSchema),
  async (c) => {
    const user = c.get('user');
    const { id } = c.req.valid('param');
    const body = c.req.valid('json');

    const db = getDb();

    const existing = await findOwnedProviderOrThrow(db, id, user.id);

    if (existing.domain === 'auth') {
      throw new ValidationError('Auth providers cannot be modified through this endpoint');
    }

    const updates: Record<string, unknown> = { updatedAt: new Date() };

    if (body.displayName !== undefined) {
      updates.displayName = body.displayName;
    }
    const existingType = existing.providerType;
    if (body.config !== undefined) {
      // Validates the payload, not the merged result, so required fields are edited as a unit.
      if (isModelProviderType(existingType)) {
        validateModelConfigShape(existing.domain, existingType, body.config);
      } else {
        validateStorageProviderConfig(existingType, body.config);
      }
      // Partial merge: server-written keys such as accountEmail and albumId are not echoed by forms,
      // so a wholesale replace would drop them. PUT cannot delete a config key as a result.
      updates.config = { ...(existing.config ?? {}), ...body.config };
    }
    if (body.credentials !== undefined) {
      if (isModelProviderType(existingType)) {
        validateModelCredentials(existing.domain, existingType, body.credentials);
      }
      updates.credentials = encrypt(JSON.stringify(body.credentials));
    }

    // Tenant-scoped on id AND userId so the write stays safe if the ownership check above is reordered.
    const result = await db
      .update(userProviders)
      .set(updates)
      .where(and(eq(userProviders.id, id), eq(userProviders.userId, user.id)))
      .returning();

    const updated = result[0];

    return c.json({ success: true, data: formatProviderResponse(updated) });
  }
);

async function cleanupStorageConfig(userId: string, providerId: string): Promise<void> {
  const prefs = await preferencesRepository.getOrCreate(userId);

  if (!prefs.storageConfig) return;

  const storageConfig: StorageConfig = { ...prefs.storageConfig };

  storageConfig.providerCategories = { ...storageConfig.providerCategories };
  delete storageConfig.providerCategories[providerId];

  storageConfig.defaults = { ...storageConfig.defaults };
  for (const cat of PHOTO_CATEGORIES) {
    if (storageConfig.defaults[cat] === providerId) {
      storageConfig.defaults[cat] = null;
    }
  }

  await preferencesRepository.update(userId, { storageConfig });
}

// Single-key JSON merge patch (null deletes the key) so a concurrent settings write to sibling providers is not clobbered.
async function cleanupBackupConfig(userId: string, providerId: string): Promise<void> {
  const prefs = await preferencesRepository.getOrCreate(userId);
  if (!prefs.backupConfig?.providers?.[providerId]) return;
  await preferencesRepository.mergeJsonField(userId, 'backupConfig', {
    providers: { [providerId]: null },
  });
}

routes.delete('/:id', zValidator('param', commonSchemas.idParam), async (c) => {
  const user = c.get('user');
  const { id } = c.req.valid('param');

  const db = getDb();

  const existing = await findOwnedProviderOrThrow(db, id, user.id);

  if (existing.domain === 'auth') {
    throw new ValidationError('Auth providers cannot be modified through this endpoint');
  }

  if (existing.domain === 'storage') {
    await cleanupStorageConfig(user.id, id);
    await cleanupBackupConfig(user.id, id);

    try {
      await photoRefRepository.deleteByProvider(id);
    } catch (err) {
      logger.warn('Failed to delete photo refs during provider cleanup', {
        providerId: id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  await db
    .delete(userProviders)
    .where(and(eq(userProviders.id, id), eq(userProviders.userId, user.id)));

  return c.body(null, 204);
});

routes.post('/:id/test', zValidator('param', commonSchemas.idParam), async (c) => {
  const user = c.get('user');
  const { id } = c.req.valid('param');

  const db = getDb();

  const existing = await findOwnedProviderOrThrow(db, id, user.id);

  const providerInstance = storageProviderRegistry.createProviderInstance(existing);
  const healthy = await providerInstance.healthCheck();

  return c.json({ success: true, data: { healthy } });
});

routes.post('/:id/backfill', zValidator('param', commonSchemas.idParam), async (c) => {
  const user = c.get('user');
  const { id } = c.req.valid('param');

  const db = getDb();

  await findOwnedProviderOrThrow(db, id, user.id);

  const prefs = await preferencesRepository.getOrCreate(user.id);
  const storageConfig = prefs.storageConfig as StorageConfig | null;
  const providerCategories = storageConfig?.providerCategories?.[id];
  if (!providerCategories) {
    return c.json({ success: true, data: { created: 0 } });
  }

  let created = 0;
  // Synchronous so bun-sqlite keeps the whole backfill in one transaction that rolls back on error.
  db.transaction((tx) => {
    for (const [category, setting] of Object.entries(providerCategories)) {
      if (!setting?.enabled || !isPhotoCategory(category)) continue;
      const entityTypes = CATEGORY_TO_ENTITY_TYPES[category];

      for (const entityType of entityTypes) {
        const notExistsClause = notExists(
          tx
            .select({ one: sql`1` })
            .from(photoRefs)
            .where(and(eq(photoRefs.photoId, photos.id), eq(photoRefs.providerId, id)))
        );

        const missingPhotos = tx
          .select({ id: photos.id })
          .from(photos)
          .where(
            and(eq(photos.entityType, entityType), eq(photos.userId, user.id), notExistsClause)
          )
          .all();

        for (const photo of missingPhotos) {
          tx.insert(photoRefs)
            .values({
              photoId: photo.id,
              providerId: id,
              storageRef: '',
              status: 'pending',
            })
            .run();
          created++;
        }
      }
    }
  });

  return c.json({ success: true, data: { created } });
});

routes.get('/:id/sync-status', zValidator('param', commonSchemas.idParam), async (c) => {
  const user = c.get('user');
  const { id } = c.req.valid('param');

  const db = getDb();

  await findOwnedProviderOrThrow(db, id, user.id);

  const result: Record<string, { total: number; synced: number; failed: number }> = {};

  for (const category of PHOTO_CATEGORIES) {
    const entityTypes = CATEGORY_TO_ENTITY_TYPES[category];
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
