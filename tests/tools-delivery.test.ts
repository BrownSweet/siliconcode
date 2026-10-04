import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  completeDeliveryStage,
  recordDeliveryDocuments,
  setDeliveryWorkspace,
} from "../src/delivery/state-machine.js";
import { createDeliveryRun } from "../src/delivery/store.js";
import { ToolRegistry } from "../src/tools.js";
import { registerDeliveryTools } from "../src/tools/delivery.js";

describe("delivery model tools", () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "siliconcode-delivery-tools-"));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("never exposes a model production-approval capability", () => {
    const registry = new ToolRegistry();
    registerDeliveryTools(registry, { workspaceRoot: root });
    expect(registry.has("delivery_status")).toBe(true);
    expect(registry.has("delivery_config")).toBe(true);
    expect(registry.has("delivery_approve_production")).toBe(false);
    expect(registry.specs().map((spec) => spec.function.name)).not.toContain(
      "delivery_approve_production",
    );
  });

  it("activates only the exact worktree persisted by the human gate", async () => {
    const run = createDeliveryRun({
      id: "tool-workspace",
      title: "Tool workspace",
      requirement: "Use an isolated workspace",
      workspaceRoot: root,
    });
    recordDeliveryDocuments(run, {
      prd: "# PRD",
      sdd: "# SDD",
      acceptance: "# Acceptance",
      criteria: [{ id: "AC-001", description: "isolated", verification: "inspect path" }],
    });
    completeDeliveryStage(run, "prd-agent");
    completeDeliveryStage(run, "prd-agent");
    const worktree = join(root, "trusted-worktree");
    mkdirSync(worktree);
    setDeliveryWorkspace(run, {
      kind: "git-worktree",
      repositoryRoot: root,
      path: worktree,
      branch: "siliconcode/delivery-tool-workspace",
      baseRef: "HEAD",
      createdAt: new Date().toISOString(),
    });
    completeDeliveryStage(run, "user");
    const seen: string[] = [];
    const registry = new ToolRegistry();
    registerDeliveryTools(registry, {
      workspaceRoot: root,
      addWorkspaceRoot: (path) => {
        seen.push(path);
        return { roots: [root, path] };
      },
    });
    const output = await registry.dispatch(
      "delivery_activate_workspace",
      JSON.stringify({ runId: run.id, path: join(root, "untrusted") }),
    );
    expect(seen).toEqual([worktree]);
    expect(JSON.parse(output)).toMatchObject({ workspace: { path: worktree } });
  });

  it("fails closed when deployment configuration is missing", async () => {
    const registry = new ToolRegistry();
    registerDeliveryTools(registry, { workspaceRoot: root });
    const output = await registry.dispatch("delivery_config", "{}");
    expect(JSON.parse(output).error).toMatch(/init-config/);
  });
});
