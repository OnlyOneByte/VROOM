import { config } from './config';

export enum LogLevel {
  ERROR = 0,
  WARN = 1,
  INFO = 2,
  DEBUG = 3,
}

const LOG_LEVEL_MAP: Record<string, LogLevel> = {
  error: LogLevel.ERROR,
  warn: LogLevel.WARN,
  info: LogLevel.INFO,
  debug: LogLevel.DEBUG,
};

class Logger {
  private level: LogLevel;

  constructor() {
    this.level = LOG_LEVEL_MAP[config.logging.level] ?? LogLevel.INFO;
  }

  private shouldLog(level: LogLevel): boolean {
    return level <= this.level;
  }

  private formatMessage(level: string, message: string, meta?: unknown): string {
    const timestamp = new Date().toISOString();
    const prefix = `[${timestamp}] ${level.toUpperCase()}:`;

    if (meta) {
      return `${prefix} ${message} ${JSON.stringify(meta, null, 2)}`;
    }

    return `${prefix} ${message}`;
  }

  error(message: string, meta?: unknown): void {
    if (this.shouldLog(LogLevel.ERROR)) {
      console.error(this.formatMessage('error', message, meta));
    }
  }

  warn(message: string, meta?: unknown): void {
    if (this.shouldLog(LogLevel.WARN)) {
      console.warn(this.formatMessage('warn', message, meta));
    }
  }

  info(message: string, meta?: unknown): void {
    if (this.shouldLog(LogLevel.INFO)) {
      console.info(this.formatMessage('info', message, meta));
    }
  }

  debug(message: string, meta?: unknown): void {
    if (this.shouldLog(LogLevel.DEBUG)) {
      console.debug(this.formatMessage('debug', message, meta));
    }
  }

  // Convenience methods for common scenarios
  request(method: string, path: string, statusCode: number, duration?: number): void {
    const message = `${method} ${path} - ${statusCode}`;
    const meta = duration ? { duration: `${duration}ms` } : undefined;

    if (statusCode >= 500) {
      this.error(message, meta);
    } else if (statusCode >= 400) {
      this.warn(message, meta);
    } else {
      this.info(message, meta);
    }
  }

  database(operation: string, table: string, duration?: number): void {
    const message = `DB ${operation} on ${table}`;
    const meta = duration ? { duration: `${duration}ms` } : undefined;
    this.debug(message, meta);
  }

  auth(event: string, userId?: string, details?: unknown): void {
    const message = `Auth: ${event}`;
    const meta = { userId, ...(details && typeof details === 'object' ? details : { details }) };
    this.info(message, meta);
  }

  external(service: string, operation: string, success: boolean, duration?: number): void {
    const message = `External ${service}: ${operation} - ${success ? 'SUCCESS' : 'FAILED'}`;
    const meta = duration ? { duration: `${duration}ms` } : undefined;

    if (success) {
      this.info(message, meta);
    } else {
      this.error(message, meta);
    }
  }
}

// Export singleton instance
export const logger = new Logger();

// Export for testing
export { Logger };
