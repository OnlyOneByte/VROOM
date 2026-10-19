/**
 * PUT /providers/:id treats `config` as a PARTIAL update.
 *
 * It used to assign `body.config` straight onto the column, so every edit-save wiped the config the
 * SERVER owns and no form echoes back. The headline casualty is `accountEmail`: it is written once,
 * from the OAuth grant (resolveProviderCredentials), and is the only record of which Google account a
 * provider belongs to — the provider card renders it, the restore picker labels backups with it, and
 * the create-time duplicate check compares it to refuse re-adding the same account. Renaming a Drive
 * provider answered 200 and silently dropped it. `albumId` (the resolved photo album) went the same
 * way.
 *
 * Merging makes the column's contents the union of what has ever been sent, which is what every
 * caller already assumes. Driven through the REAL stack, because the replace lived in the handler.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  createTestApp,
  type DataEnvelope,
  json,
  type TestApp,
} from '../../../test-helpers/http-client';

let ctx: TestApp;

beforeEach(async () => {
  ctx = await createTestApp();
});
afterEach(() => ctx.close());

interface ProviderResponse {
  id: string;
  config: Record<string, unknown>;
}

/**
 * Seed a connected google-drive provider directly: the POST route resolves google credentials from a
 * one-shot OAuth nonce, which is what writes `accountEmail` in production and cannot be faked over
 * HTTP here. The row below is exactly what that path persists.
 */
function seedConnectedDrive(id: string, config: Record<string, unknown>): void {
  ctx.sqlite.run(
    `INSERT INTO user_providers (id, user_id, domain, provider_type, display_name, credentials, config, status)
     VALUES (?, ?, 'storage', 'google-drive', 'My Drive', '', ?, 'active')`,
    [id, ctx.user.id, JSON.stringify(config)]
  );
}

async function storedConfig(id: string): Promise<Record<string, unknown>> {
  const list = (
    await json<DataEnvelope<ProviderResponse[]>>(await ctx.authed('GET', '/api/v1/providers'))
  ).data;
  const row = list.find((p) => p.id === id);
  expect(row).toBeDefined();
  return row?.config ?? {};
}

describe('PUT /providers/:id merges `config` instead of replacing it', () => {
  test('a rename + root-path edit keeps the connected accountEmail', async () => {
    seedConnectedDrive('drive-1', {
      providerRootPath: 'VROOM',
      photoRootPath: 'Receipts',
      accountEmail: 'owner@example.com',
    });

    const res = await ctx.authed('PUT', '/api/v1/providers/drive-1', {
      displayName: 'Renamed Drive',
      config: { providerRootPath: 'VROOM-2', photoRootPath: 'Receipts' },
    });

    expect(res.status).toBe(200);
    expect((await json<DataEnvelope<ProviderResponse>>(res)).data.config).toEqual({
      providerRootPath: 'VROOM-2',
      photoRootPath: 'Receipts',
      accountEmail: 'owner@example.com',
    });
    expect(await storedConfig('drive-1')).toEqual({
      providerRootPath: 'VROOM-2',
      photoRootPath: 'Receipts',
      accountEmail: 'owner@example.com',
    });
  });

  test('a single-key edit keeps every other key, including the resolved albumId', async () => {
    seedConnectedDrive('drive-2', {
      providerRootPath: 'VROOM',
      photoRootPath: 'Photos',
      accountEmail: 'owner@example.com',
      albumId: 'album-abc',
    });

    const res = await ctx.authed('PUT', '/api/v1/providers/drive-2', {
      config: { photoRootPath: 'Scans' },
    });

    expect(res.status).toBe(200);
    expect(await storedConfig('drive-2')).toEqual({
      providerRootPath: 'VROOM',
      photoRootPath: 'Scans',
      accountEmail: 'owner@example.com',
      albumId: 'album-abc',
    });
  });

  test('a key the caller DOES send still wins — merging is not ignoring the payload', async () => {
    seedConnectedDrive('drive-3', { photoRootPath: 'Photos', accountEmail: 'owner@example.com' });

    await ctx.authed('PUT', '/api/v1/providers/drive-3', {
      config: { photoRootPath: 'Scans', accountEmail: 'second@example.com' },
    });

    expect(await storedConfig('drive-3')).toEqual({
      photoRootPath: 'Scans',
      accountEmail: 'second@example.com',
    });
  });

  test("another user's provider is still 404 and untouched (the merge reads the OWNED row)", async () => {
    seedConnectedDrive('drive-4', { photoRootPath: 'Photos', accountEmail: 'owner@example.com' });
    const other = await createTestApp();

    const res = await other.authed('PUT', '/api/v1/providers/drive-4', {
      config: { photoRootPath: 'Hijacked' },
    });

    expect(res.status).toBe(404);
  });
});
