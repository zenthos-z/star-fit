/**
 * HTTP 客户端：走现有 REST API（issue #90 硬约束：不为 CLI 开新后端入口）。
 *
 * 鉴权头对齐 server.ts 现状：
 * - X-Access-Token：全局 STARFIT_ACCESS_TOKEN 门（设置了才校验；CLI 有 token 就带）
 * - X-User-Id：用户态端点（/api/schedule/* 等）必需，encodeURIComponent 编码
 *   （对齐前端 getHeaders 习惯，中文 display_name 不炸 header）
 *
 * 响应处理守契约红线「原始 JSON 透传」：JSON 体原样返回（unknown），
 * CLI 层不做任何字段裁剪/映射/重命名。
 */

export class ApiError extends Error {
  readonly status: number;
  readonly endpoint: string;
  readonly bodyText: string;

  constructor(status: number, endpoint: string, bodyText: string) {
    const detail = extractErrorMessage(bodyText) ?? bodyText.slice(0, 300);
    super(`HTTP ${status} ${endpoint}: ${detail}`);
    this.name = "ApiError";
    this.status = status;
    this.endpoint = endpoint;
    this.bodyText = bodyText;
  }
}

export class NetworkError extends Error {
  constructor(endpoint: string, cause: unknown) {
    const reason =
      cause instanceof Error ? cause.message : cause === undefined ? "?" : String(cause);
    super(`网络请求失败 ${endpoint}: ${reason}（检查 bridge config set server 指向与后端是否在线）`);
    this.name = "NetworkError";
  }
}

function extractErrorMessage(bodyText: string): string | undefined {
  try {
    const parsed: unknown = JSON.parse(bodyText);
    if (parsed !== null && typeof parsed === "object") {
      const err = (parsed as Record<string, unknown>)["error"];
      if (typeof err === "string") return err;
    }
  } catch {
    // 非 JSON 错误体，直接用原文
  }
  return undefined;
}

export interface RequestOptions {
  method?: "GET" | "POST" | "PUT" | "DELETE";
  /** 请求体（JSON 序列化） */
  body?: unknown;
  /** 附加 headers */
  headers?: Record<string, string>;
  /** 毫秒；默认 30000 */
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

export class BridgeClient {
  private readonly server: string;
  private readonly token: string;
  private readonly fetchImpl: typeof fetch;

  constructor(server: string, token: string, fetchImpl?: typeof fetch) {
    this.server = server.replace(/\/+$/, "");
    this.token = token;
    this.fetchImpl = fetchImpl ?? fetch;
  }

  /** 根级路径（/health 在根不在 /api 下） */
  rootUrl(path: string): string {
    return `${this.server}${path}`;
  }

  /** API 路径：自动补 /api 前缀（server 配了带 /api 的基址也不重复） */
  apiUrl(path: string): string {
    const base = /\/api$/.test(this.server) ? this.server : `${this.server}/api`;
    return `${base}${path}`;
  }

  async root(path: string, options: RequestOptions = {}): Promise<unknown> {
    return this.request(this.rootUrl(path), options);
  }

  async api(path: string, options: RequestOptions = {}): Promise<unknown> {
    return this.request(this.apiUrl(path), options);
  }

  private async request(url: string, options: RequestOptions): Promise<unknown> {
    const method = options.method ?? "GET";
    const headers: Record<string, string> = { ...options.headers };
    if (this.token.length > 0) headers["X-Access-Token"] = this.token;
    if (options.body !== undefined) headers["Content-Type"] = "application/json";

    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(),
      options.timeoutMs ?? 30_000,
    );
    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method,
        headers,
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        signal: controller.signal,
      });
    } catch (cause) {
      throw new NetworkError(`${method} ${shortUrl(url)}`, cause);
    } finally {
      clearTimeout(timer);
    }

    const text = await response.text();
    if (!response.ok) {
      throw new ApiError(response.status, `${method} ${shortUrl(url)}`, text);
    }
    if (text.length === 0) return null;
    try {
      return JSON.parse(text) as unknown;
    } catch {
      return text; // 非 JSON 响应原样返回（如 markdown 导出）
    }
  }
}

function shortUrl(url: string): string {
  try {
    const u = new URL(url);
    return `${u.pathname}${u.search}`;
  } catch {
    return url;
  }
}
