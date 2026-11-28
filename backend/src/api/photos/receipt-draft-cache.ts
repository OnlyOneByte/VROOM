import type { ReceiptDraft } from '../providers/domains/vlm/prompt';

const MAX_CACHED_DRAFTS = 1000;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

const drafts = new Map<string, { draft: ReceiptDraft; expires: number }>();

export function cachedReceiptDraft(key: string): ReceiptDraft | undefined {
  const entry = drafts.get(key);
  if (!entry) return undefined;
  if (entry.expires <= Date.now()) {
    drafts.delete(key);
    return undefined;
  }
  return entry.draft;
}

export function rememberReceiptDraft(key: string, draft: ReceiptDraft): void {
  drafts.delete(key);
  if (drafts.size >= MAX_CACHED_DRAFTS) {
    const oldest = drafts.keys().next().value;
    if (oldest !== undefined) drafts.delete(oldest);
  }
  drafts.set(key, { draft, expires: Date.now() + CACHE_TTL_MS });
}

export function clearReceiptDraftCache(): void {
  drafts.clear();
}
