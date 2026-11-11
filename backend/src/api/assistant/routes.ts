/**
 * POST /api/v1/assistant/chat. Stateless: the transcript lives in the client. The orchestrator lets the
 * model call only a fixed allowlist of read-only tools, scoped to the session user.
 *
 * Errors: no provider configured returns 400; a provider failure returns 502 rather than a made-up
 * reply. A loop that hits its caps returns an honest bounded reply.
 */

import { and, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import { getDb } from '../../db/connection';
import { userProviders } from '../../db/schema';
import { AppError, ValidationError } from '../../errors';
import { requireAuth } from '../../middleware';
import { logger } from '../../utils/logger';
import { zValidator } from '../../utils/validation';
import type { ChatMessage } from '../providers/domains/llm/llm-provider';
import { runAssistant } from '../providers/domains/llm/orchestrator';
import { getLlmProvider } from '../providers/domains/llm/registry';

const routes = new Hono();

routes.use('*', requireAuth);

// Bound the prompt size so provider cost and injection surface stay limited.
const MAX_MESSAGE_CHARS = 2000;
const MAX_HISTORY_TURNS = 12;

const chatBodySchema = z.object({
  message: z.string().min(1, 'Message is required').max(MAX_MESSAGE_CHARS),
  history: z
    .array(
      z.object({
        // Tool turns are produced server-side and never accepted from the request.
        role: z.enum(['user', 'assistant']),
        content: z.string().max(MAX_MESSAGE_CHARS),
      })
    )
    .max(MAX_HISTORY_TURNS)
    .optional(),
});

routes.post('/chat', zValidator('json', chatBodySchema), async (c) => {
  const user = c.get('user');
  const body = c.req.valid('json');
  const db = getDb();

  const rows = await db
    .select()
    .from(userProviders)
    .where(
      and(
        eq(userProviders.userId, user.id),
        eq(userProviders.domain, 'llm'),
        eq(userProviders.status, 'active')
      )
    );
  const providerRow = rows[0];
  if (!providerRow) {
    throw new ValidationError(
      'No assistant (LLM) provider is configured. Add one in Settings to use the assistant.'
    );
  }

  const provider = getLlmProvider(providerRow);
  const history: ChatMessage[] = (body.history ?? []).map((m) => ({
    role: m.role,
    content: m.content,
  }));

  try {
    const { reply, toolsUsed } = await runAssistant(
      provider,
      user.id,
      body.message,
      history,
      Date.now()
    );
    return c.json({ success: true, data: { reply, toolsUsed } });
  } catch (err) {
    // The provider error is not echoed: it may contain credentials. The adapter has already logged it.
    const message = err instanceof Error ? err.message : 'LLM provider error';
    logger.warn('Assistant chat failed', {
      providerType: providerRow.providerType,
      error: message,
    });
    throw new AppError('The assistant provider could not be reached. Try again.', 502);
  }
});

export { routes };
