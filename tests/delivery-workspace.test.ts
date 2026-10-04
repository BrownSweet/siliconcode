import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { completeDeliveryStage, recordDeliveryDocuments } from "../src/delivery/state-machine.js";
import { createDeliveryRun } from "../src/delivery/store.js";
import { prepareDeliveryWorkspace } from "../src/delivery/workspace.js";

const roots: string[] = [];

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

afterEach(() => {
  for (const dir of roots.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("delivery isolated workspace", () => {
  it("creates a dedicated branch and git worktree, then advances to development", () => {
    const parent = mkdtempSync(join(tmpdir(), "silicon-delivery-worktree-"));
    roots.push(parent);
    const repo = join(parent, "repo");
    mkdirSync(repo);
    git(repo, ["init", "-b", "main"]);
    git(repo, ["config", "user.name", "Test"]);
    git(repo, ["config", "user.email", "test@example.com"]);
    writeFileSync(join(repo, "README.md"), "# fixture\n", "utf8");
    git(repo, ["add", "README.md"]);
    git(repo, ["commit", "-m", "initial"]);

    const run = createDeliveryRun({
      id: "isolated-change",
      title: "Isolated change",
      requirement: "Change the fixture safely",
      workspaceRoot: repo,
    });
    recordDeliveryDocuments(run, {
      prd: "# PRD",
      sdd: "# SDD",
      acceptance: "# Acceptance",
      criteria: [{ id: "AC-001", description: "works", verification: "test" }],
    });
    completeDeliveryStage(run, "prd-agent");
    completeDeliveryStage(run, "prd-agent");

    const workspace = prepareDeliveryWorkspace(run, { actor: "brown" });
    expect(run.currentStage).toBe("development");
    expect(workspace.path).not.toBe(repo);
    expect(git(workspace.path, ["branch", "--show-current"])).toBe(
      "siliconcode/delivery-isolated-change",
    );
    expect(git(repo, ["worktree", "list", "--porcelain"])).toContain(workspace.path);
  });
});
