/**
 * Guard for the ONE thing a log line about a failure has to carry: the failure.
 *
 * An Error's `message` and `stack` are non-enumerable own properties, so `JSON.stringify({ error })`
 * is `{"error":{}}`. The logger serializes its context with JSON.stringify, and ~25 call sites pass
 * an Error (or a value built from one) — including the global error handler's `logger.error('Server
 * error', { error: err })`, which is the only forensics a self-hosted operator has for an
 * unexpected 500. These tests pin that an Error survives serialization wherever it sits in the
 * context, that the `cause` chain comes with it, and that a context JSON cannot represent degrades
 * to a marker instead of throwing out of the log call.
 *
 * Pure: no DB, no server. Captures the console sink the logger writes to.
 */

import { describe, expect, test } from 'bun:test';
import { logger } from '../logger';

type LogMethod = 'error' | 'warn' | 'info';

/** Run `emit` with the matching console sink captured, returning the single line written. */
function captureLine(method: LogMethod, emit: () => void): string {
  const sinkName = method === 'error' ? 'error' : method === 'warn' ? 'warn' : 'info';
  const original = console[sinkName];
  const lines: string[] = [];
  console[sinkName] = (line: unknown) => {
    lines.push(String(line));
  };
  try {
    emit();
  } finally {
    console[sinkName] = original;
  }
  expect(lines).toHaveLength(1);
  return lines[0];
}

/** The logged line is `[ts] [LEVEL] message <json>` — return the parsed context object. */
function parseContext(line: string): Record<string, unknown> {
  const start = line.indexOf('{');
  expect(start, `no JSON context in log line: ${line}`).toBeGreaterThan(-1);
  return JSON.parse(line.slice(start)) as Record<string, unknown>;
}

interface LoggedError {
  name: string;
  message: string;
  stack?: string;
  cause?: unknown;
}

describe('logger context serialization', () => {
  test('a top-level Error keeps its name, message and stack', () => {
    const line = captureLine('error', () =>
      logger.error('Server error', { error: new Error('boom') })
    );

    expect(line).toContain('boom');
    const error = parseContext(line).error as LoggedError;
    expect(error.name).toBe('Error');
    expect(error.message).toBe('boom');
    expect(error.stack).toContain('boom');
    expect(error.stack).toContain('logger.test.ts');
  });

  test('an Error nested anywhere in the context is serialized too', () => {
    const line = captureLine('warn', () =>
      logger.warn('Provider sync failed', {
        provider: { id: 'p-1', failure: new TypeError('not a function') },
        attempts: [{ error: new RangeError('out of range') }],
      })
    );

    const context = parseContext(line);
    const provider = context.provider as { id: string; failure: LoggedError };
    expect(provider.id).toBe('p-1');
    expect(provider.failure.name).toBe('TypeError');
    expect(provider.failure.message).toBe('not a function');
    const attempts = context.attempts as { error: LoggedError }[];
    expect(attempts[0].error.message).toBe('out of range');
  });

  test('the cause chain travels with the error', () => {
    const line = captureLine('error', () =>
      logger.error('Backup failed', {
        error: new Error('upload failed', { cause: new Error('ECONNRESET') }),
      })
    );

    const error = parseContext(line).error as LoggedError;
    expect(error.message).toBe('upload failed');
    expect((error.cause as LoggedError).message).toBe('ECONNRESET');
  });

  test('a looping cause chain terminates instead of exhausting the stack', () => {
    // JSON.stringify cannot detect this cycle — each level is a freshly built plain object — so
    // the depth bound is the only thing between it and a RangeError inside the error handler.
    const outer = new Error('outer');
    const inner = new Error('inner', { cause: outer });
    (outer as { cause?: unknown }).cause = inner;

    const line = captureLine('error', () => logger.error('Server error', { error: outer }));

    expect(line).toContain('outer');
    expect(line).toContain('inner');
    expect(line).toContain('cause chain truncated');
  });

  test('a context JSON cannot represent degrades to a marker, not a throw', () => {
    const cyclic: Record<string, unknown> = { userId: 'u-1' };
    cyclic.self = cyclic;

    const line = captureLine('error', () => logger.error('Server error', cyclic));

    expect(line).toContain('[log context could not be serialized]');
  });

  test('plain context values keep their existing rendering', () => {
    const line = captureLine('info', () =>
      logger.info('Request complete', {
        userId: 'u-1',
        duration: 12,
        ok: true,
        at: new Date('2026-01-15T00:00:00.000Z'),
        big: 9007199254740993n,
      })
    );

    const context = parseContext(line);
    expect(context.userId).toBe('u-1');
    expect(context.duration).toBe(12);
    expect(context.ok).toBe(true);
    expect(context.at).toBe('2026-01-15T00:00:00.000Z');
    // JSON.stringify THROWS on a bigint, which would take the whole line down.
    expect(context.big).toBe('9007199254740993');
  });

  test('a context-free call logs just the message', () => {
    const line = captureLine('info', () => logger.info('Sync worker started'));
    expect(line).toEndWith('Sync worker started');
  });
});
