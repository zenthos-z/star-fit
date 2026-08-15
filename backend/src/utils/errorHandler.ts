/**
 * 统一错误处理模块
 * 提供标准化的错误类和错误处理函数
 */

export class AppError extends Error {
  public readonly code: string;
  public readonly statusCode: number;
  public readonly context?: any;
  public readonly isOperational: boolean;

  constructor(
    message: string,
    code: string,
    statusCode: number = 500,
    context?: any,
    isOperational: boolean = true
  ) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.statusCode = statusCode;
    this.context = context;
    this.isOperational = isOperational;
    
    Error.captureStackTrace(this, this.constructor);
  }

  toJSON() {
    return {
      name: this.name,
      message: this.message,
      code: this.code,
      statusCode: this.statusCode,
      context: this.context,
    };
  }
}

export class ValidationError extends AppError {
  constructor(message: string, field?: string, context?: any) {
    super(
      message,
      'VALIDATION_ERROR',
      400,
      { field, ...context },
      true
    );
    this.name = 'ValidationError';
  }
}

export class NotFoundError extends AppError {
  constructor(resource: string, id: string, context?: any) {
    super(
      `${resource} with id '${id}' not found`,
      'NOT_FOUND',
      404,
      { resource, id, ...context },
      true
    );
    this.name = 'NotFoundError';
  }
}

export class ConflictError extends AppError {
  constructor(message: string, context?: any) {
    super(message, 'CONFLICT', 409, context, true);
    this.name = 'ConflictError';
  }
}

export class UnauthorizedError extends AppError {
  constructor(message: string = 'Unauthorized', context?: any) {
    super(message, 'UNAUTHORIZED', 401, context, true);
    this.name = 'UnauthorizedError';
  }
}

export class ForbiddenError extends AppError {
  constructor(message: string = 'Forbidden', context?: any) {
    super(message, 'FORBIDDEN', 403, context, true);
    this.name = 'ForbiddenError';
  }
}

export class DatabaseError extends AppError {
  constructor(message: string, operation: string, context?: any) {
    super(
      message,
      'DATABASE_ERROR',
      500,
      { operation, ...context },
      true
    );
    this.name = 'DatabaseError';
  }
}

export class ExternalServiceError extends AppError {
  constructor(service: string, message: string, context?: any) {
    super(
      `External service '${service}' error: ${message}`,
      'EXTERNAL_SERVICE_ERROR',
      502,
      { service, ...context },
      true
    );
    this.name = 'ExternalServiceError';
  }
}

export class ConfigurationError extends AppError {
  constructor(message: string, key?: string, context?: any) {
    super(
      message,
      'CONFIGURATION_ERROR',
      500,
      { key, ...context },
      true
    );
    this.name = 'ConfigurationError';
  }
}

export type ErrorResponseType = {
  error: string;
  code: string;
  statusCode: number;
  context?: any;
  stack?: string;
};

export function createErrorResponse(error: unknown): ErrorResponseType {
  if (error instanceof AppError) {
    const response: ErrorResponseType = {
      error: error.message,
      code: error.code,
      statusCode: error.statusCode,
      context: error.context,
    };
    
    if (process.env.NODE_ENV !== 'production') {
      response.stack = error.stack;
    }
    
    return response;
  }

  if (error instanceof Error) {
    return {
      error: error.message,
      code: 'INTERNAL_ERROR',
      statusCode: 500,
      stack: process.env.NODE_ENV !== 'production' ? error.stack : undefined,
    };
  }

  return {
    error: 'An unknown error occurred',
    code: 'UNKNOWN_ERROR',
    statusCode: 500,
  };
}

export function isOperationalError(error: unknown): boolean {
  if (error instanceof AppError) {
    return error.isOperational;
  }
  return false;
}

export async function handleError(error: unknown, context?: any): Promise<void> {
  const logger = (await import('./logger.js')).default;
  
  if (error instanceof AppError) {
    if (error.statusCode >= 500) {
      logger.error('Operational error occurred', {
        code: error.code,
        message: error.message,
        statusCode: error.statusCode,
        context: error.context,
        stack: error.stack,
        ...context,
      });
    } else {
      logger.warn('Operational error occurred', {
        code: error.code,
        message: error.message,
        statusCode: error.statusCode,
        context: error.context,
        ...context,
      });
    }
  } else if (error instanceof Error) {
    logger.error('Unexpected error occurred', {
      message: error.message,
      stack: error.stack,
      ...context,
    });
  } else {
    logger.error('Unknown error type', {
      error: String(error),
      ...context,
    });
  }
}

export function handleAsyncErrors(fn: Function) {
  return (req: any, res: any, next: any) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

export function wrapAsync<T extends (...args: any[]) => Promise<any>>(
  fn: T
): (...args: Parameters<T>) => Promise<ReturnType<T>> {
  return async (...args: Parameters<T>) => {
    try {
      return await fn(...args);
    } catch (error) {
      await handleError(error, { function: fn.name, args });
      throw error;
    }
  };
}
