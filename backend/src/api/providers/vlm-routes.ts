/**
 * Receipt-parse route (vlm-receipt-parsing T4) — `POST /api/v1/receipts/parse`.
 *
 * Takes a receipt image (multipart), resolves the user's enabled `domain:'vlm'` provider, calls it
 * with the FIXED extraction prompt, validates the model's response through the strict fail-closed
 * schema (prompt.ts), and returns a DRAFT. It PERSISTS NOTHING — the draft pre-fills the expense form
 * and the user confirms through the UNCHANGED POST /expenses path (design §4, R2/R4). The image is
 * persisted only on confirm, via the existing expense_receipts photo flow (R5) — not here.
 *
 * Error honesty (the #43/#44/#144 anti-fail-open lesson): no configured provider → 400 with an
 * actionable message; a provider transport/HTTP failure → 502 (never a faked success); an oversized
 * or wrong-type image → 400/413. A partial/empty draft is a 200 — the user fills the rest by hand.
 *
 * D5 (size cap): the recommended ≤8MB cap is enforced via bodyLimit (Content-Length) AND a post-parse
 * byte check (a chunked upload can omit Content-Length). Server-side downscale (a further cost/data-min
 * optimization noted in the spec) is a follow-on — it needs an image lib dependency and is NOT a
 * correctness gate, so T4 ships the cap + MIME allowlist and passes the (capped) bytes through.
 */

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

/** D5: recommended cap — a receipt photo is small; this bounds cost + a hung-upload DoS. */
const MAX_IMAGE_BYTES = 8 * 1024 * 1024; // 8 MB
/** Vision models take raster images (PDF is a photo-flow concern, not a VLM input here). */
const ALLOWED_IMAGE_MIME = ['image/jpeg', 'image/png', 'image/webp'];

routes.use('*', requireAuth);
routes.use('*', changeTracker);
// Reject an over-cap upload early on Content-Length before we buffer it.
routes.use(
  '*',
  bodyLimit({ maxSize: MAX_IMAGE_BYTES, message: 'Receipt image exceeds the 8MB limit' })
);

/**
 * POST /api/v1/receipts/parse — parse a receipt image into a draft expense. PERSISTS NOTHING.
 * Body (multipart/form-data): { image: File }.
 */
routes.post('/parse', async (c) => {
  const user = c.get('user');
  const db = getDb();

  // 1) Resolve the user's enabled VLM provider. None → an actionable 400 (link to add one in the UI).
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

  // 2) Parse the multipart image + enforce the type/size contract (fail-fast 400/413).
  const body = await c.req.parseBody();
  const file = body.image;
  if (!file || !(file instanceof File)) {
    throw new AppError('No image file provided', 400);
  }
  if (!ALLOWED_IMAGE_MIME.includes(file.type)) {
    throw new ValidationError(`Unsupported image type "${file.type}". Use JPEG, PNG, or WebP.`);
  }
  const bytes = Buffer.from(await file.arrayBuffer());
  // Post-parse byte check: a chunked upload can omit Content-Length, slipping past bodyLimit.
  if (bytes.byteLength > MAX_IMAGE_BYTES) {
    throw new AppError('Receipt image exceeds the 8MB limit', 413);
  }

  // 3) Call the provider (dumb transport) → validate the RAW output through the fail-closed schema.
  const provider = getVlmProvider(providerRow);
  let raw: Awaited<ReturnType<typeof provider.extractReceipt>>;
  try {
    raw = await provider.extractReceipt({ data: bytes, mimeType: file.type });
  } catch (err) {
    // Surface a provider failure HONESTLY as a 502 (never a faked success). Do NOT echo the api key
    // or the provider's raw error to the client; the adapter already logged the detail.
    const message = err instanceof Error ? err.message : 'VLM provider error';
    logger.warn('Receipt parse failed', { providerType: providerRow.providerType, error: message });
    throw new AppError('The receipt-parsing provider could not be reached. Try again.', 502);
  }

  // parseExtraction is fail-closed: bad fields dropped, unparseable → empty draft (the user fills by
  // hand). The draft is in DOLLARS; cents convert only at the POST /expenses boundary.
  const draft = parseExtraction(raw);

  return c.json({ success: true, data: { draft } });
});

export { routes };
