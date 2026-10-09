/**
 * 模型路由配置治理单测（#162）——thinking 开关接通 + vision 配置收编真源。
 *
 * 覆盖三条行为不变量：
 *   1. thinking 优先级链：DB（THINKING_DISABLED_<TASK> / THINKING_DISABLED）
 *      > env 同键 > 场景默认层（THINKING_DISABLED_SCENARIOS，现仅
 *      workout_complete）> 现状行为（开思考）。
 *   2. loadModel 真实消费：thinking=false 时 glm 分支产出实例携带
 *      modelKwargs.thinking.type='disabled'，deepseek 分支对应调整；默认链
 *      不回归——chat 场景 glm 不带 disabled kwargs、deepseek 维持 enabled。
 *   3. vision 配置经 modelConfigService.resolveVisionModelConfig 解析：
 *      DB > env > 默认（含借用 DEEPSEEK ark key/baseURL 的兜底链），
 *      llm.ts 不再自带硬编码默认模型串。
 *
 * ConfigRepo 是 Postgres 网关（真基础设施，非被测系统），此处 monkey-patch
 * getConfig 以受控 DB 状态跑真实 DB > env > default 层级（与
 * tests/unit/services/modelConfig.test.ts 的 jest.mock 同思路）。
 * Runner: node:test via tsx。
 */
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

import { ConfigRepo } from "../../knowledgeRepo.js";
import {
  resolveThinkingConfig,
  resolveVisionModelConfig,
  DEFAULT_VISION_MODEL,
  THINKING_DISABLED_SCENARIOS,
  MissingApiKeyError,
} from "../../modelConfigService.js";
import { loadModel, loadVisionModel } from "../../llm.js";

// ---------------------------------------------------------------------------
// 环境隔离：快照并清空所有模型路由相关 env 前缀，测试后还原
// ---------------------------------------------------------------------------

const ENV_PREFIXES = [
  "AI_PROVIDER",
  "GLM_",
  "DEEPSEEK_",
  "VISION_",
  "THINKING_",
  "OPENAI_",
  "GEMINI_",
  "GOOGLE_",
];

let savedEnv: Record<string, string | undefined> = {};
let dbState: Record<string, string> = {};
const originalGetConfig = ConfigRepo.getConfig;

beforeEach(() => {
  savedEnv = {};
  for (const k of Object.keys(process.env)) {
    if (ENV_PREFIXES.some((p) => k.startsWith(p))) {
      savedEnv[k] = process.env[k];
      delete process.env[k];
    }
  }
  dbState = {};
  ConfigRepo.getConfig = (async (_userId: string, key: string) =>
    dbState[key] ?? null) as typeof ConfigRepo.getConfig;
});

afterEach(() => {
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  ConfigRepo.getConfig = originalGetConfig;
});

// ---------------------------------------------------------------------------
// 辅助：从 langchain 实例各形态取 model / modelKwargs
// ---------------------------------------------------------------------------

function lcKwargs(m: unknown): Record<string, unknown> {
  return (m as { lc_kwargs?: Record<string, unknown> })?.lc_kwargs ?? {};
}

// ---------------------------------------------------------------------------
// 1. resolveThinkingConfig 优先级链
// ---------------------------------------------------------------------------

