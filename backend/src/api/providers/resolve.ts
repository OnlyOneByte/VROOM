import { and, asc, eq, ne } from 'drizzle-orm';
import { appContext } from '../../app-context';
import { firstRow } from '../../db/first-row';
import { type UserProvider, userPreferences, userProviders } from '../../db/schema';
import { NoProviderError } from '../../errors';
import type { DefaultProviderCapability } from '../../types';
import { builtinVisionRow, LOCAL_OCR_PROVIDER_ID, localOcrEnabled } from './domains/vlm/registry';

export const CAPABILITY_DOMAIN: Record<DefaultProviderCapability, string> = {
  'ai.llm': 'llm',
  'ai.vision': 'vlm',
};

const NO_PROVIDER_MESSAGE: Record<DefaultProviderCapability, string> = {
  'ai.llm': 'No assistant (LLM) provider is configured. Add one in Settings to use the assistant.',
  'ai.vision': 'No receipt-scanning provider is configured. Add one in Settings to scan receipts.',
};

export async function resolveProvider(
  userId: string,
  capability: DefaultProviderCapability
): Promise<UserProvider> {
  const rows = await appContext()
    .asyncDb.select()
    .from(userProviders)
    .where(
      and(
        eq(userProviders.userId, userId),
        eq(userProviders.domain, CAPABILITY_DOMAIN[capability]),
        ne(userProviders.status, 'disabled')
      )
    )
    .orderBy(asc(userProviders.createdAt), asc(userProviders.id));
  const prefs = await appContext()
    .asyncDb.select({ providerDefaults: userPreferences.providerDefaults })
    .from(userPreferences)
    .where(eq(userPreferences.userId, userId))
    .then(firstRow);
  const defaultId = prefs?.providerDefaults?.[capability];
  const builtin = capability === 'ai.vision' && localOcrEnabled();
  if (builtin && defaultId === LOCAL_OCR_PROVIDER_ID) return builtinVisionRow(userId);
  const chosen = rows.find((row) => row.id === defaultId) ?? rows[0];
  if (chosen) return chosen;
  if (builtin) return builtinVisionRow(userId);
  throw new NoProviderError(capability, NO_PROVIDER_MESSAGE[capability]);
}
