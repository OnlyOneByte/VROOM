import { Hono } from 'hono';
import { CONFIG } from '../../config';
import {
  AppError,
  PayloadTooLargeError,
  UnprocessableEntityError,
  ValidationError,
} from '../../errors';
import {
  bodyLimit,
  changeTracker,
  concurrencyLimiter,
  rateLimiter,
  requireAuth,
} from '../../middleware';
import { logger } from '../../utils/logger';
import { OcrUnavailableError } from './domains/vlm/local-ocr';
import { parseExtraction } from './domains/vlm/prompt';
import { getVlmProvider, LOCAL_OCR_PROVIDER_ID } from './domains/vlm/registry';
import { resolveProvider } from './resolve';

const routes = new Hono();

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const ALLOWED_IMAGE_MIME = ['image/jpeg', 'image/png', 'image/webp'];

routes.use('*', requireAuth);
routes.use('*', changeTracker);
routes.use(
  '*',
  bodyLimit({ maxSize: MAX_IMAGE_BYTES, message: 'Receipt image exceeds the 8MB limit' })
);

const receiptScanLimiter = rateLimiter({
  ...CONFIG.rateLimit.receiptScan,
  keyGenerator: (c) => `receiptScan:${c.get('user').id}`,
});
const scansAtOnce = concurrencyLimiter({
  limit: CONFIG.rateLimit.receiptScansAtOnce,
  keyGenerator: (c) => `receipt-scans:${c.get('user').id}`,
  message: 'Wait for your other receipt scans to finish',
  status: 429,
});

routes.post('/parse', receiptScanLimiter, scansAtOnce, async (c) => {
  const user = c.get('user');
  const providerRow = await resolveProvider(user.id, 'ai.vision');

  const body = await c.req.parseBody().catch(() => {
    throw new ValidationError('Upload the receipt image as multipart/form-data');
  });
  const file = body.image;
  if (!file || !(file instanceof File)) {
    throw new ValidationError('No image file provided');
  }
  if (!ALLOWED_IMAGE_MIME.includes(file.type)) {
    throw new ValidationError(`Unsupported image type "${file.type}". Use JPEG, PNG, or WebP.`);
  }
  const bytes = Buffer.from(await file.arrayBuffer());
  // bodyLimit only checks Content-Length; a chunked upload can omit it.
  if (bytes.byteLength > MAX_IMAGE_BYTES) {
    throw new PayloadTooLargeError('Receipt image exceeds the 8MB limit');
  }

  const provider = getVlmProvider(providerRow);
  let raw: Awaited<ReturnType<typeof provider.extractReceipt>>;
  try {
    raw = await provider.extractReceipt({ data: bytes, mimeType: file.type });
  } catch (err) {
    // Adapters log upstream errors; the client gets a generic 502 with no key or raw error.
    const message = err instanceof Error ? err.message : 'VLM provider error';
    logger.warn('Receipt parse failed', { providerType: providerRow.providerType, error: message });
    if (err instanceof OcrUnavailableError) {
      throw new AppError(
        "The built-in text reader isn't available right now. Try again in a moment.",
        503
      );
    }
    if (providerRow.id === LOCAL_OCR_PROVIDER_ID) {
      throw new UnprocessableEntityError('No readable text found. Try a sharper, well-lit photo.');
    }
    throw new AppError('The receipt-parsing provider could not be reached. Try again.', 502);
  }

  // Draft amounts are dollars; cents conversion happens at POST /expenses.
  const draft = parseExtraction(raw);

  return c.json({ success: true, data: { draft } });
});

export { routes };
