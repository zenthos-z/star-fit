/**
 * 服务错误基类
 * 参考: 07-service-template.md Section 1.2
 *
 * @version 1.0.0
 * @created 2026-02-03
 *
 * R9 (L002): verbatim migration of this class out of the removed MAS runtime.
 * Class signature, export form, and ServiceErrorCode enum are unchanged — only the
 * file location moved so the repository layer (GOLD consumer) keeps compiling.
 * No semantic changes.
 */

/**
 * 服务错误基类
 *
 * 所有服务层抛出的错误都应该继承此类
 * 提供统一的错误处理和日志记录接口
 *
 * @example
 * ```typescript
 * throw new ServiceError(
 *   'PROFILE_NOT_FOUND',
 *   `User profile not found: ${userId}`,
 *   { userId }
 * );
 * ```
 */
export class ServiceError extends Error {
  /**
   * 创建服务错误实例
   *
   * @param code 错误码（用于程序判断）
   * @param message 错误消息（用于日志记录）
   * @param details 错误详情（可选，用于调试）
   */
  constructor(
    public readonly code: string,
    message: string,
    public readonly details?: unknown
  ) {
    super(message);
    this.name = 'ServiceError';

    // 维护正确的堆栈跟踪（仅在 V8 引擎中有效）
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, ServiceError);
    }
  }

  /**
   * 转换为 JSON 对象（用于日志记录）
   *
   * @returns JSON 对象
   */
  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      details: this.details
    };
  }
}

/**
 * 预定义错误码
 *
 * 错误码命名规范:
 * - 使用 UPPER_SNAKE_CASE
 * - 使用描述性名称
 * - 按类别分组
 */
export enum ServiceErrorCode {
  // ==================== 通用错误 ====================
  /** 未知错误 */
  UNKNOWN_ERROR = 'UNKNOWN_ERROR',

  /** 参数无效 */
  INVALID_PARAMS = 'INVALID_PARAMS',

  /** 操作不支持 */
  NOT_SUPPORTED = 'NOT_SUPPORTED',

  // ==================== 数据库错误 ====================
  /** 数据库错误 */
  DATABASE_ERROR = 'DATABASE_ERROR',

  /** 资源未找到 */
  NOT_FOUND = 'NOT_FOUND',

  /** 资源已存在 */
  ALREADY_EXISTS = 'ALREADY_EXISTS',

  /** 并发冲突 */
  CONFLICT = 'CONFLICT',

  // ==================== 业务错误 ====================
  /** 验证失败 */
  VALIDATION_ERROR = 'VALIDATION_ERROR',

  /** 业务规则违反 */
  BUSINESS_RULE_VIOLATION = 'BUSINESS_RULE_VIOLATION',

  /** 权限不足 */
  PERMISSION_DENIED = 'PERMISSION_DENIED',

  // ==================== AI 模型错误 ====================
  /** AI 模型错误 */
  AI_MODEL_ERROR = 'AI_MODEL_ERROR',

  /** AI 模型超时 */
  AI_MODEL_TIMEOUT = 'AI_MODEL_TIMEOUT',

  /** AI 响应解析失败 */
  AI_RESPONSE_PARSE_ERROR = 'AI_RESPONSE_PARSE_ERROR',

  // ==================== 外部服务错误 ====================
  /** 外部服务错误 */
  EXTERNAL_SERVICE_ERROR = 'EXTERNAL_SERVICE_ERROR',

  /** 网络错误 */
  NETWORK_ERROR = 'NETWORK_ERROR',

  // ==================== 功能开关错误 ====================
  /** 功能已禁用 */
  FEATURE_DISABLED = 'FEATURE_DISABLED',

  /** 工具执行错误 */
  TOOL_EXECUTION_ERROR = 'TOOL_EXECUTION_ERROR'
}

/**
 * 创建预定义的服务错误
 *
 * @param code 错误码
 * @param message 错误消息（可选，使用默认消息）
 * @param details 错误详情（可选）
 * @returns 服务错误实例
 *
 * @example
 * ```typescript
 * throw createServiceError(ServiceErrorCode.NOT_FOUND, 'User not found', { userId });
 * ```
 */
export function createServiceError(
  code: ServiceErrorCode,
  message?: string,
  details?: unknown
): ServiceError {
  const defaultMessages: Record<ServiceErrorCode, string> = {
    [ServiceErrorCode.UNKNOWN_ERROR]: 'An unknown error occurred',
    [ServiceErrorCode.INVALID_PARAMS]: 'Invalid parameters provided',
    [ServiceErrorCode.NOT_SUPPORTED]: 'Operation not supported',
    [ServiceErrorCode.DATABASE_ERROR]: 'Database operation failed',
    [ServiceErrorCode.NOT_FOUND]: 'Resource not found',
    [ServiceErrorCode.ALREADY_EXISTS]: 'Resource already exists',
    [ServiceErrorCode.CONFLICT]: 'Concurrent modification conflict',
    [ServiceErrorCode.VALIDATION_ERROR]: 'Validation failed',
    [ServiceErrorCode.BUSINESS_RULE_VIOLATION]: 'Business rule violation',
    [ServiceErrorCode.PERMISSION_DENIED]: 'Permission denied',
    [ServiceErrorCode.AI_MODEL_ERROR]: 'AI model operation failed',
    [ServiceErrorCode.AI_MODEL_TIMEOUT]: 'AI model operation timed out',
    [ServiceErrorCode.AI_RESPONSE_PARSE_ERROR]: 'Failed to parse AI response',
    [ServiceErrorCode.EXTERNAL_SERVICE_ERROR]: 'External service error',
    [ServiceErrorCode.NETWORK_ERROR]: 'Network operation failed',
    [ServiceErrorCode.FEATURE_DISABLED]: 'Required feature is disabled',
    [ServiceErrorCode.TOOL_EXECUTION_ERROR]: 'Tool execution failed'
  };

  return new ServiceError(code, message || defaultMessages[code], details);
}

/**
 * 检查错误是否为服务错误
 *
 * @param error 错误对象
 * @returns 是否为服务错误
 */
export function isServiceError(error: unknown): error is ServiceError {
  return error instanceof ServiceError;
}

/**
 * 包装未知错误为服务错误
 *
 * @param error 未知错误
 * @param defaultCode 默认错误码
 * @returns 服务错误
 */
export function wrapError(error: unknown, defaultCode: ServiceErrorCode = ServiceErrorCode.UNKNOWN_ERROR): ServiceError {
  if (isServiceError(error)) {
    return error;
  }

  if (error instanceof Error) {
    return new ServiceError(
      defaultCode,
      error.message,
      { originalError: error.name, stack: error.stack }
    );
  }

  return new ServiceError(
    defaultCode,
    String(error),
    { originalError: error }
  );
}
