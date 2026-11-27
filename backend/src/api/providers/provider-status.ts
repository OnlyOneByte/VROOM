import { and, eq, ne, sql } from 'drizzle-orm';
import { appContext } from '../../app-context';
import { type UserProvider, userProviders } from '../../db/schema';
import { isSyncError, SyncErrorCode, ValidationError } from '../../errors';
import { decrypt, secretContextOf } from '../../utils/encryption';
import { EndpointNotAllowedError } from '../../utils/outbound-url';
import { LLM_PROVIDERS } from './domains/llm/registry';
import { resolveModelSettings } from './domains/model/model-registry';
import { getStorageProviderRegistry } from './domains/storage/registry';
import { credentialFailureOf } from './domains/storage/storage-provider';

export type HealthCode = 'auth' | 'permission' | 'unreachable' | 'config' | 'endpoint';

export interface HealthResult {
  ok: boolean;
  code?: HealthCode;
  message: string;
}

export const FAILURES_BEFORE_ERROR = 3;

export async function recordProviderHealth(
  providerId: string,
  result: HealthResult,
  options: { synced?: boolean } = {}
): Promise<void> {
  const now = new Date();
  const notTurnedOff = and(eq(userProviders.id, providerId), ne(userProviders.status, 'disabled'));
  if (result.ok) {
    await appContext()
      .asyncDb.update(userProviders)
      .set({
        status: 'active',
        lastErrorCode: null,
        failureCount: 0,
        lastCheckedAt: now,
        ...(options.synced && { lastSyncAt: now }),
      })
      .where(notTurnedOff);
    return;
  }
  const code = result.code ?? 'unreachable';
  const failures = sql`${userProviders.failureCount} + 1`;
  const status =
    code === 'auth' || code === 'permission'
      ? sql`'needs_reauth'`
      : sql`CASE WHEN ${userProviders.status} = 'needs_reauth' THEN 'needs_reauth' WHEN ${failures} >= ${FAILURES_BEFORE_ERROR} THEN 'error' ELSE ${userProviders.status} END`;
  await appContext()
    .asyncDb.update(userProviders)
    .set({ status, lastErrorCode: code, failureCount: failures, lastCheckedAt: now })
    .where(notTurnedOff);
}

const HEALTH_MESSAGES: Record<HealthCode, string> = {
  auth: "The saved sign-in or key wasn't accepted. Reconnect the provider.",
  permission:
    "The provider is connected but isn't allowed to do this. Reconnect it and grant access.",
  unreachable: "Couldn't reach the provider. Check its address and your network, then test again.",
  config: 'The provider settings are incomplete or invalid. Edit them, then test again.',
  endpoint:
    "This server only lets providers reach public https:// addresses. Change the provider's address, then test again.",
};

export function healthFailure(code: HealthCode): HealthResult {
  return { ok: false, code, message: HEALTH_MESSAGES[code] };
}

export function healthCodeOf(error: unknown): HealthCode {
  const credentialFailure = credentialFailureOf(error);
  if (credentialFailure) {
    return credentialFailure.code === SyncErrorCode.PERMISSION_DENIED ? 'permission' : 'auth';
  }
  if (isSyncError(error)) return 'unreachable';
  if (error instanceof EndpointNotAllowedError) return 'endpoint';
  if (error instanceof ValidationError) return 'config';
  const message = error instanceof Error ? error.message : '';
  if (/HTTP 401\b/.test(message)) return 'auth';
  if (/HTTP 403\b/.test(message)) return 'permission';
  if (/HTTP (400|404|422)\b/.test(message)) return 'config';
  return 'unreachable';
}

async function runCheck(row: UserProvider): Promise<HealthResult> {
  if (row.domain === 'storage') {
    const healthy = await getStorageProviderRegistry().createProviderInstance(row).healthCheck();
    return healthy ? { ok: true, message: 'Connected' } : healthFailure('unreachable');
  }
  const settings = resolveModelSettings(row, row.domain === 'llm' ? 'LLM' : 'VLM');
  const descriptor = Object.hasOwn(LLM_PROVIDERS, row.providerType)
    ? LLM_PROVIDERS[row.providerType as keyof typeof LLM_PROVIDERS]
    : undefined;
  if (!descriptor) return healthFailure('config');
  await descriptor
    .create(settings)
    .chat({ messages: [{ role: 'user', content: 'Reply with OK.' }], tools: [] });
  return { ok: true, message: 'Connected' };
}

export async function checkProviderHealth(row: UserProvider): Promise<HealthResult> {
  if (row.credentials !== '') {
    try {
      decrypt(row.credentials, secretContextOf(row));
    } catch {
      return healthFailure('auth');
    }
  }
  try {
    return await runCheck(row);
  } catch (error) {
    if (error instanceof ValidationError) throw error;
    return healthFailure(healthCodeOf(error));
  }
}
