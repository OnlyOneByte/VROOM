import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CONFIG } from '../../../config';
import type { UserProvider } from '../../../db/schema';
import { FakeGoogleStore, makeFakeDrive } from '../../../test-helpers/fake-google-clients';
import {
  FakePhotosStore,
  makeFakePhotosClient,
} from '../../../test-helpers/fake-google-photos-client';
import { createTestApp, SETUP_TIMEOUT_MS, type TestApp } from '../../../test-helpers/http-client';
import { describeDescriptorContract } from '../../../test-helpers/provider-contracts/descriptor';
import {
  describeModelContract,
  type ModelContractSubject,
} from '../../../test-helpers/provider-contracts/model';
import { describeOcrContract } from '../../../test-helpers/provider-contracts/ocr';
import { describeStorageContract } from '../../../test-helpers/provider-contracts/storage';
import { STORAGE_CHECKS } from '../../../test-helpers/provider-contracts/storage-checks';
import { AUTH_PROVIDERS } from '../../auth/providers/registry';
import { IMPORT_FORMATS, IMPORT_PROVIDERS } from '../../expenses/import-mapping-presets';
import { backupStrategyRegistry } from '../../sync/backup-strategy-registry';
import '../../sync/init';
import type { AnyProviderDescriptor } from '../descriptor';
import type { LlmProvider } from '../domains/llm/llm-provider';
import { getLlmProvider, LLM_PROVIDERS } from '../domains/llm/registry';
import { FakeStorageProvider } from '../domains/storage/fake-provider';
import { GoogleDriveProvider } from '../domains/storage/google-drive-provider';
import { GooglePhotosProvider } from '../domains/storage/google-photos-provider';
import {
  getStorageProviderRegistry,
  STORAGE_PROVIDERS,
  type StorageProviderType,
} from '../domains/storage/registry';
import type { StorageProvider } from '../domains/storage/storage-provider';
import { stopLocalOcr } from '../domains/vlm/local-ocr';
import { BUILTIN_VISION_PROVIDERS, VISION_PROVIDERS } from '../domains/vlm/registry';
import type { VlmProvider } from '../domains/vlm/vlm-provider';
import { GoogleDriveService } from '../services/google-drive-service';
import { GooglePhotosService } from '../services/google-photos-service';

const BACKEND_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const S3_RUNNER = join(
  BACKEND_ROOT,
  'src',
  'test-helpers',
  'provider-contracts',
  's3-contract-run.ts'
);

const IN_PROCESS_STORAGE: Record<Exclude<StorageProviderType, 's3'>, () => StorageProvider> = {
  fake: () => new FakeStorageProvider(),
  'google-drive': () =>
    new GoogleDriveProvider(
      'refresh',
      new GoogleDriveService('refresh', makeFakeDrive(new FakeGoogleStore()))
    ),
  'google-photos': () =>
    new GooglePhotosProvider(
      'refresh',
      new GooglePhotosService('refresh', makeFakePhotosClient(new FakePhotosStore()))
    ),
};

for (const [type, make] of Object.entries(IN_PROCESS_STORAGE)) {
  describeStorageContract(type, make);
}

async function runS3Contract(): Promise<{
  results: { name: string; error: string | null }[];
  stderr: string;
}> {
  const proc = Bun.spawn([process.execPath, '--env-file=/dev/null', S3_RUNNER], {
    cwd: BACKEND_ROOT,
    env: {
      PATH: process.env.PATH ?? '',
      NODE_ENV: 'test',
      DATABASE_URL: ':memory:',
      PROVIDER_ENCRYPTION_KEY: '0'.repeat(64),
      PRIVATE_PROVIDER_ENDPOINTS: 'allow',
    },
    stdout: 'pipe',
    stderr: 'pipe',
    timeout: 20_000,
  });
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  try {
    return { results: JSON.parse(stdout.trim().split('\n').at(-1) ?? ''), stderr };
  } catch {
    return { results: [], stderr };
  }
}

const s3 = await runS3Contract();

describe('s3 storage contract (real client, local fake S3, own process)', () => {
  const { results, stderr } = s3;
  test('the runner ran every storage check', () => {
    expect(
      results.map((r) => r.name),
      stderr
    ).toEqual(STORAGE_CHECKS.map((c) => c.name));
  });
  for (const result of results) {
    test(result.name, () => {
      expect(result.error).toBeNull();
    });
  }
});

