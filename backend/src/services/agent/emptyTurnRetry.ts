/**
 * emptyTurnRetry — 空终步检测 + 模型重滚自动接续（refs #110 #111，#112）。
 *
 * 从 DeepAgentService 拆出的独立模块（2026-10-03）：框架裁剪中间件 + 空终步
 * 谓词 + 带标识错误。拆分原因与 splitLeakedReasoning 同款——DeepAgentService
 * 顶层 import 链含 skillLoader 的 import.meta，jest CJS 无法加载整条链，而
 * 本模块只依赖 langchain / deepagents / @langchain/core（jest 下均可加载，
 * 已探针实证），使 #112 的核心语义（三条件谓词 / 重滚一次 / abort 守卫 /
 * EmptyAgentTurnError）能在 `npm run test:unit`（jest，tests/unit/**）里
 * 被直接测试。
 *
 * 背景（#110 诊断 + #111 复现矩阵，均已合 main）：GLM OpenAI 兼容端点偶发
 * 整轮流式 delta 全程不带 role → @langchain/openai 转换层对 role 缺省的
 * delta 构造 ChatMessageChunk（构造器不接收 additional_kwargs）→ tool_calls
 * 增量被静默丢弃 → 聚合体 content=''、零 tool_calls → LangGraph 视为合法
 * 终步 → 整轮空输出，用户端「正在解析数据…」死占位。1.5.13/1.6.2 双版
 * BUG，上游无修复可等。
 */

import { AIMessageChunk, SystemMessage } from "@langchain/core/messages";
import {
  createMiddleware,
  TODO_LIST_MIDDLEWARE_SYSTEM_PROMPT,
} from "langchain";
import { TASK_SYSTEM_PROMPT } from "deepagents";

import type { AgentEvent } from "shared/contracts";

// ---------------------------------------------------------------------------
// 框架死重裁剪（42b，issue #42）
// ---------------------------------------------------------------------------

/**
 * 本项目零使用的 deepagents 框架件（grep 全仓验证，2026-09-28）：subagent
 * （task 工具 + general-purpose 子智能体 + TASK_SYSTEM_PROMPT 2,194 字符）与
 * todo（write_todos 工具 + todo 系统提示）。单 Agent 架构（修订①）下两者均
 * 无调用方；general-purpose 子智能体只能经 task 工具触达，工具不入上下文即
 * 不可达。edit_file/write_file 在 GOLD 只读权限下（skillLoader permissions
 * 仅 read）本就无法执行，但框架只挡执行不挡展示——schema 仍占上下文，一并裁。
 * read_file / grep / glob / ls 保留（progressive disclosure 的技能正文依赖它们）。
 *
 * 实现机制：deepagents 的 createDeepAgent 不暴露关闭这两个默认中间件的参数，
 * 且 SubAgentMiddleware 属于 REQUIRED_MIDDLEWARE_NAMES 不可排除；但自定义
 * middleware 在数组末位 = wrapModelCall 链最内层，晚于全部框架注入执行——
 * 在此把裁剪目标从最终请求里摘除（与库自身 _ToolExclusionMiddleware 同款手法）。
 * 若未来 deepagents 升级改变注入文本/工具名，断言测试（tests + probe）会红。
 */
const FRAMEWORK_TRIM_TOOL_NAMES: ReadonlySet<string> = new Set([
  "task",
  "write_todos",
  "edit_file",
  "write_file",
]);

/**
 * 框架裁剪 + 空终步重滚中间件（#112 落点）。导出给 DeepAgentService 组装与
 * 探针（scripts/system-area-probe.mjs）复用同一份裁剪逻辑测量 AFTER 口径；
 * jest 语义测试见 tests/unit/services/agent/emptyTurnRetry.test.ts。
 */
