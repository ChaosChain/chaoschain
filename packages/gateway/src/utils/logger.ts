/**
 * Structured Logger
 * 
 * Minimal logger with workflow ID context.
 * Uses JSON format for production, pretty format for dev.
 */

export interface LogContext {
  workflowId?: string;
  [key: string]: unknown;
}

export interface Logger {
  info(context: LogContext, message: string): void;
  warn(context: LogContext, message: string): void;
  error(context: LogContext, message: string): void;
  debug(context: LogContext, message: string): void;
  child(context: LogContext): Logger;
}

// =============================================================================
// JSON LOGGER IMPLEMENTATION
// =============================================================================

export class JsonLogger implements Logger {
  private context: LogContext;
  private level: 'debug' | 'info' | 'warn' | 'error';

  constructor(
    context: LogContext = {},
    level: 'debug' | 'info' | 'warn' | 'error' = 'info'
  ) {
    this.context = context;
    this.level = level;
  }

  private shouldLog(level: 'debug' | 'info' | 'warn' | 'error'): boolean {
    const levels = ['debug', 'info', 'warn', 'error'];
    return levels.indexOf(level) >= levels.indexOf(this.level);
  }

  private log(
    level: 'debug' | 'info' | 'warn' | 'error',
    context: LogContext,
    message: string
  ): void {
    if (!this.shouldLog(level)) return;

    const entry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      ...this.context,
      ...context,
    };

    // Remove undefined values
    const cleaned = Object.fromEntries(
      Object.entries(entry).filter(([_, v]) => v !== undefined)
    );

    // Serialize errors
    if (cleaned.error && typeof cleaned.error === 'object' && 'message' in cleaned.error) {
      const err = cleaned.error as Error;
      (cleaned as Record<string, unknown>).error = {
        name: err.name,
        message: err.message,
        stack: err.stack,
      };
    }

    console.log(JSON.stringify(cleaned));
  }

  info(context: LogContext, message: string): void {
    this.log('info', context, message);
  }

  warn(context: LogContext, message: string): void {
    this.log('warn', context, message);
  }

  error(context: LogContext, message: string): void {
    this.log('error', context, message);
  }

  debug(context: LogContext, message: string): void {
    this.log('debug', context, message);
  }

  child(context: LogContext): Logger {
    return new JsonLogger({ ...this.context, ...context }, this.level);
  }
}

// =============================================================================
// FACTORY
// =============================================================================

export function createLogger(
  options?: {
    level?: 'debug' | 'info' | 'warn' | 'error';
    service?: string;
  }
): Logger {
  return new JsonLogger(
    { service: options?.service ?? 'gateway' },
    options?.level ?? 'info'
  );
}
