import { and, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { getDb } from '../../db/connection';
import { userProviders } from '../../db/schema';
import { AppError, ValidationError } from '../../errors';
import { bodyLimit, changeTracker, requireAuth } from '../../middleware';
import { logger } from '../../utils/logger';
import { parseExtraction } from './domains/vlm/prompt';
import { getVlmProvider } from './domains/vlm/registry';

const routes = new Hono();

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const ALLOWED_IMAGE_MIME = ['image/jpeg', 'image/png', 'image/webp'];

routes.use('*', requireAuth);
routes.use('*', changeTracker);
routes.use(
  '*',
  bodyLimit({ maxSize: MAX_IMAGE_BYTES, message: 'Receipt image exceeds the 8MB limit' })
);

routes.post('/parse', async (c) => {
  const user = c.get('user');
  const db = getDb();

  const rows = await db
    .select()
    .from(userProviders)
    .where(
      and(
        eq(userProviders.userId, user.id),
        eq(userProviders.domain, 'vlm'),
        eq(userProviders.status, 'active')
      )
    );
  const providerRow = rows[0];
  if (!providerRow) {
    throw new ValidationError(
      'No receipt-parsing (VLM) provider is configured. Add one in Settings to scan receipts.'
    );
  }

  const body = await c.req.parseBody();
  const file = body.image;
  if (!file || !(file instanceof File)) {
    throw new AppError('No image file provided', 400);
  }
  if (!ALLOWED_IMAGE_MIME.includes(file.type)) {
    throw new ValidationError(`Unsupported image type "${file.type}". Use JPEG, PNG, or WebP.`);
  }
  const bytes = Buffer.from(await file.arrayBuffer());
  // bodyLimit only checks Content-Length; a chunked upload can omit it.
  if (bytes.byteLength > MAX_IMAGE_BYTES) {
    throw new AppError('Receipt image exceeds the 8MB limit', 413);
  }

  const provider = getVlmProvider(providerRow);
  let raw: Awaited<ReturnType<typeof provider.extractReceipt>>;
  try {
    raw = await provider.extractReceipt({ data: bytes, mimeType: file.type });
  } catch (err) {
    // Adapters log upstream errors; the client gets a generic 502 with no key or raw error.
    const message = err instanceof Error ? err.message : 'VLM provider error';
    logger.warn('Receipt parse failed', { providerType: providerRow.providerType, error: message });
    throw new AppError('The receipt-parsing provider could not be reached. Try again.', 502);
  }

  // Draft amounts are dollars; cents conversion happens at POST /expenses.
  const draft = parseExtraction(raw);

  return c.json({ success: true, data: { draft } });
});

export { routes };
