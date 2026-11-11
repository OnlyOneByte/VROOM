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

// Bounds the cause walk. A cyclic cause chain would recurse forever, because JSON.stringify cycle
// detection never sees the freshly built objects.
const MAX_CAUSE_DEPTH = 4;

interface SerializedError {
  name: string;
  message: string;
  stack?: string;
  cause?: unknown;
}

// message and stack are non-enumerable, so JSON.stringify would otherwise render an Error as {}.
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

// Applied at every nesting depth. bigint is stringified because JSON.stringify throws on it.
function serializeLogValue(_key: string, value: unknown): unknown {
  if (value instanceof Error) return serializeError(value, 0);
  if (typeof value === 'bigint') return String(value);
  return value;
}

// Never throws: this runs while an error is already being handled, so a serialization failure must
// not replace it.
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
