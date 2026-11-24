import { Hono } from 'hono';
import { z } from 'zod';
import { CONFIG } from '../../config';
import { AppError } from '../../errors';
import { rateLimiter, requireAuth } from '../../middleware';
import { logger } from '../../utils/logger';
import { isValidTimeZone } from '../../utils/time-zone';
import { zValidator } from '../../utils/validation';
import type { ChatMessage } from '../providers/domains/llm/llm-provider';
import { runAssistant } from '../providers/domains/llm/orchestrator';
import { getLlmProvider } from '../providers/domains/llm/registry';
import { resolveProvider } from '../providers/resolve';

const routes = new Hono();

routes.use('*', requireAuth);

const assistantLimiter = rateLimiter({
  ...CONFIG.rateLimit.assistant,
  keyGenerator: (c) => `assistant:${c.get('user').id}`,
});

const MAX_MESSAGE_CHARS = 2000;
const MAX_HISTORY_TURNS = 12;

const chatBodySchema = z.object({
  message: z.string().min(1, 'Message is required').max(MAX_MESSAGE_CHARS),
  history: z
    .array(
      z.object({
        // Tool turns are server-produced; accepting them from the request would let a client inject tool results.
        role: z.enum(['user', 'assistant']),
        content: z.string().max(MAX_MESSAGE_CHARS),
      })
    )
    .max(MAX_HISTORY_TURNS)
    .optional(),
  timeZone: z.string().max(64).refine(isValidTimeZone, 'Unknown time zone').optional(),
});

routes.post('/chat', assistantLimiter, zValidator('json', chatBodySchema), async (c) => {
  const user = c.get('user');
  const body = c.req.valid('json');
  const providerRow = await resolveProvider(user.id, 'ai.llm');
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
      Date.now(),
      body.timeZone
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
