/**
 * APM 监控模块
 * 基于 Sentry 提供应用性能监控和错误追踪
 */

import * as Sentry from '@sentry/node';
import type { Breadcrumb, BreadcrumbHint, ErrorEvent, EventHint, Span } from '@sentry/types';
import type { FastifyRequest, FastifyReply } from 'fastify';
import { createLogger } from '../utils/logger.js';

const logger = createLogger({ component: 'APM' });

export type SentryOptions = {
  dsn: string;
  environment: string;
  release: string;
  tracesSampleRate?: number;
  profilesSampleRate?: number;
}

export function initSentry(options: SentryOptions): void {
  Sentry.init({
    dsn: options.dsn,
    environment: options.environment,
    release: options.release,
    tracesSampleRate: options.tracesSampleRate || 0.1,
    profilesSampleRate: options.profilesSampleRate || 0.1,
    
    integrations: [
      Sentry.httpIntegration(),
      Sentry.expressIntegration(),
      Sentry.nodeContextIntegration(),
      Sentry.mongoIntegration(),
    ],

    beforeSend(event: ErrorEvent, hint: EventHint) {
      if (event.request) {
        delete event.request.cookies;
        delete event.request.headers?.['authorization'];
        delete event.request.headers?.['cookie'];
      }

      if (event.user) {
        delete event.user.email;
        delete event.user.ip_address;
      }

      logger.debug('Sending event to Sentry', {
        eventId: event.event_id,
        level: event.level,
      });

      return event;
    },

    beforeBreadcrumb(breadcrumb: Breadcrumb, hint?: BreadcrumbHint) {
      if (breadcrumb.category === 'http') {
        if (breadcrumb.data?.url) {
          breadcrumb.data.url = sanitizeUrl(breadcrumb.data.url);
        }
        delete breadcrumb.data?.headers?.['authorization'];
        delete breadcrumb.data?.headers?.['cookie'];
      }

      return breadcrumb;
    },

    ignoreErrors: [
      'ResizeObserver loop limit exceeded',
      'Non-Error promise rejection captured',
      'Network Error',
    ],

    ignoreTransactions: [
      '/health',
      '/metrics',
      '/favicon.ico',
    ],
  });

  logger.info('Sentry initialized', {
    environment: options.environment,
    release: options.release,
  });
}

export function createSentryMiddleware() {
  return async function (req: FastifyRequest, reply: FastifyReply) {
    const transaction = Sentry.startSpan(
      {
        op: 'http.server',
        name: `${req.method} ${req.routeOptions.url}`,
      },
      async () => {
        Sentry.setUser({
          id: (req as any).user?.id,
          username: (req as any).user?.name,
        });

        Sentry.setContext('request', {
          method: req.method,
          url: req.url,
          userAgent: req.headers['user-agent'],
        });

        return await reply;
      }
    );
  };
}

export function captureException(error: Error, context?: Record<string, any>): void {
  logger.error('Capturing exception in Sentry', error, context);
  Sentry.captureException(error, {
    extra: context,
  });
}

export function captureMessage(message: string, level: 'info' | 'warning' | 'error' = 'info', context?: Record<string, any>): void {
  const loggerLevel = level === 'warning' ? 'warn' : level;
  (logger as any)[loggerLevel]('Capturing message in Sentry', { message, ...context });
  Sentry.captureMessage(message, {
    level,
    extra: context,
  });
}

export function setUser(user: { id: string; email?: string; username?: string }): void {
  logger.debug('Setting Sentry user', { userId: user.id });
  Sentry.setUser(user);
}

export function setTag(key: string, value: string): void {
  logger.debug('Setting Sentry tag', { key, value });
  Sentry.setTag(key, value);
}

export function setContext(key: string, context: Record<string, any>): void {
  logger.debug('Setting Sentry context', { key });
  Sentry.setContext(key, context);
}

export function addBreadcrumb(breadcrumb: {
  category?: string;
  message?: string;
  data?: Record<string, any>;
  level?: 'debug' | 'info' | 'warning' | 'error';
}): void {
  logger.debug('Adding Sentry breadcrumb', breadcrumb);
  Sentry.addBreadcrumb(breadcrumb);
}

export function withTransaction<T>(
  name: string,
  op: string,
  callback: (span: Span) => T
): T {
  return Sentry.startSpan(
    {
      name,
      op,
    },
    (span) => {
      logger.debug('Running Sentry transaction', { name, op });
      const result = callback(span);
      return result;
    }
  );
}

function sanitizeUrl(url: string): string {
  try {
    const urlObj = new URL(url);
    
    const sensitiveParams = ['token', 'password', 'secret', 'api_key', 'auth'];
    sensitiveParams.forEach((param) => {
      if (urlObj.searchParams.has(param)) {
        urlObj.searchParams.set(param, '***REDACTED***');
      }
    });

    return urlObj.toString();
  } catch {
    return url;
  }
}

export async function flush(): Promise<void> {
  logger.debug('Flushing Sentry events');
  await Sentry.flush(2000);
}

export async function close(): Promise<void> {
  logger.info('Closing Sentry client');
  await Sentry.close(2000);
}

export class PerformanceMonitor {
  private metrics: Map<string, number[]> = new Map();

  recordMetric(name: string, value: number): void {
    if (!this.metrics.has(name)) {
      this.metrics.set(name, []);
    }
    
    const values = this.metrics.get(name)!;
    values.push(value);
    
    if (values.length > 1000) {
      values.shift();
    }

    if (values.length % 100 === 0) {
      this.reportMetric(name);
    }
  }

  private reportMetric(name: string): void {
    const values = this.metrics.get(name);
    if (!values || values.length === 0) {
      return;
    }

    const avg = values.reduce((a, b) => a + b, 0) / values.length;
    const min = Math.min(...values);
    const max = Math.max(...values);

    logger.debug('Performance metric', { name, avg, min, max, count: values.length });
  }

  getMetrics(): Record<string, { avg: number; min: number; max: number; count: number }> {
    const result: Record<string, { avg: number; min: number; max: number; count: number }> = {};

    for (const [name, values] of this.metrics.entries()) {
      if (values.length === 0) continue;

      result[name] = {
        avg: values.reduce((a, b) => a + b, 0) / values.length,
        min: Math.min(...values),
        max: Math.max(...values),
        count: values.length,
      };
    }

    return result;
  }

  reset(): void {
    this.metrics.clear();
    logger.debug('Performance metrics reset');
  }
}

export const performanceMonitor = new PerformanceMonitor();