export const frameworkTrimMiddleware = createMiddleware({
  name: "frameworkDeadweightTrim",
  wrapModelCall: async (request, handler) => {
    const tools = (request.tools ?? []).filter(
      (t) => !FRAMEWORK_TRIM_TOOL_NAMES.has((t as { name: string }).name),
    );
    const text = request.systemMessage?.text ?? "";
    // 两种 join 形态都剥（探针实测 2026-09-28）：todoListMiddleware 以
    // "\n\n" + 常量全文 concat；SubAgentMiddleware 把 TASK_SYSTEM_PROMPT
    // 无分隔符直拼在文末（紧贴 filesystem 工具清单，不带 \n\n）。
    // 常量为 2,000+ 字符的独有 blob，裸 replace 无误伤风险。
    const trimmed = text
      .replace(`\n\n${TASK_SYSTEM_PROMPT}`, "")
      .replace(TASK_SYSTEM_PROMPT, "")
      .replace(`\n\n${TODO_LIST_MIDDLEWARE_SYSTEM_PROMPT}`, "")
      .replace(TODO_LIST_MIDDLEWARE_SYSTEM_PROMPT, "");
    const touched = tools.length !== (request.tools ?? []).length;
    const req2 =
      touched || trimmed !== text
        ? {
            ...request,
            tools,
            ...(trimmed !== text
              ? { systemMessage: new SystemMessage(trimmed) }
              : null),
          }
        : request;
    const startedAt = Date.now();
    const res = await handler(req2);
    // GLM 的 OpenAI 兼容流偶发尾包（空 content / 无 role 的末 chunk）会把聚合
    // 结果映射成 ChatMessageChunk —— 它不是 AIMessage 子类，AgentNode 的
    // wrapModelCall 返回值校验（AIMessage|Command|structuredResponse）会以
    // "got object" 拒绝（2026-09-28 E2E 实测 2/4 轮命中，与 llm.ts 注释里
    // maxTokens 规避的 args 截断是同族 provider 互操作问题）。本中间件位于
    // wrapModelCall 链最内层、最先见到模型返回——在此把字段同构的
    // ChatMessageChunk 重水化回 AIMessageChunk，语义零改动，只补类型。
    //
    // ★空终步检测 + 模型重滚自动接续（refs #110 #111，2026-10-03 #112）：
    // @langchain/openai 对「全程无 role」的 GLM 异常流走 else 分支构造
    // ChatMessageChunk（不接收 additional_kwargs）→ tool_calls 增量在 chunk
    // 转换层被静默丢弃 → 聚合体 content=''、零 tool_calls → LangGraph 视为
    // 合法终步 → 整轮空输出。重水化救不回从未进入实例属性的字段（#111
    // T1.1 三重实锤，1.5.13/1.6.2 双版 BUG、上游无修复）。在此就地重滚一次
    // 模型调用（同 messages、同参数、同 signal——handler 内部经
    // AgentNode raceWithSignal(config.signal) 携带），让模型把该输的内容补
    // 上，用户全程无感知；第二次仍空 → 抛 EmptyAgentTurnError 走既有 SSE
    // error 事件通道（防 provider 持续故障时死循环）。
    //
    // 检测谓词与任务书三条件的对应（finish_reason 等价路径说明）：SSE 终包
    // 的 finish_reason 只落在 ChatGenerationChunk.generationInfo，invoke 桥接
    // 路径（AgentNode 生产路径）返回的消息 response_metadata 不携带它
    // （2026-10-03 探针 backend/scripts/probe-finish-reason.mjs 实证，正常
    // 对照组同样不带）——本层可见的等价信号是「聚合体为 ChatMessageChunk」
    // 本身：它是「整轮流 delta 全程无 role」的必然后果（assistant/user/
    // system/… 任一 role 命中都会产出对应消息子类），即 provider 异常流的
    // 充分签名。故三条件落地为：roleless 聚合（ChatMessageChunk）∧ 零
    // tool_calls（tool_calls / tool_call_chunks / additional_kwargs.tool_calls
    // 三处全空）∧ content 为空。
    const firstRoleless = isChatMessageChunk(res);
    const first = firstRoleless
      ? new AIMessageChunk({ ...(res as object) })
      : res;
    if (isEmptyToolCallsAggregate(firstRoleless, first)) {
      const threadId = readThreadId(request);
      const elapsedMs = Date.now() - startedAt;
      console.warn(
        `[agent-empty-turn] 空终步命中（threadId=${threadId}，首次耗时 ${elapsedMs}ms，` +
          `usage=${JSON.stringify(usageSnapshot(first))}）——就地重滚一次模型调用（refs #110 #111）`,
      );
      // 用户已中止则不再重滚：本轮随 abort 语义终止，不额外计费。
      if (request.runtime?.signal?.aborted) {
        return first;
      }
      const retriedAt = Date.now();
      const retry = await handler(req2);
      const retryRoleless = isChatMessageChunk(retry);
      const second = retryRoleless
        ? new AIMessageChunk({ ...(retry as object) })
        : retry;
      if (isEmptyToolCallsAggregate(retryRoleless, second)) {
        console.warn(
          `[agent-empty-turn] 重滚后仍为空终步（threadId=${threadId}，重滚耗时 ` +
            `${Date.now() - retriedAt}ms，usage=${JSON.stringify(usageSnapshot(second))}）——抛 EmptyAgentTurnError`,
        );
        throw new EmptyAgentTurnError(
          "模型连续两次返回空终步（EMPTY_ANSWER，refs #110 tool_calls 增量丢失），本轮无法产出回复。",
        );
      }
      console.warn(
        `[agent-empty-turn] 重滚接续成功（threadId=${threadId}，重滚耗时 ` +
          `${Date.now() - retriedAt}ms，usage=${JSON.stringify(usageSnapshot(second))}）`,
      );
      return second;
    }
    return first;
  },
});

