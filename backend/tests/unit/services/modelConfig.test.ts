/**
 * Unit tests for the DeepSeek model configuration switch (card M8).
 *
 * Covers behavioral ACs:
 *   B1 default flash          - resolveDeepSeekModel('flash') / loadModel() -> deepseek-v4-flash
 *   B3 thinking off           - resolveDeepSeekModel(tier).thinking === false
 *   B4 pro override           - DEEPSEEK_MODEL_PRO env overrides pro tier
 *   B5 single source of truth - modelConfigService vs modelRouter resolve identical ids
 *   B6 vacuity probe          - unknown provider / missing key fail explicitly
 *
 * ConfigRepo is a Postgres gateway (true infrastructure, not the system under test),
 * so it is mocked here to exercise the real DB > env > default hierarchy (L100) with
 * controlled DB state, without changing source behavior (P009).
 */

import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  jest,
} from "@jest/globals";

// Mock the ConfigRepo gateway BEFORE importing the modules under test.
jest.mock("../../../src/services/knowledgeRepo.js", () => ({
  ConfigRepo: {
    getConfig: jest.fn(),
    setConfig: jest.fn().mockResolvedValue(undefined),
    getAllConfigs: jest.fn().mockResolvedValue({}),
    getClient: jest.fn(),
  },
}));

import { ConfigRepo } from "../../../src/services/knowledgeRepo.js";
import {
  resolveDeepSeekModel,
  resolveTaskConfig,
  resolveDefaultedProvider,
  resolveGLMModel,
  resolveGLMAnthropicModel,
  resolveGLMLegacyModel,
  DEFAULT_DEEPSEEK_FLASH,
  DEFAULT_GLM_BASE_URL,
  DEFAULT_GLM_ANTHROPIC_BASE_URL,
  DEFAULT_GLM_LEGACY_BASE_URL,
  UnknownProviderError,
  MissingApiKeyError,
} from "../../../src/services/modelConfigService.js";
import { loadModel } from "../../../src/services/llm.js";

// ============================================================================
// Helpers
// ============================================================================

const ENV_KEYS = [
  "AI_PROVIDER",
  "AI_PROVIDER_DEFAULT",
  "DEEPSEEK_API_KEY",
  "DEEPSEEK_MODEL_FLASH",
  "DEEPSEEK_MODEL_PRO",
  "DEEPSEEK_MODEL_DEFAULT",
  "DEEPSEEK_BASE_URL",
  "GOOGLE_API_KEY",
  "OPENAI_API_KEY",
  "GLM_API_KEY",
  "GLM_MODEL",
  "GLM_MODEL_DEFAULT",
  "GLM_BASE_URL",
  "GLM_ANTHROPIC_BASE_URL",
  "GLM_LEGACY_BASE_URL",
];

let savedEnv: Record<string, string | undefined> = {};

function snapshotEnv() {
  savedEnv = {};
  for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
}

function restoreEnv() {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
}

/** Reset the ConfigRepo gateway mock so DB reads return nothing by default. */
function resetConfigRepo() {
  (ConfigRepo.getConfig as jest.Mock).mockReset();
  (ConfigRepo.getConfig as jest.Mock).mockResolvedValue(undefined);
  (ConfigRepo.setConfig as jest.Mock).mockReset();
  (ConfigRepo.setConfig as jest.Mock).mockResolvedValue(undefined);
}

/** Extract the model id from a langchain BaseChatModel across accessor shapes. */
function extractModel(m: any): string {
  return String(
    m?.lc_kwargs?.model ??
      m?.model ??
      m?.model_name ??
      m?.invocationParams?.()?.model ??
      "",
  );
}

// ============================================================================
// Tests
// ============================================================================

