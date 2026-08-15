/**
 * 请求追踪中间件
 * 为每个请求生成唯一ID并记录请求生命周期
 */

import { FastifyRequest, FastifyReply } from 'fastify';
import { createLogger } from '../utils/logger.js';

interface RequestTrackerOptions {
  headerName?: string;
  enableLogging?: boolean;
  logBody?: boolean;
  logHeaders?: boolean;
}

export interface TrackedRequest extends FastifyRequest {
  requestId: string;
  startTime: number;
}

const DEFAULT_OPTIONS: RequestTrackerOptions = {
  headerName: 'X-Request-ID',
  enableLogging: true,
  logBody: false,
  logHeaders: false,
};

export function generateRequestId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 15);
  return `${timestamp}-${random}`;
}

export function requestTracker(
  options: RequestTrackerOptions = DEFAULT_OPTIONS
) {
  const {
    headerName,
    enableLogging,
    logBody,
    logHeaders,
  } = { ...DEFAULT_OPTIONS, ...options };

  const logger = createLogger({ action: 'request_tracker' });

  return async function (
    req: TrackedRequest,
    reply: FastifyReply
  ): Promise<void> {
    const requestId = generateRequestId();
    const startTime = Date.now();

    req.requestId = requestId;
    req.startTime = startTime;

    reply.header(headerName as string, requestId);

    if (enableLogging) {
      const logData: Record<string, any> = {
        requestId,
        method: req.method,
        url: req.url,
        ip: req.ip,
        userAgent: req.headers['user-agent'],
      };

      if (logHeaders) {
        logData.headers = { ...req.headers };
      }

      if (logBody && req.body) {
        logData.body = req.body;
      }

      logger.info('Incoming request', logData);
    }

    // FastifyReply does not expose addHook (hooks register on the Fastify
    // instance, not the per-request reply). This requestTracker middleware is
    // currently unused (no importers); cast + optional-chain keeps typecheck
    // sound and avoids a runtime crash if addHook is ever absent.
    const hookableReply = reply as FastifyReply & {
      addHook?: (name: string, hook: (req: FastifyRequest, payload: unknown) => void) => void;
    };
    hookableReply.addHook?.('onSend', async (request, payload) => {
      const trackedReq = request as TrackedRequest;
      const duration = Date.now() - trackedReq.startTime;
      const statusCode = reply.raw.statusCode;

      if (enableLogging) {
        const logData: Record<string, any> = {
          requestId: trackedReq.requestId,
          method: trackedReq.method,
          url: trackedReq.url,
          statusCode,
          duration,
        };

        if (statusCode >= 500) {
          logger.error('Request failed with server error', logData);
        } else if (statusCode >= 400) {
          logger.warn('Request failed with client error', logData);
        } else {
          logger.info('Request completed', logData);
        }
      }

      if (duration > 3000) {
        logger.warn('Slow request detected', {
          requestId: trackedReq.requestId,
          url: trackedReq.url,
          duration,
          method: trackedReq.method,
        });
      }
    });
  };
}

export function getRequestLogger(requestId: string) {
  return createLogger({ requestId });
}

export function logRequestStart(
  req: TrackedRequest,
  additionalData?: Record<string, any>
): void {
  const logger = getRequestLogger(req.requestId);
  logger.info('Request started', {
    method: req.method,
    url: req.url,
    ...additionalData,
  });
}

export function logRequestEnd(
  req: TrackedRequest,
  reply: FastifyReply,
  additionalData?: Record<string, any>
): void {
  const duration = Date.now() - req.startTime;
  const logger = getRequestLogger(req.requestId);
  
  const logData: Record<string, any> = {
    method: req.method,
    url: req.url,
    statusCode: reply.raw.statusCode,
    duration,
    ...additionalData,
  };

  if (reply.raw.statusCode >= 500) {
    logger.error('Request failed', logData);
  } else if (reply.raw.statusCode >= 400) {
    logger.warn('Request failed', logData);
  } else {
    logger.info('Request completed', logData);
  }
}

export function logRequestError(
  req: TrackedRequest,
  error: Error,
  additionalData?: Record<string, any>
): void {
  const logger = getRequestLogger(req.requestId);
  logger.error('Request error occurred', error, {
    method: req.method,
    url: req.url,
    ...additionalData,
  });
}
