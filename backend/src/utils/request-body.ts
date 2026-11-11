/**
 * Request-body reader for the handful of routes that parse JSON themselves.
 */

import type { Context } from 'hono';
import { ValidationError } from '../errors';

/**
 * Read and JSON-parse a request body, reporting a malformed one as the client error it is.
 *
 * `c.req.json()` throws a bare SyntaxError, which matches no branch of the global error handler and
 * so lands on the generic 500 "An internal error occurred" — a server-error class for the client's
 * own truncated or hand-built body, plus an unactionable line in the error log. The handler
 * deliberately does NOT classify SyntaxError centrally: several live paths `JSON.parse` a decrypted
 * provider credential, where a SyntaxError means a mis-keyed server and really is a 500. So the
 * narrow translation belongs here, at the request boundary. Routes that validate with
 * `zValidator('json', ...)` already get the same 400 from Hono's own validator.
 *
 * The type parameter mirrors `c.req.json<T>()`: the caller declares the shape it then validates.
 *
 * @throws ValidationError — a 400 — when the body is absent or not valid JSON.
 */
export async function readJsonBody<T = unknown>(c: Context): Promise<T> {
  try {
    return (await c.req.json()) as T;
  } catch {
    throw new ValidationError('Malformed JSON request body');
  }
}
