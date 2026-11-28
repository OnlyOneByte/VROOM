import type { Server } from 'bun';
import type { Context, Next } from 'hono';

export function noIdleTimeout() {
  return async (c: Context, next: Next) => {
    (c.env as Pick<Server<unknown>, 'timeout'> | undefined)?.timeout?.(c.req.raw, 0);
    return next();
  };
}