describe("#162 resolveThinkingConfig 优先级链", () => {
  it("场景默认层：workout_complete 在 THINKING_DISABLED_SCENARIOS 集内 → 关思考", async () => {
    assert.ok(THINKING_DISABLED_SCENARIOS.has("workout_complete"));
    const cfg = await resolveThinkingConfig("workout_complete");
    assert.equal(cfg.thinking, false);
    assert.equal(cfg.source, "scenario-default");
  });

  it("现状行为：chat 未配置 → 开思考（默认链不回归）", async () => {
    const cfg = await resolveThinkingConfig("chat");
    assert.equal(cfg.thinking, true);
    assert.equal(cfg.source, "default");
  });

  it("env 全局键：THINKING_DISABLED=true → chat 关思考（source=env）", async () => {
    process.env.THINKING_DISABLED = "true";
    const cfg = await resolveThinkingConfig("chat");
    assert.equal(cfg.thinking, false);
    assert.equal(cfg.source, "env");
  });

  it("env 任务域键优先于全局键：THINKING_DISABLED_WORKOUT_COMPLETE=false 解开快车道", async () => {
    process.env.THINKING_DISABLED = "true";
    process.env.THINKING_DISABLED_WORKOUT_COMPLETE = "false";
    const cfg = await resolveThinkingConfig("workout_complete");
    assert.equal(cfg.thinking, true);
    assert.equal(cfg.source, "env");
  });

  it("DB 全局键压过 env：THINKING_DISABLED DB=false vs env=true → 开思考（source=db）", async () => {
    process.env.THINKING_DISABLED = "true";
    dbState["THINKING_DISABLED"] = "false";
    const cfg = await resolveThinkingConfig("chat");
    assert.equal(cfg.thinking, true);
    assert.equal(cfg.source, "db");
  });

  it("DB 任务域键最高优先：THINKING_DISABLED_CHAT DB=true → 关思考（source=db）", async () => {
    process.env.THINKING_DISABLED = "false";
    dbState["THINKING_DISABLED_CHAT"] = "true";
    const cfg = await resolveThinkingConfig("chat");
    assert.equal(cfg.thinking, false);
    assert.equal(cfg.source, "db");
  });

  it("非法值视为未配置（落到下一层，配置手误不拍死开关）", async () => {
    dbState["THINKING_DISABLED"] = "yes";
    process.env.THINKING_DISABLED_CHAT = "1";
    const cfg = await resolveThinkingConfig("chat");
    assert.equal(cfg.thinking, true);
    assert.equal(cfg.source, "default");
  });

  it("值大小写不敏感：'TRUE' 同 'true'", async () => {
    dbState["THINKING_DISABLED"] = "TRUE";
    const cfg = await resolveThinkingConfig("plan");
    assert.equal(cfg.thinking, false);
    assert.equal(cfg.source, "db");
  });
});

// ---------------------------------------------------------------------------
// 2. loadModel 真实消费 thinking 配置
// ---------------------------------------------------------------------------

describe("#162 loadModel thinking 消费（glm 分支）", () => {
  it("默认链不回归：chat 场景不带 disabled kwargs（GLM 流自带 reasoning_content）", async () => {
    process.env.GLM_API_KEY = "test-glm-key";
    const model = await loadModel("chat");
    const kwargs = lcKwargs(model);
    assert.equal(kwargs.modelKwargs, undefined);
  });

  it("配置 thinking=false：DB THINKING_DISABLED_CHAT=true → 实例携带 disabled kwargs", async () => {
    process.env.GLM_API_KEY = "test-glm-key";
    dbState["THINKING_DISABLED_CHAT"] = "true";
    const model = await loadModel("chat");
    const kwargs = lcKwargs(model);
    assert.deepEqual(kwargs.modelKwargs, { thinking: { type: "disabled" } });
  });

  it("env 配置生效：THINKING_DISABLED=true → plan 场景携带 disabled kwargs", async () => {
    process.env.GLM_API_KEY = "test-glm-key";
    process.env.THINKING_DISABLED = "true";
    const model = await loadModel("plan");
    assert.deepEqual(lcKwargs(model).modelKwargs, {
      thinking: { type: "disabled" },
    });
  });

  it("场景默认层保留：workout_complete（无任何配置）仍关思考（B5b 语义原样）", async () => {
    process.env.GLM_API_KEY = "test-glm-key";
    const model = await loadModel("workout_complete");
    assert.deepEqual(lcKwargs(model).modelKwargs, {
      thinking: { type: "disabled" },
    });
  });

  it("配置可反向解开场景默认：env THINKING_DISABLED_WORKOUT_COMPLETE=false → 不带 kwargs", async () => {
    process.env.GLM_API_KEY = "test-glm-key";
    process.env.THINKING_DISABLED_WORKOUT_COMPLETE = "false";
    const model = await loadModel("workout_complete");
    assert.equal(lcKwargs(model).modelKwargs, undefined);
  });
});

describe("#162 loadModel thinking 消费（deepseek 分支）", () => {
  it("默认链不回归：chat 场景维持 thinking enabled（收编前硬编码行为）", async () => {
    process.env.AI_PROVIDER = "deepseek";
    process.env.DEEPSEEK_API_KEY = "test-ds-key";
    const model = await loadModel("chat");
    assert.deepEqual(lcKwargs(model).modelKwargs, {
      thinking: { type: "enabled" },
    });
  });

  it("配置 thinking=false：DB THINKING_DISABLED=true → disabled kwargs", async () => {
    process.env.AI_PROVIDER = "deepseek";
    process.env.DEEPSEEK_API_KEY = "test-ds-key";
    dbState["THINKING_DISABLED"] = "true";
    const model = await loadModel("chat");
    assert.deepEqual(lcKwargs(model).modelKwargs, {
      thinking: { type: "disabled" },
    });
  });

  it("场景默认层统一生效：workout_complete 随 THINKING_DISABLED_SCENARIOS 关思考", async () => {
    process.env.AI_PROVIDER = "deepseek";
    process.env.DEEPSEEK_API_KEY = "test-ds-key";
    const model = await loadModel("workout_complete");
    assert.deepEqual(lcKwargs(model).modelKwargs, {
      thinking: { type: "disabled" },
    });
  });
});

