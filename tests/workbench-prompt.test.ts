import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { workbenchPrompt } from "../src/workbench/prompt.js";

const roots: string[] = [];
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "silicon-prompt-"));
  roots.push(root);
  return root;
}
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

it.each(["clarify", "development", "review"] as const)(
  "loads project rules for %s without unavailable TUI tools",
  (phase) => {
    const root = fixture();
    writeFileSync(join(root, "AGENTS.md"), "项目约定：所有金额使用分存储。");
    writeFileSync(join(root, "SILICON.md"), "lower priority marker");
    const tools =
      phase === "development"
        ? ["read_file", "write_file", "run_command"]
        : ["read_file", phase === "clarify" ? "record_requirements" : "record_review"];
    const prompt = workbenchPrompt(root, phase, tools);
    expect(prompt).toContain(`实际可调用工具：${tools.join("、")}`);
    expect(prompt).toContain("所有金额使用分存储");
    expect(prompt).not.toContain("lower priority marker");
    for (const unavailable of [
      "submit_plan",
      "ask_choice",
      "todo_write",
      "run_skill",
      "recall_memory",
      "run_background",
    ])
      expect(prompt).not.toContain(unavailable);
    if (phase !== "development") expect(prompt).not.toContain("run_command");
  },
);

it("rejects project rule links escaping the selected directory", () => {
  const root = fixture();
  const repo = join(root, "repo");
  mkdirSync(repo);
  writeFileSync(join(root, "outside.md"), "private outside data");
  symlinkSync(join(root, "outside.md"), join(repo, "AGENTS.md"));
  expect(() => workbenchPrompt(repo, "development", ["read_file"])).toThrow("工作目录外");
});
