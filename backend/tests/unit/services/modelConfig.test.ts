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

import { describe, it, expect, beforeEach, afterEach, jest } from "@jest/globals";

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
  DEFAULT_DEEPSEEK_FLASH,
  UnknownProviderError,
  MissingApiKeyError,
} from "../../../src/services/modelConfigService.js";
import { getProviderForTask } from "../../../src/services/modelRouter.js";
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
      ""
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
    it("resolveDeepSeekModel('flash') returns deepseek-v4-flash", async () => {
      const cfg = await resolveDeepSeekModel("flash");
      expect(cfg.model).toContain(DEFAULT_DEEPSEEK_FLASH);
      expect(cfg.model).toBe("deepseek-v4-flash");
    });

    it("loadModel() returns a model whose id contains deepseek-v4-flash", async () => {
      process.env.DEEPSEEK_API_KEY = "test-key";
      const model = await loadModel();
      expect(extractModel(model)).toContain("deepseek-v4-flash");
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
  describe("B5 single source of truth (modelConfigService vs modelRouter)", () => {
    it("both paths resolve the same model id for a deepseek scenario", async () => {
      process.env.AI_PROVIDER = "deepseek";

      const viaConfigService = await resolveTaskConfig("default");
      const viaRouter = await getProviderForTask("default");

      expect(viaConfigService.provider).toBe("deepseek");
      expect(viaRouter.provider).toBe("deepseek");
      expect(viaConfigService.model).toBe(viaRouter.model);
      expect(viaConfigService.model).toBe("deepseek-v4-flash");
    });

    it("DB > env > default hierarchy: a DB value wins on both paths (L100)", async () => {
      process.env.AI_PROVIDER = "deepseek";
      (ConfigRepo.getConfig as jest.Mock).mockImplementation(
        async (_userId: string, key: string) =>
          key === "DEEPSEEK_MODEL_FLASH" ? "deepseek-db-override" : undefined
      );

      const viaConfigService = await resolveTaskConfig("default");
      const viaRouter = await getProviderForTask("default");

      expect(viaConfigService.model).toBe("deepseek-db-override");
      expect(viaRouter.model).toBe("deepseek-db-override");
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
      process.env.DEEPSEEK_API_KEY = "test-key";
      const model = await loadModel();
      expect(extractModel(model)).toContain("deepseek-v4-flash");
    });
  });
});