// ---------------------------------------------------------------------------
// 空终步检测 + 重滚（refs #110 #111，#112）— 错误类型 / 纯谓词 / 事件映射
// ---------------------------------------------------------------------------

/**
 * 空终步重滚穷尽后抛出的带标识错误（任务书 #112：重滚限一次，第二次仍空
 * 即抛）。经 DeepAgentService.chat 的 toErrorEvent（本模块 emptyTurnToErrorEvent
 * 分支）映射为 MODEL_ERROR error 事件走既有 SSE 通道；导出供测试与上层识别。
 */
export class EmptyAgentTurnError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EmptyAgentTurnError";
  }
}

/**
 * EmptyAgentTurnError → error 事件映射（#112）：code 用契约既有 MODEL_ERROR
 * （AgentErrorCode 为封闭枚举且 #112 冻结 shared/contracts，EMPTY_ANSWER
 * 标识内嵌消息）；非本类错误返回 null，由 toErrorEvent 走既有 INTERNAL 分支。
 * 导出供 jest 直接断言映射语义。
 */
export function emptyTurnToErrorEvent(err: unknown): AgentEvent | null {
  if (err instanceof EmptyAgentTurnError) {
    return {
      type: "error",
      error: { code: "MODEL_ERROR", message: err.message },
    };
  }
  return null;
}

/** 聚合结果是否为 ChatMessageChunk（= 整轮流 delta 全程无 role 的签名）。 */
function isChatMessageChunk(x: unknown): boolean {
  return (
    x != null &&
    typeof x === "object" &&
    (x as { constructor?: { name?: string } }).constructor?.name ===
      "ChatMessageChunk"
  );
}

/** 聚合结果三处 tool_calls 载体是否全空。 */
function hasAnyToolCalls(msg: unknown): boolean {
  const m = msg as {
    tool_calls?: unknown[];
    tool_call_chunks?: unknown[];
    additional_kwargs?: { tool_calls?: unknown[] };
  };
  return (
    (Array.isArray(m?.tool_calls) && m.tool_calls.length > 0) ||
    (Array.isArray(m?.tool_call_chunks) && m.tool_call_chunks.length > 0) ||
    (Array.isArray(m?.additional_kwargs?.tool_calls) &&
      m.additional_kwargs!.tool_calls!.length > 0)
  );
}

/** content 是否为空（'' / 空块数组 / undefined / null）。 */
function isEmptyContent(content: unknown): boolean {
  if (typeof content === "string") return content.length === 0;
  if (Array.isArray(content)) return content.length === 0;
  return content == null;
}

/**
 * 空终步谓词（三条件同时成立）：roleless 聚合（ChatMessageChunk，provider
 * 异常流签名，见 middleware 内注释）∧ 零 tool_calls ∧ content 空。
 * 正常终步（AIMessageChunk 空 content）不命中——那是模型真空回，交给
 * classifyAgentStream 流尾的 EMPTY_ANSWER 兜底，不在本层重滚。
 */
function isEmptyToolCallsAggregate(roleless: boolean, msg: unknown): boolean {
  if (!roleless) return false;
  return (
    !hasAnyToolCalls(msg) &&
    isEmptyContent((msg as { content?: unknown }).content)
  );
}

/** 从 middleware request 的 runtime 读 threadId（缺席时给 "-"）。 */
function readThreadId(request: {
  runtime?: { configurable?: { thread_id?: unknown } };
}): string {
  const tid = request.runtime?.configurable?.thread_id;
  return typeof tid === "string" && tid.length > 0 ? tid : "-";
}

/** 重滚打点用的 usage 快照（usage_metadata 优先，缺席回退 response_metadata.usage）。 */
function usageSnapshot(msg: unknown): unknown {
  const m = msg as {
    usage_metadata?: unknown;
    response_metadata?: { usage?: unknown };
  };
  return m?.usage_metadata ?? m?.response_metadata?.usage ?? null;
}
