import { and, eq, inArray, notExists, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import { CONFIG } from '../../config';
import { getDb } from '../../db/connection';
import { photoRefs, photos, type UserProvider, userProviders } from '../../db/schema';
import { AppError, ConflictError, NotFoundError, ValidationError } from '../../errors';
import { changeTracker, requireAuth } from '../../middleware';
import type { CategorySetting, PhotoCategory, StorageConfig } from '../../types';
import { DEFAULT_STORAGE_CONFIG, PHOTO_CATEGORIES } from '../../types';
import { encrypt } from '../../utils/encryption';
import { logger } from '../../utils/logger';
import { assertSafeOutboundUrl } from '../../utils/outbound-url';
import { consumePending, getPendingEmail } from '../../utils/pending-credentials';
import { commonSchemas, zValidator } from '../../utils/validation';
import { photoRefRepository } from '../photos/photo-ref-repository';
import { preferencesRepository } from '../settings/repository';
import {
  STORAGE_PROVIDER_TYPES,
  type StorageProviderDescriptor,
  storageCatalog,
  storageProviderDescriptor,
  storageProviderRegistry,
  validateStorageConfig,
} from './domains/storage/registry';
import { CATEGORY_TO_ENTITY_TYPES, ENTITY_TO_CATEGORY } from './domains/storage/storage-provider';

function isPhotoCategory(value: string): value is PhotoCategory {
  return (PHOTO_CATEGORIES as readonly string[]).includes(value);
}

const routes = new Hono();

type DbInstance =
  | ReturnType<typeof getDb>
  | Parameters<Parameters<ReturnType<typeof getDb>['transaction']>[0]>[0];

// Another user's provider must look missing, so ids cannot be probed.
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

export const MODEL_PROVIDER_TYPES = ['openai-compatible', 'anthropic', 'gemini', 'ollama'] as const;
type ModelProviderType = (typeof MODEL_PROVIDER_TYPES)[number];
const MODEL_DOMAINS = ['vlm', 'llm'] as const;
type ModelDomain = (typeof MODEL_DOMAINS)[number];
export const SUPPORTED_PROVIDER_TYPES = [
  ...STORAGE_PROVIDER_TYPES,
  ...MODEL_PROVIDER_TYPES,
] as const;

function creatableProviderTypes(): string[] {
  return SUPPORTED_PROVIDER_TYPES.filter(
    (type) => storageProviderDescriptor(type)?.availability() !== 'hidden'
  );
}

function isModelProviderType(providerType: string): providerType is ModelProviderType {
  return (MODEL_PROVIDER_TYPES as readonly string[]).includes(providerType);
}
function isModelDomain(domain: string): domain is ModelDomain {
  return (MODEL_DOMAINS as readonly string[]).includes(domain);
}
function modelDomainLabel(domain: string): string {
  return domain === 'llm' ? 'LLM' : 'VLM';
}

const PROVIDER_DOMAINS = ['storage', 'auth', ...MODEL_DOMAINS] as const;

const createProviderSchema = z.object({
  domain: z.enum(PROVIDER_DOMAINS, {
    message: `Domain must be one of: ${PROVIDER_DOMAINS.join(', ')}`,
  }),
  providerType: z.enum(SUPPORTED_PROVIDER_TYPES, {
    error: () => `Provider type must be one of: ${creatableProviderTypes().join(', ')}`,
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

function defaultCategorySettings(
  descriptor: StorageProviderDescriptor
): Record<PhotoCategory, CategorySetting> {
  const paths = descriptor.features.defaultFolders;
  return Object.fromEntries(
    PHOTO_CATEGORIES.map((cat) => [cat, { enabled: true, folderPath: paths[cat] }])
  ) as Record<PhotoCategory, CategorySetting>;
}

routes.get('/catalog', (c) => c.json({ success: true, data: storageCatalog() }));

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

function validateStorageProviderConfig(
  providerType: string,
  config: Record<string, unknown> | null
): void {
  const descriptor = storageProviderDescriptor(providerType);
  if (descriptor) validateStorageConfig(descriptor, config);
}

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
  if (typeof cfg.baseUrl === 'string') assertSafeOutboundUrl(cfg.baseUrl, `${label} base URL`);
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
  if (storageProviderDescriptor(providerType)?.connect === 'oauth') {
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

  if (storageProviderDescriptor(body.providerType)?.availability() === 'hidden') {
    throw new ValidationError(
      `Provider type must be one of: ${creatableProviderTypes().join(', ')}`
    );
  }

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

  // bun:sqlite transactions must be synchronous.
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

    const descriptor = storageProviderDescriptor(body.providerType);
    if (descriptor) {
      storageConfig.providerCategories[created.id] = defaultCategorySettings(descriptor);
    }

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
      if (isModelProviderType(existingType)) {
        validateModelConfigShape(existing.domain, existingType, body.config);
      } else {
        validateStorageProviderConfig(existingType, body.config);
      }
      // Server-written keys (accountEmail, albumId) are not sent by forms; a wholesale replace would drop them.
      updates.config = { ...(existing.config ?? {}), ...body.config };
    }
    if (body.credentials !== undefined) {
      if (isModelProviderType(existingType)) {
        validateModelCredentials(existing.domain, existingType, body.credentials);
      }
      updates.credentials = encrypt(JSON.stringify(body.credentials));
    }

    // Scope by userId too so the write stays tenant-safe if the ownership check moves.
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

// JSON merge patch, not read-modify-write, so concurrent writes to sibling providers are not clobbered.
async function cleanupBackupConfig(userId: string, providerId: string): Promise<void> {
  const prefs = await preferencesRepository.getOrCreate(userId);
  if (!prefs.backupConfig?.providers?.[providerId]) return;
  await preferencesRepository.mergeJsonField(userId, 'backupConfig', {
    providers: { [providerId]: null },
  });
}

async function assertNoPhotosOnlyHere(providerId: string, force: boolean): Promise<void> {
  if (force) return;
  const photosOnlyHere = await photoRefRepository.countPhotosOnlyOnProvider(providerId);
  if (photosOnlyHere === 0) return;
  const one = photosOnlyHere === 1;
  throw new AppError(
    `${photosOnlyHere} ${one ? 'photo is' : 'photos are'} stored only in this provider. Deleting it means ${one ? 'that photo' : 'those photos'} can no longer be shown.`,
    409,
    true,
    { photosOnlyHere }
  );
}

const deleteProviderQuerySchema = z.object({
  force: z.enum(['true', 'false']).optional(),
});

routes.delete(
  '/:id',
  zValidator('param', commonSchemas.idParam),
  zValidator('query', deleteProviderQuerySchema),
  async (c) => {
    const user = c.get('user');
    const { id } = c.req.valid('param');
    const force = c.req.valid('query').force === 'true';

    const db = getDb();

    const existing = await findOwnedProviderOrThrow(db, id, user.id);

    if (existing.domain === 'auth') {
      throw new ValidationError('Auth providers cannot be modified through this endpoint');
    }

    if (existing.domain === 'storage') {
      await assertNoPhotosOnlyHere(id, force);
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
  }
);

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
  await photoRefRepository.resetFailedForProvider(id);

  const prefs = await preferencesRepository.getOrCreate(user.id);
  const storageConfig = prefs.storageConfig as StorageConfig | null;
  const providerCategories = storageConfig?.providerCategories?.[id];
  if (!providerCategories) {
    return c.json({ success: true, data: { created: 0 } });
  }

  let created = 0;
  // bun:sqlite transactions must be synchronous.
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

  const result = Object.fromEntries(
    PHOTO_CATEGORIES.map((category) => [category, { total: 0, synced: 0, failed: 0 }])
  ) as Record<PhotoCategory, { total: number; synced: number; failed: number }>;

  const photoTotals = await db
    .select({ entityType: photos.entityType, count: sql<number>`count(*)` })
    .from(photos)
    .where(eq(photos.userId, user.id))
    .groupBy(photos.entityType);
  for (const row of photoTotals) {
    const category = ENTITY_TO_CATEGORY[row.entityType];
    if (category) result[category].total += row.count;
  }

  const refCounts = await db
    .select({
      entityType: photos.entityType,
      status: photoRefs.status,
      count: sql<number>`count(*)`,
    })
    .from(photoRefs)
    .innerJoin(photos, eq(photoRefs.photoId, photos.id))
    .where(and(eq(photoRefs.providerId, id), inArray(photoRefs.status, ['active', 'failed'])))
    .groupBy(photos.entityType, photoRefs.status);
  for (const row of refCounts) {
    const category = ENTITY_TO_CATEGORY[row.entityType];
    if (!category) continue;
    if (row.status === 'active') result[category].synced += row.count;
    else result[category].failed += row.count;
  }

  return c.json({ success: true, data: result });
});

export { routes };
