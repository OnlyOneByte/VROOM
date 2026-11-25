import { createId } from '@paralleldrive/cuid2';
import { and, eq, inArray, notExists, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import { repos } from '../../app-context';
import { CONFIG } from '../../config';
import { getDb } from '../../db/connection';
import { countNum } from '../../db/dialect';
import { photoRefs, photos, type UserProvider, userProviders } from '../../db/schema';
import { AppError, ConflictError, NotFoundError, ValidationError } from '../../errors';
import { changeTracker, rateLimiter, requireAuth } from '../../middleware';
import { authorize, ownAccount } from '../../permissions/authorize';
import type { CategorySetting, PhotoCategory, StorageConfig } from '../../types';
import { DEFAULT_STORAGE_CONFIG, PHOTO_CATEGORIES } from '../../types';
import { decrypt, encrypt, secretContextOf } from '../../utils/encryption';
import { logger } from '../../utils/logger';
import { assertSafeOutboundUrl, privateEndpointPolicyFor } from '../../utils/outbound-url';
import { consumePending, getPendingEmail } from '../../utils/pending-credentials';
import { commonSchemas, zValidator } from '../../utils/validation';
import { AUTH_PROVIDERS } from '../auth/providers/registry';
import { IMPORT_PROVIDERS } from '../expenses/import-mapping-presets';
import {
  type AnyProviderDescriptor,
  assertSecretsReentered,
  toCatalogEntries,
  validateProviderConfig,
  validateProviderSecrets,
  withoutServerState,
} from './descriptor';
import { LLM_PROVIDERS } from './domains/llm/registry';
import {
  STORAGE_PROVIDERS,
  type StorageProviderDescriptor,
  storageCatalog,
  storageProviderDescriptor,
} from './domains/storage/registry';
import { CATEGORY_TO_ENTITY_TYPES, ENTITY_TO_CATEGORY } from './domains/storage/storage-provider';
import { BUILTIN_VISION_PROVIDERS, VISION_PROVIDERS } from './domains/vlm/registry';
import {
  checkProviderHealth,
  type HealthResult,
  healthCodeOf,
  healthFailure,
  recordProviderHealth,
} from './provider-status';

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

function secretsSet(row: UserProvider): string[] {
  const descriptor = providerDescriptor(row.domain, row.providerType);
  if (!descriptor || descriptor.secrets.length === 0) return [];
  try {
    const stored = JSON.parse(decrypt(row.credentials, secretContextOf(row))) as Record<
      string,
      unknown
    >;
    return descriptor.secrets.map((secret) => secret.key).filter((key) => Boolean(stored[key]));
  } catch {
    return [];
  }
}

function formatProviderResponse(row: UserProvider) {
  return {
    id: row.id,
    domain: row.domain,
    providerType: row.providerType,
    displayName: row.displayName,
    status: row.status,
    config: row.config ?? {},
    secretsSet: secretsSet(row),
    lastSyncAt: row.lastSyncAt?.toISOString() ?? null,
    lastErrorCode: row.lastErrorCode ?? null,
    lastCheckedAt: row.lastCheckedAt?.toISOString() ?? null,
    createdAt: row.createdAt?.toISOString() ?? null,
  };
}

routes.use('*', requireAuth);
routes.use('*', changeTracker);

routes.get('/pending/:nonce', authorize(ownAccount), async (c) => {
  const user = c.get('user');
  const nonce = c.req.param('nonce');

  const email = getPendingEmail(user.id, nonce);
  if (!email) {
    throw new NotFoundError('Pending provider credentials');
  }

  return c.json({ success: true, data: { email } });
});

const PROVIDERS_BY_DOMAIN: Record<string, Record<string, AnyProviderDescriptor>> = {
  storage: STORAGE_PROVIDERS,
  llm: LLM_PROVIDERS,
  vlm: VISION_PROVIDERS,
};
const DOMAIN_LABELS: Record<string, string> = { storage: 'Storage', llm: 'LLM', vlm: 'VLM' };
const PROVIDER_DOMAINS = ['storage', 'auth', 'llm', 'vlm'] as const;

function providerDescriptor(
  domain: string,
  providerType: string
): AnyProviderDescriptor | undefined {
  const table = Object.hasOwn(PROVIDERS_BY_DOMAIN, domain)
    ? PROVIDERS_BY_DOMAIN[domain]
    : undefined;
  return table && Object.hasOwn(table, providerType) ? table[providerType] : undefined;
}

function creatableProviderTypes(domain: string): string[] {
  return Object.entries(PROVIDERS_BY_DOMAIN[domain] ?? {})
    .filter(([, descriptor]) => descriptor.availability() !== 'hidden')
    .map(([id]) => id);
}

const createProviderSchema = z.object({
  domain: z.enum(PROVIDER_DOMAINS, {
    message: `Domain must be one of: ${PROVIDER_DOMAINS.join(', ')}`,
  }),
  providerType: z.string().min(1, 'Provider type is required'),
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

routes.get('/catalog', authorize(ownAccount), (c) =>
  c.json({
    success: true,
    data: [
      ...storageCatalog(),
      ...toCatalogEntries(LLM_PROVIDERS),
      ...toCatalogEntries(VISION_PROVIDERS),
      ...toCatalogEntries(BUILTIN_VISION_PROVIDERS),
      ...toCatalogEntries(AUTH_PROVIDERS),
      ...toCatalogEntries(IMPORT_PROVIDERS),
    ],
  })
);

routes.get('/', authorize(ownAccount), async (c) => {
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

function resolveProviderCredentials(
  rowId: string,
  userId: string,
  domain: string,
  descriptor: AnyProviderDescriptor,
  providerType: string,
  credentials: Record<string, unknown>,
  config: Record<string, unknown> | null,
  nonce?: string
): { encryptedCredentials: string; resolvedConfig: Record<string, unknown> | null } {
  validateProviderConfig(descriptor, config);
  if (descriptor.connect === 'oauth') {
    if (!nonce) {
      throw new ValidationError('Missing nonce — please connect your Google account');
    }
    const pending = consumePending(userId, nonce);
    if (!pending) {
      throw new ValidationError('Please connect your Google account first');
    }
    if (pending.providerType !== providerType) {
      throw new ValidationError(
        `That Google connection was made for another provider. Connect Google again for ${descriptor.label}.`
      );
    }
    return {
      encryptedCredentials: encrypt(JSON.stringify({ refreshToken: pending.refreshToken }), {
        rowId,
        userId,
        domain,
      }),
      resolvedConfig: { ...(config ?? {}), accountEmail: pending.email },
    };
  }
  validateProviderSecrets(descriptor, DOMAIN_LABELS[domain] ?? domain, credentials);
  return {
    encryptedCredentials: encrypt(JSON.stringify(credentials), { rowId, userId, domain }),
    resolvedConfig: config,
  };
}

const TARGET_FIELD_LABELS: Record<string, [field: string, label: string]> = {
  storage: ['endpoint', 'S3 endpoint'],
  llm: ['baseUrl', 'LLM base URL'],
  vlm: ['baseUrl', 'VLM base URL'],
};

function assertOwnerMayReach(
  ownerId: string,
  domain: string,
  config: Record<string, unknown> | null | undefined
): void {
  const entry = TARGET_FIELD_LABELS[domain];
  const target = entry ? config?.[entry[0]] : undefined;
  if (entry && typeof target === 'string') {
    assertSafeOutboundUrl(target, entry[1], privateEndpointPolicyFor(ownerId));
  }
}

routes.post('/', zValidator('json', createProviderSchema), authorize(ownAccount), async (c) => {
  const user = c.get('user');
  const body = c.req.valid('json');

  const db = getDb();

  if (body.domain === 'auth') {
    throw new ValidationError('Auth providers cannot be created through this endpoint');
  }

  if (body.providerType === 'fake' && !CONFIG.allowFakeStorageProvider) {
    throw new ValidationError('Fake storage provider is not enabled in this environment');
  }

  const descriptor = providerDescriptor(body.domain, body.providerType);
  if (!descriptor || descriptor.availability() === 'hidden') {
    throw new ValidationError(
      `Provider type must be one of: ${creatableProviderTypes(body.domain).join(', ')}`
    );
  }

  const rowId = createId();
  const { encryptedCredentials, resolvedConfig } = resolveProviderCredentials(
    rowId,
    user.id,
    body.domain,
    descriptor,
    body.providerType,
    body.credentials,
    body.config ? withoutServerState(descriptor, body.config) : null,
    body.nonce
  );
  assertOwnerMayReach(user.id, body.domain, resolvedConfig);

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
        id: rowId,
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
    const prefs = await repos().preferences.getOrCreate(user.id);

    const storageConfig: StorageConfig = prefs.storageConfig
      ? { ...prefs.storageConfig }
      : { ...DEFAULT_STORAGE_CONFIG };

    storageConfig.providerCategories = { ...storageConfig.providerCategories };

    const descriptor = storageProviderDescriptor(body.providerType);
    if (descriptor) {
      storageConfig.providerCategories[created.id] = defaultCategorySettings(descriptor);
    }

    await repos().preferences.update(user.id, { storageConfig });
  }

  return c.json({ success: true, data: formatProviderResponse(created) }, 201);
});

routes.put(
  '/:id',
  zValidator('param', commonSchemas.idParam),
  zValidator('json', updateProviderSchema),
  authorize(ownAccount),
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
    const descriptor = providerDescriptor(existing.domain, existing.providerType);
    if (body.config !== undefined) {
      const clientConfig = descriptor ? withoutServerState(descriptor, body.config) : body.config;
      // Server-written keys (accountEmail, albumId) are not sent by forms; a wholesale replace would drop them.
      const merged = { ...(existing.config ?? {}), ...clientConfig };
      if (descriptor) {
        const stored = (existing.config ?? {}) as Record<string, unknown>;
        const unchanged = Object.keys(stored).filter(
          (key) => !Object.hasOwn(clientConfig, key) || Object.is(clientConfig[key], stored[key])
        );
        validateProviderConfig(descriptor, clientConfig, unchanged);
        validateProviderConfig(descriptor, merged, unchanged);
        assertSecretsReentered(descriptor, stored, clientConfig, body.credentials);
      }
      assertOwnerMayReach(existing.userId, existing.domain, merged);
      updates.config = merged;
    }
    if (body.credentials !== undefined) {
      if (descriptor) {
        validateProviderSecrets(
          descriptor,
          DOMAIN_LABELS[existing.domain] ?? existing.domain,
          body.credentials
        );
      }
      updates.credentials = encrypt(JSON.stringify(body.credentials), {
        rowId: existing.id,
        userId: existing.userId,
        domain: existing.domain,
      });
      if (existing.status !== 'disabled') {
        Object.assign(updates, { status: 'active', lastErrorCode: null, failureCount: 0 });
      }
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
  const prefs = await repos().preferences.getOrCreate(userId);

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

  await repos().preferences.update(userId, { storageConfig });
}

// JSON merge patch, not read-modify-write, so concurrent writes to sibling providers are not clobbered.
async function cleanupBackupConfig(userId: string, providerId: string): Promise<void> {
  const prefs = await repos().preferences.getOrCreate(userId);
  if (!prefs.backupConfig?.providers?.[providerId]) return;
  await repos().preferences.mergeJsonField(userId, 'backupConfig', {
    providers: { [providerId]: null },
  });
}

async function cleanupProviderDefaults(userId: string, providerId: string): Promise<void> {
  const prefs = await repos().preferences.getOrCreate(userId);
  const defaults = prefs.providerDefaults ?? {};
  if (!Object.values(defaults).includes(providerId)) return;
  await repos().preferences.mergeJsonField(
    userId,
    'providerDefaults',
    Object.fromEntries(
      Object.entries(defaults)
        .filter(([, id]) => id === providerId)
        .map(([capability]) => [capability, null])
    )
  );
}

async function assertNoPhotosOnlyHere(providerId: string, force: boolean): Promise<void> {
  if (force) return;
  const photosOnlyHere = await repos().photoRefs.countPhotosOnlyOnProvider(providerId);
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
  authorize(ownAccount),
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
        await repos().photoRefs.deleteByProvider(id);
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
    await cleanupProviderDefaults(user.id, id);

    return c.body(null, 204);
  }
);

const providerTestLimiter = rateLimiter({
  ...CONFIG.rateLimit.providerTest,
  keyGenerator: (c) => `providerTest:${c.get('user').id}`,
});

routes.post(
  '/:id/test',
  providerTestLimiter,
  zValidator('param', commonSchemas.idParam),
  authorize(ownAccount),
  async (c) => {
    const user = c.get('user');
    const { id } = c.req.valid('param');

    const db = getDb();

    const existing = await findOwnedProviderOrThrow(db, id, user.id);
    if (existing.domain === 'auth') {
      throw new ValidationError('Sign-in providers cannot be tested through this endpoint');
    }

    let result: HealthResult;
    try {
      result = await checkProviderHealth(existing);
    } catch (error) {
      if (error instanceof ValidationError) {
        await recordProviderHealth(existing.id, healthFailure(healthCodeOf(error)));
      }
      throw error;
    }
    await recordProviderHealth(existing.id, result);

    return c.json({ success: true, data: result });
  }
);

routes.post(
  '/:id/backfill',
  zValidator('param', commonSchemas.idParam),
  authorize(ownAccount),
  async (c) => {
    const user = c.get('user');
    const { id } = c.req.valid('param');

    const db = getDb();

    await findOwnedProviderOrThrow(db, id, user.id);
    await repos().photoRefs.resetFailedForProvider(id);

    const prefs = await repos().preferences.getOrCreate(user.id);
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
  }
);

routes.get(
  '/:id/sync-status',
  zValidator('param', commonSchemas.idParam),
  authorize(ownAccount),
  async (c) => {
    const user = c.get('user');
    const { id } = c.req.valid('param');

    const db = getDb();

    await findOwnedProviderOrThrow(db, id, user.id);

    const result = Object.fromEntries(
      PHOTO_CATEGORIES.map((category) => [category, { total: 0, synced: 0, failed: 0 }])
    ) as Record<PhotoCategory, { total: number; synced: number; failed: number }>;

    const photoTotals = await db
      .select({ entityType: photos.entityType, count: countNum() })
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
        count: countNum(),
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
  }
);

export { routes };
