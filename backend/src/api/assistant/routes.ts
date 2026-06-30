/**
 * Assistant chat route (llm-assistant T4) — `POST /api/v1/assistant/chat`.
 *
 * Takes a user message (+ a bounded prior transcript), resolves the user's enabled `domain:'llm'`
 * provider, and runs the BOUNDED tool-calling orchestrator (design §4): the model may call a FIXED
 * allowlist of READ-ONLY, userId-scoped tools; the orchestrator allowlist-checks + Zod-validates every
 * tool call and runs it scoped to the SESSION user. Returns `{ reply, toolsUsed }`. PERSISTS NOTHING
 * (D3 ephemeral — the transcript lives in the client).
 *
 * Error honesty (the #43/#44/#144 anti-fail-open lesson): no configured provider → 400 with an
 * actionable message; a provider transport/HTTP failure → 502 (never a faked reply); a loop that hits
 * its caps without an answer returns a 200 with an HONEST bounded reply (handled in the orchestrator).
 *
 * SAX-04 input bound: the message + each history turn are length-capped, and the history window is
 * bounded, so the prompt sent to the provider cannot grow unbounded (cost + injection-surface guard).
 * The global rate-limiter (app.ts) already covers request-rate; the LLM cost lands on the user's own key.
 */

import { zValidator } from '@hono/zod-validator';
import { and, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import { getDb } from '../../db/connection';
import { userProviders } from '../../db/schema';
import { AppError, ValidationError } from '../../errors';
import { requireAuth } from '../../middleware';
import { logger } from '../../utils/logger';
import type { ChatMessage } from '../providers/domains/llm/llm-provider';
import { runAssistant } from '../providers/domains/llm/orchestrator';
import { getLlmProvider } from '../providers/domains/llm/registry';

const routes = new Hono();

routes.use('*', requireAuth);

/** SAX-04 input caps: a single message, each prior turn, and the transcript window are all bounded. */
const MAX_MESSAGE_CHARS = 2000;
const MAX_HISTORY_TURNS = 12;

const chatBodySchema = z.object({
  message: z.string().min(1, 'Message is required').max(MAX_MESSAGE_CHARS),
  history: z
    .array(
      z.object({
        // Only user/assistant turns are accepted from the client — tool turns are produced server-side
        // by the orchestrator and never trusted from the request.
        role: z.enum(['user', 'assistant']),
        content: z.string().max(MAX_MESSAGE_CHARS),
      })
    )
    .max(MAX_HISTORY_TURNS)
    .optional(),
});

/**
 * POST /api/v1/assistant/chat — answer a question over the user's own car data. PERSISTS NOTHING.
 * Body (json): { message, history? }.
 */
routes.post('/chat', zValidator('json', chatBodySchema), async (c) => {
  const user = c.get('user');
  const body = c.req.valid('json');
  const db = getDb();

  // 1) Resolve the user's enabled LLM provider. None → an actionable 400 (link to add one in Settings).
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

  // 2) Run the bounded tool-calling loop. The history is the client-sent prior turns (already bounded).
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
    // Surface a provider transport failure HONESTLY as a 502 (never a faked reply). Do NOT echo the api
    // key or the provider's raw error; the adapter already logged the detail.
    const message = err instanceof Error ? err.message : 'LLM provider error';
    logger.warn('Assistant chat failed', {
      providerType: providerRow.providerType,
      error: message,
    });
    throw new AppError('The assistant provider could not be reached. Try again.', 502);
  }
});

export { routes };
