import type { Context } from 'hono';
import { ValidationError } from '../errors';

export async function readJsonBody<T = unknown>(c: Context): Promise<T> {
  try {
    return (await c.req.json()) as T;
  } catch {
    throw new ValidationError('Malformed JSON request body');
  }
}
