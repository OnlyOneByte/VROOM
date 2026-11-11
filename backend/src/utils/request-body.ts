import type { Context } from 'hono';
import { ValidationError } from '../errors';

// A bare SyntaxError from c.req.json() would become a 500. The global handler cannot classify
// SyntaxError centrally, because JSON.parse of a decrypted provider credential failing is a genuine
// server fault.
export async function readJsonBody<T = unknown>(c: Context): Promise<T> {
  try {
    return (await c.req.json()) as T;
  } catch {
    throw new ValidationError('Malformed JSON request body');
  }
}
