import { and, asc, eq, ne } from 'drizzle-orm';
import { getDb } from '../../db/connection';
import { type UserProvider, userProviders } from '../../db/schema';
import { NoProviderError } from '../../errors';
import type { DefaultProviderCapability } from '../../types';
import { preferencesRepository } from '../settings/repository';

export const CAPABILITY_DOMAIN: Record<DefaultProviderCapability, string> = {
  'ai.llm': 'llm',
  'ai.vision': 'vlm',
};

const NO_PROVIDER_MESSAGE: Record<DefaultProviderCapability, string> = {
  'ai.llm': 'No assistant (LLM) provider is configured. Add one in Settings to use the assistant.',
  'ai.vision':
    'No receipt-parsing (VLM) provider is configured. Add one in Settings to scan receipts.',
};

export async function resolveProvider(
  userId: string,
  capability: DefaultProviderCapability
): Promise<UserProvider> {
  const rows = await getDb()
    .select()
    .from(userProviders)
    .where(
      and(
        eq(userProviders.userId, userId),
        eq(userProviders.domain, CAPABILITY_DOMAIN[capability]),
        ne(userProviders.status, 'disabled')
      )
    )
    .orderBy(asc(userProviders.createdAt), asc(userProviders.id));
  const prefs = await preferencesRepository.getOrCreate(userId);
  const defaultId = prefs.providerDefaults?.[capability];
  const chosen = rows.find((row) => row.id === defaultId) ?? rows[0];
  if (!chosen) throw new NoProviderError(capability, NO_PROVIDER_MESSAGE[capability]);
  return chosen;
}
