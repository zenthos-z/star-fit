/**
 * 结构化日志系统
 * 基于 pino 提供高性能、结构化的日志功能
 */

import pino from 'pino';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'fatal';

export interface LogContext {
  requestId?: string;
  userId?: string;
  action?: string;
  [key: string]: any;
}

/**
 * 统一的日志记录器接口
 *
 * 这个接口被整个代码库使用，包括：
 * - utils/logger.ts (pino 实现)
 * - services/mas/config/serviceRegistry.ts (控制台实现)
 * - 所有 MAS 服务
 *
 * 签名设计：
 * - debug/info/warn/fatal: (message, meta?)
 * - error: (message, error?, meta?) 或 (message, meta?)
 *
 * @example
 * ```typescript
 * logger.info('User logged in', { userId: '123' });
 * logger.error('Database error', error);
 * logger.error('Validation failed', { errors: ['name required'] });
 * logger.error('Request failed', error, { userId: '123' });
 * ```
 */
export interface Logger {
  debug(message: string, meta?: Record<string, unknown>): void;
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, errorOrMeta?: Error | unknown | Record<string, unknown>, meta?: Record<string, unknown>): void;
  fatal(message: string, errorOrMeta?: Error | unknown | Record<string, unknown>, meta?: Record<string, unknown>): void;
}

class PinoLogger implements Logger {
  private logger: pino.Logger;
  private context: LogContext = {};

  constructor() {
    const isDevelopment = process.env.NODE_ENV !== 'production';
    
    this.logger = pino({
      level: process.env.LOG_LEVEL || 'info',
      formatters: {
        level: (label) => {
          return { level: label };
        },
      },
      serializers: {
        error: pino.stdSerializers.err,
        req: pino.stdSerializers.req,
        res: pino.stdSerializers.res,
      },
      redact: {
        paths: [
          'req.headers.authorization',
          'req.headers.cookie',
          'password',
          'token',
          'secret',
          'apiKey',
        ],
        remove: true,
      },
      ...(isDevelopment && {
        transport: {
          target: 'pino-pretty',
          options: {
            colorize: true,
            translateTime: 'SYS:standard',
            ignore: 'pid,hostname',
          },
        },
      }),
    });
  }

  private buildMessage(message: string, context?: LogContext) {
    const mergedContext = { ...this.context, ...context };
    
    if (Object.keys(mergedContext).length > 0) {
      return { message, ...mergedContext };
    }
    
    return message;
  }

  debug(message: string, context?: LogContext): void {
    this.logger.debug(this.buildMessage(message, context));
  }

  info(message: string, context?: LogContext): void {
    this.logger.info(this.buildMessage(message, context));
  }

  warn(message: string, context?: LogContext): void {
    this.logger.warn(this.buildMessage(message, context));
  }

  error(message: string, errorOrMeta?: Error | unknown | Record<string, unknown>, meta?: Record<string, unknown>): void {
    // 处理两种调用模式：
    // 1. error(message, error, meta)
    // 2. error(message, meta) - meta 可包含 error 属性
    let errorContext: LogContext = {};

    if (errorOrMeta instanceof Error) {
      // 模式 1: errorOrMeta 是 Error 对象
      errorContext = {
        ...meta,
        error: {
          message: errorOrMeta.message,
          name: errorOrMeta.name,
          stack: errorOrMeta.stack,
        },
      };
    } else if (typeof errorOrMeta === 'object' && errorOrMeta !== null) {
      // 模式 2: errorOrMeta 是 meta 对象
      errorContext = errorOrMeta as LogContext;
    } else if (errorOrMeta !== undefined) {
      // 原始值
      errorContext = { error: errorOrMeta };
    }

    this.logger.error(this.buildMessage(message, errorContext));
  }

  fatal(message: string, errorOrMeta?: Error | unknown | Record<string, unknown>, meta?: Record<string, unknown>): void {
    // 处理两种调用模式：
    // 1. fatal(message, error, meta)
    // 2. fatal(message, meta) - meta 可包含 error 属性
    let errorContext: LogContext = {};

    if (errorOrMeta instanceof Error) {
      // 模式 1: errorOrMeta 是 Error 对象
      errorContext = {
        ...meta,
        error: {
          message: errorOrMeta.message,
          name: errorOrMeta.name,
          stack: errorOrMeta.stack,
        },
      };
    } else if (typeof errorOrMeta === 'object' && errorOrMeta !== null) {
      // 模式 2: errorOrMeta 是 meta 对象
      errorContext = errorOrMeta as LogContext;
    } else if (errorOrMeta !== undefined) {
      // 原始值
      errorContext = { error: errorOrMeta };
    }

    this.logger.fatal(this.buildMessage(message, errorContext));
  }

  setContext(context: LogContext): PinoLogger {
    this.context = { ...this.context, ...context };
    return this;
  }

  clearContext(): PinoLogger {
    this.context = {};
    return this;
  }

  child(context: LogContext): PinoLogger {
    const childLogger = new PinoLogger();
    childLogger.logger = this.logger.child(context);
    childLogger.context = { ...this.context, ...context };
    return childLogger;
  }
}

const logger = new PinoLogger();

export function setGlobalContext(context: LogContext): void {
  logger.setContext(context);
}

export function clearGlobalContext(): void {
  logger.clearContext();
}

export function createLogger(context?: LogContext): PinoLogger {
  return context ? logger.child(context) : logger;
}

export function getRequestLogger(requestId: string): PinoLogger {
  return logger.child({ requestId });
}

export default logger;
