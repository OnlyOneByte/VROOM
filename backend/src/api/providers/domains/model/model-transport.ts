import { logger } from '../../../../utils/logger';

export type ModelDomainLabel = 'LLM' | 'VLM';

export interface ModelRequest {
  domain: ModelDomainLabel;
  providerType: string;
  model: string;
  url: string;
  headers?: Record<string, string>;
  body: unknown;
  timeoutMs: number;
}

export function trimBaseUrl(url: string): string {
  return url.replace(/\/+$/, '');
}

// Never log the url (Gemini puts the API key in the query string), headers, or request body.
export async function postModelJson<T>(req: ModelRequest): Promise<T | null> {
  const label = `${req.domain} ${req.providerType}`;

  let res: Response;
  try {
    res = await fetch(req.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...req.headers },
      body: JSON.stringify(req.body),
      signal: AbortSignal.timeout(req.timeoutMs),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'network error';
    logger.warn(`${label} request failed`, { model: req.model, error: message });
    throw new Error(`${req.domain} request failed: ${message}`);
  }

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    logger.warn(`${label} non-2xx`, {
      model: req.model,
      status: res.status,
      detail: detail.slice(0, 200),
    });
    throw new Error(`${req.domain} provider returned HTTP ${res.status}`);
  }

  return (await res.json().catch(() => null)) as T | null;
}
