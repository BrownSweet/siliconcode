import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { deliveryConfigPath } from "../src/delivery/config.js";
import { executeConfiguredRollback } from "../src/delivery/rollback.js";
import { createDeliveryRun, saveDeliveryRun } from "../src/delivery/store.js";

describe("configured rollback executor", () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "siliconcode-delivery-rollback-"));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  function runWithConfig(rollbackCommand: string) {
    const path = deliveryConfigPath(root);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(
      path,
      JSON.stringify({
        version: 1,
        validationCommands: ["node --version"],
        staging: {
          deployCommand: "node --version",
          healthCheckCommands: ["node --version"],
          regressionCommands: ["node --version"],
        },
        production: {
          canaryDeployCommand: "node --version {percent}",
          canaryPercent: 10,
          observationCommands: ["node --version"],
          observationWindowSeconds: 1,
          rollbackCommand,
          postRollbackHealthCheckCommands: ["node --version"],
        },
      }),
    );
    const run = createDeliveryRun({
      id: "rollback-run",
      title: "Rollback",
      requirement: "Rollback a failed canary",
      workspaceRoot: root,
    });
    run.status = "rolling_back";
    run.workspace = {
      kind: "git-worktree",
      repositoryRoot: root,
      path: root,
      branch: "siliconcode/delivery-rollback-run",
      baseRef: "HEAD",
      createdAt: new Date().toISOString(),
    };
    saveDeliveryRun(run);
    return run;
  }

  it("executes the configured rollback and post-rollback health checks", async () => {
    const run = runWithConfig("node --version");
    await executeConfiguredRollback(run, "operator");
    expect(run.status).toBe("rolled_back");
    expect(run.evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ stage: "rollback", kind: "rollback", outcome: "passed" }),
        expect.objectContaining({ stage: "rollback", kind: "health", outcome: "passed" }),
      ]),
    );
  });

  it("stays in rollback when the configured command fails", async () => {
    const run = runWithConfig('node -e "process.exit(2)"');
    await expect(executeConfiguredRollback(run, "operator")).rejects.toThrow(/exit 2/);
    expect(run.status).toBe("rolling_back");
    expect(run.evidence.at(-1)).toMatchObject({ kind: "rollback", outcome: "failed" });
  });
});
