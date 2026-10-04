import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  loadModel,
  loadModelProviders,
  loadThinkingMode,
  saveModel,
  writeConfig,
} from "../src/config.js";
import {
  DEEPSEEK_MAX_TOOLS,
  DEFAULT_CONTEXT_TOKENS,
  FLASH_MODEL_ID,
  PRO_MODEL_ID,
  SELECTABLE_MODEL_IDS,
  migrateRetiredModel,
  resolveThinkingPreference,
  toolResultBudgetForModel,
} from "../src/models.js";
import { contextTokensFor, pricingFor } from "../src/telemetry/stats.js";

const dirs: string[] = [];

function configPath(): string {
  const dir = mkdtempSync(join(tmpdir(), "carbon-models-"));
  dirs.push(dir);
  return join(dir, "config.json");
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("model capability registry", () => {
  it("defaults to the recommended ID while preserving explicit accepted aliases", () => {
    expect(FLASH_MODEL_ID).toBe("deepseek-flash");
    expect(SELECTABLE_MODEL_IDS).toEqual(["deepseek-flash", "deepseek-v4-pro"]);
    expect(migrateRetiredModel("deepseek-v4-flash")).toEqual({
      model: "deepseek-v4-flash",
      migrated: false,
    });
    expect(pricingFor("deepseek-v4-flash")).toEqual(pricingFor(FLASH_MODEL_ID));
    const path = configPath();
    writeConfig({ model: FLASH_MODEL_ID }, path);
    expect(loadModelProviders(path, {})[0]?.kind).toBe("deepseek");
    saveModel("deepseek-v4-flash", path);
    expect(loadModel(path)).toBe("deepseek-v4-flash");
  });
  it("describes current V4 models from one registry", () => {
    expect(resolveThinkingPreference(FLASH_MODEL_ID)).toBe("enabled");
    expect(resolveThinkingPreference(PRO_MODEL_ID, "disabled")).toBe("disabled");
    expect(pricingFor(PRO_MODEL_ID)?.output).toBe(3.96);
    expect(pricingFor("deepseek-flash")?.output).toBe(1.2);
    expect(contextTokensFor("deepseek-flash")).toBe(1_000_000);
    expect(contextTokensFor(PRO_MODEL_ID)).toBe(1_000_000);
    expect(toolResultBudgetForModel(PRO_MODEL_ID)).toBe(20_000);
    expect(DEEPSEEK_MAX_TOOLS).toBe(128);
  });

  it("migrates retired aliases while preserving their thinking semantics", () => {
    expect(migrateRetiredModel("deepseek-chat")).toEqual({
      model: FLASH_MODEL_ID,
      thinking: "disabled",
      migrated: true,
    });
    expect(migrateRetiredModel("deepseek-reasoner")).toEqual({
      model: FLASH_MODEL_ID,
      thinking: "enabled",
      migrated: true,
    });
  });

  it("loads and persists legacy model pins as current V4 selections", () => {
    const path = configPath();
    writeConfig({ model: "deepseek-chat" }, path);
    expect(loadModel(path)).toBe(FLASH_MODEL_ID);
    expect(loadThinkingMode(path)).toBe("disabled");

    saveModel("deepseek-reasoner", path);
    expect(loadModel(path)).toBe(FLASH_MODEL_ID);
    expect(loadThinkingMode(path)).toBe("enabled");
  });

  it("supports explicit context overrides for custom models", () => {
    const path = configPath();
    writeConfig(
      {
        contextWindowOverride: { "custom-model": 777_000 },
        pricingOverride: {
          "custom-model": { inputCacheHit: 1, inputCacheMiss: 2, output: 3 },
        },
      },
      path,
    );
    expect(contextTokensFor("custom-model", path)).toBe(777_000);
    expect(pricingFor("custom-model", path)?.output).toBe(3);
  });

  it("uses silent conservative defaults for unknown compatible models", () => {
    expect(contextTokensFor("gpt-5.6-luna")).toBe(DEFAULT_CONTEXT_TOKENS);
    expect(pricingFor("gpt-5.6-luna")).toBeUndefined();
  });
});
