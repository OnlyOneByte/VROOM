/**
 * Structured logging utility with log levels and specialized logging methods
 */

import { CONFIG } from '../config';

enum LogLevel {
  ERROR = 0,
  WARN = 1,
  INFO = 2,
  DEBUG = 3,
}

interface LogContext {
  userId?: string;
  requestId?: string;
  duration?: number;
  [key: string]: unknown;
}

/**
 * Depth bound on the `cause` chain walked by `serializeError`.
 *
 * A looping chain (`a.cause === b`, `b.cause === a`) would otherwise recurse until the stack
 * blows: JSON.stringify's own cycle detection cannot see it, because every level is rendered
 * into a freshly allocated plain object whose identity it has never visited.
 */
const MAX_CAUSE_DEPTH = 4;

interface SerializedError {
  name: string;
  message: string;
  stack?: string;
  cause?: unknown;
}

/**
 * Render an Error as a plain, JSON-serializable object.
 *
 * `message` and `stack` are non-enumerable own properties, so `JSON.stringify(err)` is `{}` —
 * without this, the one log line written to explain a failure says nothing about it. `cause` is
 * walked too because for a wrapped fetch/provider error that is where the real failure lives.
 */
function serializeError(error: Error, depth: number): SerializedError {
  const serialized: SerializedError = { name: error.name, message: error.message };
  if (error.stack) serialized.stack = error.stack;
  if (error.cause !== undefined) serialized.cause = serializeCause(error.cause, depth);
  return serialized;
}

function serializeCause(cause: unknown, depth: number): unknown {
  if (!(cause instanceof Error)) return cause;
  if (depth >= MAX_CAUSE_DEPTH) return '[cause chain truncated]';
  return serializeError(cause, depth + 1);
}

/**
 * Replacer applied to every value in a log context, at any nesting depth — an Error reached
 * through `{ provider: { error } }` must be as legible as a top-level `{ error }`. A bigint is
 * stringified because JSON.stringify throws on one, and a log call must never be what fails.
 */
function serializeLogValue(_key: string, value: unknown): unknown {
  if (value instanceof Error) return serializeError(value, 0);
  if (typeof value === 'bigint') return String(value);
  return value;
}

/**
 * Serialize a log context without ever throwing. The global error handler logs through here
 * while already handling a failure, so a context JSON cannot represent (a cyclic object) must
 * degrade to a readable marker rather than replace the original error with a serialization one.
 */
function stringifyContext(context: LogContext): string {
  try {
    return JSON.stringify(context, serializeLogValue);
  } catch {
    return '[log context could not be serialized]';
  }
}

class Logger {
  private level: LogLevel;

  constructor() {
    this.level = this.getLogLevel(CONFIG.logging.level);
  }

  private getLogLevel(level: string): LogLevel {
    const map: Record<string, LogLevel> = {
      error: LogLevel.ERROR,
      warn: LogLevel.WARN,
      info: LogLevel.INFO,
      debug: LogLevel.DEBUG,
    };
    return map[level] ?? LogLevel.INFO;
  }

  private shouldLog(level: LogLevel): boolean {
    return level <= this.level;
  }

  private formatMessage(level: string, message: string, context?: LogContext): string {
    const timestamp = new Date().toISOString();
    const contextStr = context ? ` ${stringifyContext(context)}` : '';
    return `[${timestamp}] [${level.toUpperCase()}] ${message}${contextStr}`;
  }

  error(message: string, context?: LogContext): void {
    if (this.shouldLog(LogLevel.ERROR)) {
      console.error(this.formatMessage('error', message, context));
    }
  }

  warn(message: string, context?: LogContext): void {
    if (this.shouldLog(LogLevel.WARN)) {
      console.warn(this.formatMessage('warn', message, context));
    }
  }

  info(message: string, context?: LogContext): void {
    if (this.shouldLog(LogLevel.INFO)) {
      console.info(this.formatMessage('info', message, context));
    }
  }

  debug(message: string, context?: LogContext): void {
    if (this.shouldLog(LogLevel.DEBUG)) {
      console.debug(this.formatMessage('debug', message, context));
    }
  }

  // Specialized logging methods (kept only the ones that are used)
  startup(message: string, context?: LogContext): void {
    this.info(`🚗 ${message}`, context);
  }

  shutdown(message: string, context?: LogContext): void {
    this.info(`🛑 ${message}`, context);
  }

  checkpoint(message: string, context?: LogContext): void {
    this.info(`🔄 ${message}`, context);
  }
}

export const logger = new Logger();
