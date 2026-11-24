import { randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import { CONFIG } from '../../config';
import { getDb } from '../../db/connection';
import { type CalendarFeed, type CalendarFeedOptions, calendarFeeds } from '../../db/schema';
import { NotFoundError } from '../../errors';
import { rateLimiter, requireAuth } from '../../middleware';
import { getClientIp } from '../../utils/client-ip';
import { isValidTimeZone } from '../../utils/time-zone';
import { zValidator } from '../../utils/validation';
import { buildFeedEvents } from './feed-events';
import { toIcs } from './ics';

const routes = new Hono();

const FEED_PATH = '/calendar/feed/';
const FEED_TOKEN_IN_TEXT = /(\/calendar\/feed\/)[^/\s?#"]+/g;

export function redactFeedTokens(text: string): string {
  return text.replace(FEED_TOKEN_IN_TEXT, '$1[redacted]');
}
const TOKEN_FILE = /^([A-Za-z0-9_-]{43})\.ics$/;

const DEFAULT_OPTIONS: CalendarFeedOptions = {
  reminders: true,
  insurance: true,
  loans: true,
  vehicleNames: false,
  amounts: false,
};

const optionsSchema = z
  .object({
    reminders: z.boolean(),
    insurance: z.boolean(),
    loans: z.boolean(),
    vehicleNames: z.boolean(),
    amounts: z.boolean(),
    timeZone: z.string().max(64).refine(isValidTimeZone, 'Unknown time zone'),
  })
  .partial()
  .strict();

const feedRateLimiter = rateLimiter({
  ...CONFIG.rateLimit.calendar,
  keyGenerator: (c) => `calendar:${getClientIp(c)}`,
});

export function hashFeedToken(token: string): string {
  return new Bun.CryptoHasher('sha256').update(token).digest('hex');
}

function describe(feed: CalendarFeed | undefined) {
  if (!feed) return null;
  return { options: feed.options, createdAt: feed.createdAt, lastUsedAt: feed.lastUsedAt };
}

async function feedOf(userId: string): Promise<CalendarFeed | undefined> {
  return getDb().select().from(calendarFeeds).where(eq(calendarFeeds.userId, userId)).get();
}

routes.get('/feed/:file', feedRateLimiter, async (c) => {
  const token = TOKEN_FILE.exec(c.req.param('file') ?? '')?.[1];
  const feed = token
    ? await getDb()
        .select()
        .from(calendarFeeds)
        .where(eq(calendarFeeds.tokenHash, hashFeedToken(token)))
        .get()
    : undefined;
  if (!feed) throw new NotFoundError('Calendar feed');
  await getDb()
    .update(calendarFeeds)
    .set({ lastUsedAt: new Date() })
    .where(eq(calendarFeeds.id, feed.id));
  const body = toIcs(await buildFeedEvents(feed.userId, { ...DEFAULT_OPTIONS, ...feed.options }));
  return c.body(body, 200, {
    'Content-Type': 'text/calendar; charset=utf-8',
    'Cache-Control': 'private, max-age=900',
  });
});

routes.get('/feed', requireAuth, async (c) => {
  return c.json({ success: true, data: { feed: describe(await feedOf(c.get('user').id)) } });
});

routes.post(
  '/feed',
  requireAuth,
  zValidator('json', z.object({ options: optionsSchema.optional() }).strict()),
  async (c) => {
    const userId = c.get('user').id;
    const existing = await feedOf(userId);
    const options = { ...DEFAULT_OPTIONS, ...existing?.options, ...c.req.valid('json').options };
    const token = randomBytes(32).toString('base64url');
    const tokenHash = hashFeedToken(token);
    await getDb()
      .insert(calendarFeeds)
      .values({ userId, tokenHash, options })
      .onConflictDoUpdate({
        target: calendarFeeds.userId,
        set: { tokenHash, options, createdAt: new Date(), lastUsedAt: null },
      });
    return c.json(
      {
        success: true,
        data: { feed: describe(await feedOf(userId)), path: `${FEED_PATH}${token}.ics` },
      },
      201
    );
  }
);

routes.put(
  '/feed',
  requireAuth,
  zValidator('json', z.object({ options: optionsSchema }).strict()),
  async (c) => {
    const userId = c.get('user').id;
    const existing = await feedOf(userId);
    if (!existing) throw new NotFoundError('Calendar feed');
    await getDb()
      .update(calendarFeeds)
      .set({ options: { ...DEFAULT_OPTIONS, ...existing.options, ...c.req.valid('json').options } })
      .where(eq(calendarFeeds.id, existing.id));
    return c.json({ success: true, data: { feed: describe(await feedOf(userId)) } });
  }
);

routes.delete('/feed', requireAuth, async (c) => {
  await getDb()
    .delete(calendarFeeds)
    .where(eq(calendarFeeds.userId, c.get('user').id));
  return c.json({ success: true, data: { feed: null } });
});

export { routes };
