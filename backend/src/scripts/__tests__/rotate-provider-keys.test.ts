import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { createCipheriv, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CONFIG } from '../../config';
import { createTestApp, SETUP_TIMEOUT_MS, type TestApp } from '../../test-helpers/http-client';

const OLD_KEY = '1'.repeat(64);
const NEW_KEY = '2'.repeat(64);

const encryption = CONFIG.encryption as {
  providerKey: string | undefined;
  providerKeys: string | undefined;
};
let original: { providerKey: string | undefined; providerKeys: string | undefined };
let ctx: TestApp;

async function useKeys(providerKey: string | undefined, providerKeys?: string): Promise<void> {
  encryption.providerKey = providerKey;
  encryption.providerKeys = providerKeys;
  (await import('../../utils/encryption'))._clearKeyCache();
}

function encryptV1(plaintext: string, hexKey: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', Buffer.from(hexKey, 'hex'), iv, {
    authTagLength: 16,
  });
  const body = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64');
}

interface Row {
  id: string;
  user_id: string;
  domain: string;
  credentials: string;
}

function rows(): Row[] {
  return ctx.sqlite
    .query('SELECT id, user_id, domain, credentials FROM user_providers ORDER BY id')
    .all() as Row[];
}

beforeEach(async () => {
  original = { providerKey: encryption.providerKey, providerKeys: encryption.providerKeys };
  ctx = await createTestApp();
  await useKeys(OLD_KEY);
}, SETUP_TIMEOUT_MS);

afterEach(async () => {
  await useKeys(original.providerKey, original.providerKeys);
  ctx.close();
});

function insert(
  id: string,
  domain: string,
  providerType: string,
  credentials: string,
  config: object
) {
  ctx.sqlite.run(
    `INSERT INTO user_providers (id, user_id, domain, provider_type, display_name, credentials, config, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'active')`,
    [id, ctx.user.id, domain, providerType, id, credentials, JSON.stringify(config)]
  );
}

describe('bun run providers:rotate-key', () => {
  test('re-encrypts every provider under the new key, and each one still works with the old key gone', async () => {
    const { encrypt } = await import('../../utils/encryption');
    const context = (id: string, domain: string) => ({ rowId: id, userId: ctx.user.id, domain });
    insert(
      'a-s3',
      'storage',
      's3',
      encrypt(
        JSON.stringify({ accessKeyId: 'AK', secretAccessKey: 'SK' }),
        context('a-s3', 'storage')
      ),
      { endpoint: 'https://s3.example.com', bucket: 'b', region: 'us-east-1' }
    );
    insert(
      'b-drive',
      'storage',
      'google-drive',
      encryptV1(JSON.stringify({ refreshToken: 'rt' }), OLD_KEY),
      {}
    );
    insert(
      'c-llm',
      'llm',
      'openai-compatible',
      encryptV1(JSON.stringify({ apiKey: 'sk-llm' }), OLD_KEY),
      {
        model: 'gpt-4o-mini',
        baseUrl: 'https://api.openai.com/v1',
      }
    );
    insert('d-login', 'auth', 'google', '', {});

    await useKeys(OLD_KEY, `next=${NEW_KEY}`);
    const { rotateProviderKeys } = await import('../rotate-provider-keys');
    const { getDb } = await import('../../db/connection');
    const asyncDb = (await import('../../app-context')).appContext().asyncDb;
    expect(await rotateProviderKeys(asyncDb, 2)).toEqual({
      rotated: 3,
      unchanged: 0,
      empty: 1,
      failed: [],
    });
    for (const row of rows().filter((r) => r.credentials !== '')) {
      expect(row.credentials.startsWith('v2:next:')).toBe(true);
    }
    expect((await rotateProviderKeys(asyncDb)).unchanged).toBe(3);

    await useKeys(undefined, `next=${NEW_KEY}`);
    const { storageProviderRegistry, decryptRefreshToken } = await import(
      '../../api/providers/domains/storage/registry'
    );
    const { resolveModelSettings } = await import(
      '../../api/providers/domains/model/model-registry'
    );
    const { userProviders } = await import('../../db/schema');
    const all = await getDb().select().from(userProviders);
    const byId = new Map(all.map((row) => [row.id, row]));

    expect(
      await storageProviderRegistry.createProviderInstance(byId.get('a-s3') as never)
    ).toBeDefined();
    expect(decryptRefreshToken(byId.get('b-drive') as never)).toBe('rt');
    expect((await resolveModelSettings(byId.get('c-llm') as never, 'LLM')).apiKey).toBe('sk-llm');
  });

  test('a row no configured key can read is reported and left as it was', async () => {
    insert('x-lost', 'llm', 'openai-compatible', encryptV1('{"apiKey":"k"}', NEW_KEY), {
      model: 'm',
    });
    const before = rows()[0]?.credentials;
    const { rotateProviderKeys } = await import('../rotate-provider-keys');
    const asyncDb = (await import('../../app-context')).appContext().asyncDb;
    expect((await rotateProviderKeys(asyncDb)).failed).toEqual(['x-lost']);
    expect(rows()[0]?.credentials).toBe(before);
  });

  test('the image bundles the command the docs tell Docker users to run', () => {
    const repo = join(import.meta.dir, '..', '..', '..', '..');
    const dockerfile = readFileSync(join(repo, 'backend', 'Dockerfile'), 'utf8');
    const build = dockerfile.split('\n').find((line) => line.startsWith('RUN bun build'));
    expect(build).toContain('src/scripts/rotate-provider-keys.ts');
    expect(build).toContain('--outdir ./dist');
    expect(readFileSync(join(repo, 'docs', 'deployment.md'), 'utf8')).toContain(
      'bun dist/scripts/rotate-provider-keys.js'
    );
  });
});
