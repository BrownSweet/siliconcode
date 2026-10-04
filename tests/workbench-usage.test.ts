import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { Usage } from "../src/client.js";
import { addTaskUsage, taskLimitReason } from "../src/workbench/usage.js";
it("accumulates receipts across phases and distinguishes unknown costs from zero", () => {
  const root = mkdtempSync(join(tmpdir(), "silicon-usage-"));
  const path = join(root, "config.json");
  writeFileSync(path, "{}");
  try {
    const stats = {
      turn: 1,
      model: "deepseek-v4-flash",
      usage: new Usage(1000, 100, 1100, 500, 500),
      cost: 0,
      cacheHitRatio: 0.5,
    };
    const first = addTaskUsage(undefined, stats, path);
    const second = addTaskUsage(first, stats, path);
    expect(second).toMatchObject({
      inputTokens: 2000,
      outputTokens: 200,
      cachedTokens: 1000,
      reportedRequests: 2,
      unreportedRequests: 0,
    });
    expect(second.estimatedCostUsd).toBeGreaterThan(0);
    expect(taskLimitReason(second, { maxTokens: 2200, budgetUsd: null })).toContain("Token 上限");
    expect(taskLimitReason(second, { maxTokens: null, budgetUsd: 0.000001 })).toContain("费用上限");
    const unknown = addTaskUsage(second, { ...stats, usage: new Usage() }, path);
    expect(unknown.estimatedCostUsd).toBeNull();
    expect(unknown.unreportedRequests).toBe(1);
    expect(taskLimitReason(unknown, { maxTokens: null, budgetUsd: null })).toBeUndefined();
    expect(taskLimitReason(unknown, { maxTokens: 999999, budgetUsd: null })).toContain(
      "未返回完整",
    );
    const unpriced = addTaskUsage(undefined, { ...stats, model: "custom-unknown" }, path);
    expect(unpriced.estimatedCostUsd).toBeNull();
    expect(unpriced.reportedRequests).toBe(1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