describe('storage descriptor features hold for every type', () => {
  test('s3 identity is stable for the same config', () => {
    const config = { endpoint: 'https://s3.example.com', bucket: 'b', region: 'r' };
    const identity = STORAGE_PROVIDERS.s3.identity(config);
    expect(identity).toBeTruthy();
    expect(STORAGE_PROVIDERS.s3.identity({ ...config })).toBe(identity);
  });

  let app: TestApp;
  beforeEach(async () => {
    app = await createTestApp();
  }, SETUP_TIMEOUT_MS);
  afterEach(() => app.close());

  function backupContext(type: string, enabled: boolean) {
    return {
      userId: app.user.id,
      displayName: 'Contract',
      providerId: `p-${type}`,
      providerRow: { id: `p-${type}`, providerType: type, config: {} } as UserProvider,
      decryptedCredentials: { refreshToken: 'refresh' },
      providerConfig: { enabled, folderPath: 'Backups', retentionCount: 1 },
      zipBuffer: Buffer.from('zip'),
    };
  }

  test('a ZIP backup runs only when the provider ZIP flag is on', async () => {
    const fake = new FakeStorageProvider();
    const built = spyOn(getStorageProviderRegistry(), 'createProviderInstance').mockReturnValue(
      fake
    );
    try {
      const zipTypes = Object.entries(STORAGE_PROVIDERS)
        .filter(([, descriptor]) => !descriptor.features.photoOnly)
        .map(([type]) => type);
      expect(zipTypes.length).toBeGreaterThan(0);
      for (const type of zipTypes) {
        const strategy = backupStrategyRegistry.get(type);
        expect(strategy, type).toBeDefined();
        const off = await strategy?.execute(backupContext(type, false));
        expect(off?.capabilities.zip, type).toBeUndefined();
      }
      expect(built).not.toHaveBeenCalled();

      const zipOnly = zipTypes.filter(
        (type) => !STORAGE_PROVIDERS[type as StorageProviderType].features.backupSheets
      );
      const uploads = spyOn(fake, 'upload');
      for (const type of zipOnly) {
        const on = await backupStrategyRegistry.get(type)?.execute(backupContext(type, true));
        expect(on?.capabilities.zip?.success, type).toBe(true);
      }
      expect(uploads).toHaveBeenCalledTimes(zipOnly.length);
      for (const [params] of uploads.mock.calls) {
        expect(params.rawPath).toBe('Backups');
        expect(params.fileName).toMatch(/^vroom-backup-.*\.zip$/);
      }
    } finally {
      built.mockRestore();
    }
  });
});

const LLM_REQUEST = { messages: [{ role: 'user' as const, content: 'hi' }], tools: [] };
const RECEIPT = { data: Buffer.from('image'), mimeType: 'image/jpeg' };

const OPENAI = {
  credential: { header: 'authorization', value: (key: string) => `Bearer ${key}` },
  okResponse: { choices: [{ message: { content: '{}' } }] },
  path: '/chat/completions',
};
const ANTHROPIC = {
  credential: { header: 'x-api-key', value: (key: string) => key },
  okResponse: { content: [{ type: 'text', text: '{}' }] },
  path: '/v1/messages',
};
const GEMINI = {
  credential: { query: 'key' },
  okResponse: { candidates: [{ content: { parts: [{ text: '{}' }] } }] },
  path: '/v1beta/models/{model}:generateContent',
};
const WIRE = { 'openai-compatible': OPENAI, ollama: OPENAI, anthropic: ANTHROPIC, gemini: GEMINI };

const LLM_SUBJECTS: Record<keyof typeof LLM_PROVIDERS, ModelContractSubject<LlmProvider>> = {
  'openai-compatible': {
    ...WIRE['openai-compatible'],
    create: LLM_PROVIDERS['openai-compatible'].create,
    invoke: (p) => p.chat(LLM_REQUEST),
  },
  anthropic: {
    ...WIRE.anthropic,
    create: LLM_PROVIDERS.anthropic.create,
    invoke: (p) => p.chat(LLM_REQUEST),
  },
  gemini: {
    ...WIRE.gemini,
    create: LLM_PROVIDERS.gemini.create,
    invoke: (p) => p.chat(LLM_REQUEST),
  },
  ollama: {
    ...WIRE.ollama,
    create: LLM_PROVIDERS.ollama.create,
    invoke: (p) => p.chat(LLM_REQUEST),
  },
};

