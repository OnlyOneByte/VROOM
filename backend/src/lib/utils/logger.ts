/**
 * Structured logging utility with log levels and specialized logging methods
 */

import { config } from '../core/config';

export enum LogLevel {
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

class Logger {
  private level: LogLevel;

  constructor() {
    this.level = this.getLogLevel(config.logging.level);
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
    const contextStr = context ? ` ${JSON.stringify(context)}` : '';
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

  // Specialized logging methods
  http(method: string, path: string, status: number, duration: number, userId?: string): void {
    const level = status >= 500 ? 'error' : status >= 400 ? 'warn' : 'info';
    this[level](`${method} ${path} - ${status}`, { duration, userId });
  }

  database(operation: string, table: string, duration: number, error?: Error): void {
    if (error) {
      this.error(`DB ${operation} on ${table} failed`, { duration, error: error.message });
    } else {
      this.debug(`DB ${operation} on ${table}`, { duration });
    }
  }

  auth(event: string, userId?: string, success = true): void {
    const level = success ? 'info' : 'warn';
    this[level](`Auth: ${event}`, { userId, success });
  }

  external(service: string, operation: string, success: boolean, duration?: number): void {
    const level = success ? 'info' : 'error';
    this[level](`External ${service}: ${operation}`, { success, duration });
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

  test(message: string, context?: LogContext): void {
    this.info(`🧪 ${message}`, context);
  }
}

export const logger = new Logger();
