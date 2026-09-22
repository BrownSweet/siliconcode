import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { collectStartupRuleFiles, formatRuleSummary } from "../src/cli/ui/rule-summary.js";
import { setLanguageRuntime } from "../src/i18n/index.js";

describe("formatRuleSummary", () => {
  let root: string;

  beforeEach(() => {
    setLanguageRuntime("EN");
    root = mkdtempSync(join(tmpdir(), "carbon-rule-summary-"));
  });

  afterEach(() => {
    setLanguageRuntime("EN");
    rmSync(root, { recursive: true, force: true });
  });

  it("stays quiet with no loaded rules", () => {
    expect(formatRuleSummary(root, [])).toBeNull();
  });

  it("formats root and nested rule files in load order", () => {
    expect(
      formatRuleSummary(root, [
        join(root, "AGENTS.md"),
        join(root, "pkg", "AGENTS.md"),
        join(root, "pkg", "feature", "SILICON.md"),
      ]),
    ).toBe("rules · AGENTS.md, pkg/AGENTS.md, pkg/feature/SILICON.md");
  });

  it("collects the startup project rule only when the file has content", () => {
    writeFileSync(join(root, "AGENTS.md"), "   \n");
    expect(collectStartupRuleFiles(root)).toEqual([]);

    writeFileSync(join(root, "AGENTS.md"), "use pnpm\n");
    expect(collectStartupRuleFiles(root)).toEqual([join(root, "AGENTS.md")]);
  });

  it("uses the same project rule priority as prompt loading", () => {
    writeFileSync(join(root, "SILICON.md"), "carbon\n");
    writeFileSync(join(root, "AGENTS.md"), "agents\n");

    expect(formatRuleSummary(root, collectStartupRuleFiles(root))).toBe("rules · AGENTS.md");
  });

  it("ignores duplicate paths", () => {
    mkdirSync(join(root, "pkg"), { recursive: true });
    const pkgRules = join(root, "pkg", "AGENTS.md");

    expect(formatRuleSummary(root, [pkgRules, pkgRules])).toBe("rules · pkg/AGENTS.md");
  });

  it("localizes the startup rule label in zh-CN", () => {
    setLanguageRuntime("zh-CN");

    expect(formatRuleSummary(root, [join(root, "AGENTS.md")])).toBe("规则 · AGENTS.md");
  });
});