// ---------------------------------------------------------------------------
// 3. vision 配置收编 modelConfigService
// ---------------------------------------------------------------------------

describe("#162 resolveVisionModelConfig 优先级（DB > env > 默认）", () => {
  it("默认链：无任何配置 → 默认模型 / 空 baseURL / 空 apiKey", async () => {
    const cfg = await resolveVisionModelConfig();
    assert.equal(cfg.model, DEFAULT_VISION_MODEL);
    assert.equal(cfg.model, "doubao-seed-2-1-turbo-260628");
    assert.equal(cfg.baseURL, "");
    assert.equal(cfg.apiKey, "");
    assert.equal(cfg.source, "default");
  });

  it("env 层：VISION_MODEL 覆盖默认模型（source=env）", async () => {
    process.env.VISION_MODEL = "doubao-vision-pro";
    const cfg = await resolveVisionModelConfig();
    assert.equal(cfg.model, "doubao-vision-pro");
    assert.equal(cfg.source, "env");
  });

  it("DB 层压过 env：DB VISION_MODEL 胜出（source=db）", async () => {
    process.env.VISION_MODEL = "doubao-vision-pro";
    dbState["VISION_MODEL"] = "doubao-vision-db";
    const cfg = await resolveVisionModelConfig();
    assert.equal(cfg.model, "doubao-vision-db");
    assert.equal(cfg.source, "db");
  });

  it("baseURL 借用链：VISION_BASE_URL 缺席时回落 env DEEPSEEK_BASE_URL（ark 借用）", async () => {
    process.env.DEEPSEEK_BASE_URL = "https://ark.example.com/api/v3";
    const cfg = await resolveVisionModelConfig();
    assert.equal(cfg.baseURL, "https://ark.example.com/api/v3");
  });

  it("baseURL 借用链：VISION_BASE_URL 存在时不借 DEEPSEEK_BASE_URL", async () => {
    process.env.VISION_BASE_URL = "https://vision.example.com/v1";
    process.env.DEEPSEEK_BASE_URL = "https://ark.example.com/api/v3";
    const cfg = await resolveVisionModelConfig();
    assert.equal(cfg.baseURL, "https://vision.example.com/v1");
  });

  it("apiKey 借用链：VISION_API_KEY 缺席时回落 env DEEPSEEK_API_KEY", async () => {
    process.env.DEEPSEEK_API_KEY = "ark-borrowed-key";
    const cfg = await resolveVisionModelConfig();
    assert.equal(cfg.apiKey, "ark-borrowed-key");
  });

  it("apiKey 借用链：DB VISION_API_KEY 压过 env DEEPSEEK_API_KEY", async () => {
    process.env.DEEPSEEK_API_KEY = "ark-borrowed-key";
    dbState["VISION_API_KEY"] = "vision-db-key";
    const cfg = await resolveVisionModelConfig();
    assert.equal(cfg.apiKey, "vision-db-key");
  });
});

describe("#162 loadVisionModel 消费收编后的解析真源", () => {
  it("实例模型来自 resolver（env VISION_MODEL 直达实例）", async () => {
    process.env.VISION_MODEL = "doubao-vision-pro";
    process.env.VISION_API_KEY = "vision-key";
    const model = await loadVisionModel();
    const kwargs = lcKwargs(model);
    assert.equal(kwargs.model, "doubao-vision-pro");
    assert.equal(kwargs.apiKey, "vision-key");
  });

  it("baseURL 为空时不下发 configuration.baseURL（undefined，不传空串）", async () => {
    process.env.VISION_API_KEY = "vision-key";
    const model = await loadVisionModel();
    const configuration = lcKwargs(model).configuration as
      { baseURL?: string } | undefined;
    assert.equal(configuration?.baseURL, undefined);
  });

  it("任何层都无 key → MissingApiKeyError('vision')", async () => {
    await assert.rejects(loadVisionModel(), MissingApiKeyError);
  });
});