describe("M8 DeepSeek model config", () => {
  beforeEach(() => {
    snapshotEnv();
    for (const k of ENV_KEYS) delete process.env[k];
    resetConfigRepo();
  });

  afterEach(() => {
    restoreEnv();
  });

  // --- B1: default flash -------------------------------------------------
  describe("B1 default flash", () => {
    it("resolveDeepSeekModel('flash') returns deepseek-v4-flash-ga-260731 (volcano ark default)", async () => {
      const cfg = await resolveDeepSeekModel("flash");
      expect(cfg.model).toBe(DEFAULT_DEEPSEEK_FLASH);
      expect(cfg.model).toBe("deepseek-v4-flash-ga-260731");
    });

    it("loadModel() with AI_PROVIDER=deepseek returns a deepseek flash model", async () => {
      process.env.AI_PROVIDER = "deepseek";
      process.env.DEEPSEEK_API_KEY = "test-key";
      const model = await loadModel();
      expect(extractModel(model)).toContain("deepseek-v4-flash-ga-260731");
    });

    it("loadModel() defaults to glm-5.3-flash when no provider is configured", async () => {
      process.env.GLM_API_KEY = "test-glm-key";
      const model = await loadModel();
      expect(extractModel(model)).toContain("glm-5.3-flash");
    });

    it("loadModel() with glm and no GLM_API_KEY throws MissingApiKeyError('glm')", async () => {
      await expect(loadModel()).rejects.toThrow(/GLM_API_KEY missing/);
    });
  });

  // --- B3: thinking off --------------------------------------------------
  describe("B3 thinking default off", () => {
    it("flash tier has thinking === false", async () => {
      const cfg = await resolveDeepSeekModel("flash");
      expect(cfg.thinking).toBe(false);
    });

    it("pro tier has thinking === false", async () => {
      const cfg = await resolveDeepSeekModel("pro");
      expect(cfg.thinking).toBe(false);
    });
  });

  // --- B4: pro override --------------------------------------------------
  describe("B4 pro opt-in override", () => {
    it("DEEPSEEK_MODEL_PRO env overrides the pro tier model", async () => {
      process.env.DEEPSEEK_MODEL_PRO = "deepseek-probe-id-42";
      const cfg = await resolveDeepSeekModel("pro");
      expect(cfg.model).toBe("deepseek-probe-id-42");
    });

    it("pro without override falls back to the safe flash default (never bound to expensive pro)", async () => {
      const cfg = await resolveDeepSeekModel("pro");
      expect(cfg.model).toBe(DEFAULT_DEEPSEEK_FLASH);
    });
  });

  // --- B5: single source of truth ---------------------------------------
  // batch4-2 后 modelRouter 已并入 modelConfigService，"两条路径一致"退化为
  // 单一真源的直接断言：resolveTaskConfig 即 provider/model 解析唯一入口。
  describe("B5 single source of truth (resolveTaskConfig)", () => {
    it("resolves the deepseek default model id for a deepseek scenario", async () => {
      process.env.AI_PROVIDER = "deepseek";

      const cfg = await resolveTaskConfig("default");

      expect(cfg.provider).toBe("deepseek");
      expect(cfg.model).toBe("deepseek-v4-flash-ga-260731");
    });

    it("DB > env > default hierarchy: a DB value wins (L100)", async () => {
      process.env.AI_PROVIDER = "deepseek";
      (ConfigRepo.getConfig as jest.Mock).mockImplementation(
        async (_userId: string, key: string) =>
          key === "DEEPSEEK_MODEL_FLASH" ? "deepseek-db-override" : undefined,
      );

      const cfg = await resolveTaskConfig("default");

      expect(cfg.model).toBe("deepseek-db-override");
    });
  });

  // --- B6: vacuity probe -------------------------------------------------
  describe("B6 vacuity probe (explicit failure, no silent fallback)", () => {
    it("unknown provider throws UnknownProviderError (no silent gemini fallback)", async () => {
      process.env.AI_PROVIDER = "bogus-provider";
      await expect(loadModel()).rejects.toBeInstanceOf(UnknownProviderError);
    });

    it("missing DeepSeek API key throws MissingApiKeyError", async () => {
      // no DEEPSEEK_API_KEY in env, ConfigRepo returns nothing
      await expect(loadModel()).rejects.toBeInstanceOf(MissingApiKeyError);
    });

    it("restoring the key makes loadModel succeed (probe green)", async () => {
      process.env.GLM_API_KEY = "test-glm-key";
      const model = await loadModel();
      expect(extractModel(model)).toContain("glm-5.3-flash");
    });
  });

  // --- B4: GLM 三端点架构（issue #35，端点勘定后） -------------------------
  // glm(默认,coding/paas/v4) | glm-anthropic(备选,/api/anthropic) |
  // glm-legacy(回退,api.z.ai)。三路共用 GLM_API_KEY/GLM_MODEL，baseURL 键隔离。
  describe("B4 GLM provider family (coding default / anthropic backup / legacy fallback)", () => {
    it("default provider is glm (no env / no DB)", async () => {
      await expect(resolveDefaultedProvider()).resolves.toBe("glm");
    });

    it("resolveTaskConfig default resolves the GLM coding endpoint", async () => {
      const cfg = await resolveTaskConfig("default");
      expect(cfg.provider).toBe("glm");
      expect(cfg.model).toBe("glm-5.3-flash");
      expect(cfg.baseURL).toBe(DEFAULT_GLM_BASE_URL);
      expect(cfg.baseURL).toBe("https://open.bigmodel.cn/api/coding/paas/v4");
    });

    it("loadModel() default builds ChatOpenAI against the coding endpoint", async () => {
      process.env.GLM_API_KEY = "test-glm-key";
      const model = (await loadModel()) as unknown as {
        lc_kwargs?: {
          model?: string;
          configuration?: { baseURL?: string };
          maxTokens?: number;
        };
      };
      expect(model.lc_kwargs?.model).toBe("glm-5.3-flash");
      expect(model.lc_kwargs?.configuration?.baseURL).toBe(
        "https://open.bigmodel.cn/api/coding/paas/v4",
      );
      // 65536（#116，2026-10-03 由 16384 扩容）：coding 端点 thinking 计入
      // completion 配额，16384 下计划轮终步思考+卡 JSON 超限 → finish_reason
      // =length 写卡中途截断 → EMPTY_ANSWER；65536 端点实测接受，与 anthropic
      // 分支对齐（仍高于 OpenAI-SDK 默认上限，继续规避 tool-args 截断）。
      expect(model.lc_kwargs?.maxTokens).toBe(65536);
    });

    it("AI_PROVIDER=glm-anthropic builds ChatAnthropic against the anthropic endpoint", async () => {
      process.env.AI_PROVIDER = "glm-anthropic";
      process.env.GLM_API_KEY = "test-glm-key";
      const model = (await loadModel()) as unknown as {
        apiUrl?: string;
        model?: string;
        maxTokens?: number;
      };
      expect(model.model).toBe("glm-5.3-flash");
      expect(model.apiUrl).toBe("https://open.bigmodel.cn/api/anthropic");
      // 65536（吞卡修复 II 期间修正）：Anthropic Messages 协议 thinking 块
      // 计入 max_tokens（bigmodel 端点实测执行），16384 会在长思考轮截断卡
      // 片生成。OpenAI 分支 2026-10-03（#116）起同为 65536（其 coding 端点
      // thinking 同样计入 completion 配额）。
      expect(model.maxTokens).toBe(65536);
    });

    it("GLM_BASE_URL env overrides the coding endpoint", async () => {
      process.env.GLM_BASE_URL = "https://coding-proxy.example.com/v4";
      const cfg = await resolveGLMModel("default");
      expect(cfg.baseURL).toBe("https://coding-proxy.example.com/v4");
    });

    it("GLM_ANTHROPIC_BASE_URL env overrides the anthropic endpoint", async () => {
      process.env.GLM_ANTHROPIC_BASE_URL =
        "https://anthropic-proxy.example.com";
      const cfg = await resolveGLMAnthropicModel("default");
      expect(cfg.baseURL).toBe("https://anthropic-proxy.example.com");
      expect(cfg.model).toBe("glm-5.3-flash");
    });

    it("coding GLM_BASE_URL never leaks into the anthropic path", async () => {
      process.env.GLM_BASE_URL = "https://open.bigmodel.cn/api/paas/v4";
      const cfg = await resolveGLMAnthropicModel("default");
      expect(cfg.baseURL).toBe(DEFAULT_GLM_ANTHROPIC_BASE_URL);
    });

    it("coding GLM_BASE_URL never leaks into the legacy path", async () => {
      process.env.GLM_BASE_URL = "https://open.bigmodel.cn/api/coding/paas/v4";
      const cfg = await resolveGLMLegacyModel("default");
      expect(cfg.baseURL).toBe(DEFAULT_GLM_LEGACY_BASE_URL);
      expect(cfg.baseURL).toBe("https://api.z.ai/api/paas/v4");
    });

    it("AI_PROVIDER=glm-legacy builds the legacy ChatOpenAI path with GLM_LEGACY_BASE_URL", async () => {
      process.env.AI_PROVIDER = "glm-legacy";
      process.env.GLM_API_KEY = "test-glm-key";
      process.env.GLM_LEGACY_BASE_URL = "https://api.z.ai/api/paas/v4";
      const model = (await loadModel()) as unknown as {
        lc_kwargs?: { model?: string; configuration?: { baseURL?: string } };
      };
      expect(model.lc_kwargs?.model).toBe("glm-5.3-flash");
      expect(model.lc_kwargs?.configuration?.baseURL).toBe(
        "https://api.z.ai/api/paas/v4",
      );
    });

    it("glm with no key throws GLM_API_KEY missing", async () => {
      process.env.AI_PROVIDER = "glm";
      await expect(loadModel()).rejects.toThrow(/GLM_API_KEY missing/);
    });

    it("glm-anthropic with no key throws MissingApiKeyError", async () => {
      process.env.AI_PROVIDER = "glm-anthropic";
      await expect(loadModel()).rejects.toBeInstanceOf(MissingApiKeyError);
    });

    it("GLM_MODEL env is shared by all three endpoint paths", async () => {
      process.env.GLM_MODEL = "glm-4.7";
      const coding = await resolveGLMModel("default");
      const anth = await resolveGLMAnthropicModel("default");
      const legacy = await resolveGLMLegacyModel("default");
      expect(coding.model).toBe("glm-4.7");
      expect(anth.model).toBe("glm-4.7");
      expect(legacy.model).toBe("glm-4.7");
    });
  });
});
