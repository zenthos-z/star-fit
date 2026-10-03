/**
 * RoleHealingChatOpenAI — GLM 无 role 流转换丢失根治（refs #110 #112 #113）
 *
 * 故障形态（#110 诊断 + #111 复现矩阵；2026-10-03 #113 实测升级为高发）：
 * GLM OpenAI 兼容端点在长上下文 + 长思考 + 密集工具链的重型请求中，流式
 * 响应整轮 delta 全程不带 role 字段（简单探针请求正常，仅重型请求触发）。
 * @langchain/openai 的 convertCompletionsDeltaToBaseMessageChunk 对 role
 * 缺省的 delta 走兜底分支构造 ChatMessageChunk——该构造器不接收
 * additional_kwargs，也不做 tool_calls → tool_call_chunks 映射——增量在
 * 转换层被静默丢弃，聚合体 content=''、零 tool_calls，LangGraph 视为合法
 * 终步 → 整轮空输出。上游 1.5.13 / 1.6.2 双版均如此。
 *
 * 根治：在转换层补回 GLM 缺失的 role 语义。delta 携带 tool_calls 或
 * reasoning_content 是 GLM assistant 流的确定特征（user/tool/system 消息
 * 不会带这两类字段），据此把兜底分支产物重建为按官方 assistant 分支映
 * 射的 AIMessageChunk（tool_call_chunks 逐项对齐
 * node_modules/@langchain/openai/dist/converters/completions.js 的实现）。
 * delta 无特征且 role 缺省 → 维持 ChatMessageChunk（真未知角色，不乱补）。
 *
 * 结构说明（@langchain/openai 1.5.x）：ChatOpenAI 是组合外壳，completions
 * 流式路径委托给内部持有的 ChatOpenAICompletions 实例（构造 fields.completions
 * 可注入），_convertCompletionsDeltaToBaseMessageChunk 实际定义在
 * ChatOpenAICompletions 上。因此覆写分两层：Completions 子类做 healing，
 * ChatOpenAI 子类构造时注入 healing 版 completions 实例。
 *
 * 分层防线：本文件做根治；#112 的空终步重滚（emptyTurnRetry.ts
 * frameworkTrimMiddleware）保留不动，作为其它未知形态的最后防线。
 */
import {
  ChatOpenAI,
  ChatOpenAICompletions,
  type ChatOpenAIFields,
} from "@langchain/openai";
import {
  AIMessageChunk,
  ChatMessageChunk,
  type BaseMessageChunk,
  type ToolCallChunk,
} from "@langchain/core/messages";
import type { OpenAI } from "openai";

/**
 * GLM assistant 流的确定特征：tool_calls 增量或 reasoning_content 思考增量。
 * user/tool/system 角色的 delta 不会携带这两类字段。
 */
function hasGlmAssistantSignature(delta: Record<string, any>): boolean {
  return (
    Array.isArray(delta.tool_calls) || delta.reasoning_content !== undefined
  );
}

/** 流式 delta → BaseMessageChunk 的 healing 转换点。 */
class RoleHealingChatOpenAICompletions extends ChatOpenAICompletions {
  protected _convertCompletionsDeltaToBaseMessageChunk(
    delta: Record<string, any>,
    rawResponse: OpenAI.Chat.Completions.ChatCompletionChunk,
    defaultRole?: OpenAI.Chat.ChatCompletionRole,
  ): BaseMessageChunk {
    const chunk = super._convertCompletionsDeltaToBaseMessageChunk(
      delta,
      rawResponse,
      defaultRole,
    );
    // super 仅在 role 缺省或未知值时落入兜底分支返回 ChatMessageChunk；
    // 已识别的 user/system/assistant/tool 等角色原样放行。
    if (!(chunk instanceof ChatMessageChunk)) return chunk;
    // 无 assistant 特征 → 真未知角色，不乱补。
    if (!hasGlmAssistantSignature(delta)) return chunk;

    // 按官方 assistant 分支（converters/completions.js）重建 AIMessageChunk：
    // tool_calls 增量逐项映射为 tool_call_chunks。
    const toolCallChunks: ToolCallChunk[] = [];
    if (Array.isArray(delta.tool_calls)) {
      for (const rawToolCall of delta.tool_calls) {
        toolCallChunks.push({
          name: rawToolCall.function?.name,
          args: rawToolCall.function?.arguments,
          id: rawToolCall.id,
          index: rawToolCall.index,
          type: "tool_call_chunk",
        });
      }
    }
    // additional_kwargs 构建对齐官方顺序（function_call / tool_calls /
    // __raw_response / reasoning_content / audio）。
    let additional_kwargs: Record<string, any>;
    if (delta.function_call) {
      additional_kwargs = { function_call: delta.function_call };
    } else if (delta.tool_calls) {
      additional_kwargs = { tool_calls: delta.tool_calls };
    } else {
      additional_kwargs = {};
    }
    if (this.__includeRawResponse) {
      additional_kwargs.__raw_response = rawResponse;
    }
    if (delta.reasoning_content !== undefined) {
      additional_kwargs.reasoning_content = delta.reasoning_content;
    }
    if (delta.audio) {
      additional_kwargs.audio = {
        ...delta.audio,
        index: rawResponse.choices[0].index,
      };
    }
    return new AIMessageChunk({
      content: delta.content ?? "",
      tool_call_chunks: toolCallChunks,
      additional_kwargs,
      id: rawResponse.id,
      response_metadata: {
        model_provider: "openai",
        usage: { ...rawResponse.usage },
      },
    });
  }
}

/**
 * GLM 专用 ChatOpenAI：流式转换层自带 role healing。
 * 仅替换内部 completions 实例，请求参数 / 重试 / 工具绑定等行为与
 * ChatOpenAI 一致。注意 withConfig() 会以基类重建实例（丢失 healing），
 * 生产路径（llm.ts glm 分支的 bindTools / invoke / stream）不经过该方法。
 */
export class RoleHealingChatOpenAI extends ChatOpenAI {
  constructor(fields?: ChatOpenAIFields) {
    // 剔除 completions key 再传给 Completions 子类，避免注入字段漏进它的
    // 字段解析（基类构造器同样会忽略未知 key，这里显式排除更稳）。
    const { completions: _injected, ...completionsFields } = fields ?? {};
    void _injected;
    super({
      ...completionsFields,
      completions: new RoleHealingChatOpenAICompletions(completionsFields),
    });
  }
}