const VISION_SUBJECTS: Record<keyof typeof VISION_PROVIDERS, ModelContractSubject<VlmProvider>> = {
  'openai-compatible': {
    ...WIRE['openai-compatible'],
    create: VISION_PROVIDERS['openai-compatible'].create,
    invoke: (p) => p.extractReceipt(RECEIPT),
  },
  anthropic: {
    ...WIRE.anthropic,
    create: VISION_PROVIDERS.anthropic.create,
    invoke: (p) => p.extractReceipt(RECEIPT),
  },
  gemini: {
    ...WIRE.gemini,
    create: VISION_PROVIDERS.gemini.create,
    invoke: (p) => p.extractReceipt(RECEIPT),
  },
  ollama: {
    ...WIRE.ollama,
    create: VISION_PROVIDERS.ollama.create,
    invoke: (p) => p.extractReceipt(RECEIPT),
  },
};

for (const [id, subject] of Object.entries(LLM_SUBJECTS)) {
  describeModelContract(`ai.llm/${id}`, subject);
}
for (const [id, subject] of Object.entries(VISION_SUBJECTS)) {
  describeModelContract(`ai.vision/${id}`, subject);
}
describeOcrContract(
  'ai.vision/local-ocr',
  BUILTIN_VISION_PROVIDERS['local-ocr'].create,
  stopLocalOcr
);

const REGISTRIES: Record<string, Record<string, AnyProviderDescriptor>> = {
  auth: AUTH_PROVIDERS,
  import: IMPORT_PROVIDERS,
  storage: STORAGE_PROVIDERS,
  'ai.llm': LLM_PROVIDERS,
  'ai.vision': { ...VISION_PROVIDERS, ...BUILTIN_VISION_PROVIDERS },
};

for (const [capability, table] of Object.entries(REGISTRIES)) {
  for (const [id, descriptor] of Object.entries(table)) {
    describeDescriptorContract(`${capability}/${id}`, descriptor);
  }
}

describe('provider contract coverage', () => {
  test('every storage, assistant and receipt-reading provider runs its capability contract', () => {
    expect([...Object.keys(IN_PROCESS_STORAGE), 's3'].sort()).toEqual(
      Object.keys(STORAGE_PROVIDERS).sort()
    );
    expect(Object.keys(LLM_SUBJECTS).sort()).toEqual(Object.keys(LLM_PROVIDERS).sort());
    expect(Object.keys(VISION_SUBJECTS).sort()).toEqual(Object.keys(VISION_PROVIDERS).sort());
    expect(Object.keys(IMPORT_PROVIDERS)).toEqual(IMPORT_FORMATS.map((format) => format.id));
  });
});

describe('a stored config is checked when the provider is resolved', () => {
  const config = CONFIG as { allowFakeStorageProvider: boolean };

  function row(over: Partial<UserProvider>): UserProvider {
    return {
      id: 'p-resolve',
      userId: 'u1',
      domain: 'storage',
      providerType: 'fake',
      credentials: '',
      config: {},
      ...over,
    } as UserProvider;
  }

  test('a storage row whose config breaks the schema fails at resolve, not on first use', () => {
    const previous = config.allowFakeStorageProvider;
    config.allowFakeStorageProvider = true;
    try {
      const registry = getStorageProviderRegistry();
      expect(() =>
        registry.createProviderInstance(row({ config: { providerRootPath: 'a/../b' } }))
      ).toThrow('Path traversal not allowed');
      expect(() =>
        registry.createProviderInstance(row({ config: { legacyFolderId: 'kept' } }))
      ).not.toThrow();
    } finally {
      config.allowFakeStorageProvider = previous;
    }
  });

  test('a model row whose config breaks the schema fails at resolve', async () => {
    const { encrypt } = await import('../../../utils/encryption');
    const modelRow = (cfg: Record<string, unknown>) =>
      row({
        domain: 'llm',
        providerType: 'anthropic',
        credentials: encrypt(JSON.stringify({ apiKey: 'sk-x' }), {
          rowId: 'p-resolve',
          userId: 'u1',
          domain: 'llm',
        }),
        config: cfg,
      });
    expect(() => getLlmProvider(modelRow({ model: 'claude', baseUrl: 42 }))).toThrow();
    expect(() => getLlmProvider(modelRow({ model: 'claude', legacy: true }))).not.toThrow();
  });
});
