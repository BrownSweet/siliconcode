import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { deliveryConfigPath } from "../src/delivery/config.js";
import {
  approveProduction,
  completeDeliveryStage,
  completeRollback,
  failDeliveryStage,
  finishDeliveryIteration,
  recordDeliveryDocuments,
  recordDeliveryEvidence,
  setDeliveryWorkspace,
  updateAcceptanceCriterion,
} from "../src/delivery/state-machine.js";
import { createDeliveryRun, listDeliveryRuns, loadDeliveryRun } from "../src/delivery/store.js";

const roots: string[] = [];

function root(): string {
  const dir = mkdtempSync(join(tmpdir(), "silicon-delivery-state-"));
  roots.push(dir);
  return dir;
}

function createRun(workspaceRoot = root(), maxDebugRetries = 3) {
  const configPath = deliveryConfigPath(workspaceRoot);
  mkdirSync(dirname(configPath), { recursive: true });
  writeFileSync(
    configPath,
    JSON.stringify({
      version: 1,
      validationCommands: ["npm test"],
      staging: {
        deployCommand: "deploy staging",
        healthCheckCommands: ["check staging"],
        regressionCommands: ["test staging"],
      },
      production: {
        canaryDeployCommand: "deploy production --percent {percent}",
        canaryPercent: 10,
        observationCommands: ["observe production"],
        observationWindowSeconds: 1800,
        rollbackCommand: "rollback production",
        postRollbackHealthCheckCommands: ["check production"],
      },
    }),
  );
  return createDeliveryRun({
    id: "checkout-flow",
    title: "Checkout flow",
    requirement: "Add a reliable checkout flow",
    workspaceRoot,
    maxDebugRetries,
  });
}

function recordDocs(run: ReturnType<typeof createRun>): void {
  recordDeliveryDocuments(run, {
    prd: "# PRD\n\nBuild checkout.",
    sdd: "# SDD\n\nUse the existing service boundary.",
    acceptance: "# Acceptance\n\n- AC-001 passes.",
    criteria: [
      {
        id: "AC-001",
        description: "A valid checkout succeeds",
        verification: "Run the checkout integration test",
      },
    ],
  });
  completeDeliveryStage(run, "prd-agent");
  completeDeliveryStage(run, "prd-agent");
}

function advanceToProductionApproval(run: ReturnType<typeof createRun>): void {
  recordDocs(run);
  setDeliveryWorkspace(run, {
    kind: "git-worktree",
    repositoryRoot: run.workspaceRoot,
    path: join(run.workspaceRoot, "worktree"),
    branch: `siliconcode/delivery-${run.id}`,
    baseRef: "HEAD",
    createdAt: new Date().toISOString(),
  });
  completeDeliveryStage(run, "user");
  recordDeliveryEvidence(run, {
    kind: "changes",
    outcome: "passed",
    summary: "Diff implements checkout",
    actor: "developer",
  });
  completeDeliveryStage(run, "developer");
  recordDeliveryEvidence(run, {
    kind: "test",
    outcome: "passed",
    summary: "npm test exited 0",
    actor: "developer",
    metadata: { command: "npm test", exitCode: 0 },
  });
  completeDeliveryStage(run, "developer");
  const audits = {
    code: "review",
    security: "security-review",
    dependencies: "dependency-review",
    configuration: "configuration-review",
  } as const;
  for (const [dimension, skill] of Object.entries(audits)) {
    recordDeliveryEvidence(run, {
      kind: "audit",
      outcome: "passed",
      summary: `${dimension} audit passed`,
      actor: `reviewer-${dimension}`,
      metadata: { dimension, independent: true, skill },
    });
  }
  completeDeliveryStage(run, "reviewer");
  updateAcceptanceCriterion(run, "AC-001", "passed", "checkout integration test passed");
  recordDeliveryEvidence(run, {
    kind: "acceptance",
    outcome: "passed",
    summary: "All AC criteria passed",
    actor: "e2e-tester",
  });
  completeDeliveryStage(run, "e2e-tester");
  recordDeliveryEvidence(run, {
    kind: "deployment",
    outcome: "passed",
    summary: "Staging deployment completed",
    actor: "release-operator",
    metadata: {
      environment: "staging",
      release: "r1",
      command: "deploy staging",
      exitCode: 0,
    },
  });
  completeDeliveryStage(run, "release-operator");
  recordDeliveryEvidence(run, {
    kind: "health",
    outcome: "passed",
    summary: "Staging health endpoint returned 200",
    actor: "e2e-tester",
    metadata: { command: "check staging", exitCode: 0 },
  });
  recordDeliveryEvidence(run, {
    kind: "regression",
    outcome: "passed",
    summary: "Staging regression suite passed",
    actor: "e2e-tester",
    metadata: { command: "test staging", exitCode: 0 },
  });
  completeDeliveryStage(run, "e2e-tester");
}

afterEach(() => {
  for (const dir of roots.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("delivery state machine", () => {
  it("persists PRD/SDD/acceptance and enforces every gate through completion", () => {
    const run = createRun();
    expect(run.currentStage).toBe("intake");
    expect(listDeliveryRuns(run.workspaceRoot)).toHaveLength(1);

    recordDeliveryDocuments(run, {
      prd: "# PRD\n\nBuild checkout.",
      sdd: "# SDD\n\nUse the service boundary.",
      acceptance: "# Acceptance\n\n- AC-001",
      criteria: [
        {
          id: "AC-001",
          description: "A valid checkout succeeds",
          verification: "Run integration test",
        },
      ],
    });
    expect(() => completeDeliveryStage(run, "prd-agent")).not.toThrow();
    expect(run.currentStage).toBe("acceptance");
    completeDeliveryStage(run, "prd-agent");
    expect(run.currentStage).toBe("workspace");
    expect(readFileSync(run.artifacts.find((a) => a.kind === "prd")!.path, "utf8")).toContain(
      "Build checkout",
    );

    setDeliveryWorkspace(run, {
      kind: "git-worktree",
      repositoryRoot: run.workspaceRoot,
      path: join(run.workspaceRoot, "worktree"),
      branch: "siliconcode/delivery-checkout-flow",
      baseRef: "HEAD",
      createdAt: new Date().toISOString(),
    });
    completeDeliveryStage(run, "user");
    expect(run.currentStage).toBe("development");
    expect(() => completeDeliveryStage(run, "developer")).toThrow(/changes evidence/);
  });

  it("requires independent four-dimension audit and human production approval", () => {
    const run = createRun();
    advanceToProductionApproval(run);
    expect(run.currentStage).toBe("production_approval");
    expect(run.status).toBe("awaiting_production_approval");
    expect(() => completeDeliveryStage(run, "model")).toThrow(/explicit human approval/);

    approveProduction(run, "brown", "Approve 10% canary");
    expect(run.currentStage).toBe("canary_deploy");
    expect(run.productionApproval).toMatchObject({ status: "approved", actor: "brown" });

    recordDeliveryEvidence(run, {
      kind: "deployment",
      outcome: "passed",
      summary: "10% canary deployed",
      actor: "release-operator",
      metadata: {
        environment: "production",
        canaryPercent: 10,
        command: "deploy production --percent 10",
        exitCode: 0,
      },
    });
    completeDeliveryStage(run, "release-operator");
    recordDeliveryEvidence(run, {
      kind: "observation",
      outcome: "passed",
      summary: "30 minute SLO window healthy",
      actor: "observer",
      metadata: { command: "observe production", exitCode: 0, windowSeconds: 1800 },
    });
    completeDeliveryStage(run, "observer");
    finishDeliveryIteration(run, {
      summary: "# Iteration 1\n\nCheckout released and healthy.",
      newIssues: [],
      actor: "team-lead",
    });
    expect(run.status).toBe("completed");
    expect(loadDeliveryRun(run.workspaceRoot, run.id)?.status).toBe("completed");
  });

  it("rejects self-audit and missing audit dimensions", () => {
    const run = createRun();
    recordDocs(run);
    setDeliveryWorkspace(run, {
      kind: "git-worktree",
      repositoryRoot: run.workspaceRoot,
      path: join(run.workspaceRoot, "worktree"),
      branch: "siliconcode/delivery-checkout-flow",
      baseRef: "HEAD",
      createdAt: new Date().toISOString(),
    });
    completeDeliveryStage(run, "user");
    recordDeliveryEvidence(run, {
      kind: "changes",
      outcome: "passed",
      summary: "diff ready",
      actor: "developer",
    });
    completeDeliveryStage(run, "developer");
    recordDeliveryEvidence(run, {
      kind: "test",
      outcome: "passed",
      summary: "tests passed",
      actor: "developer",
      metadata: { command: "npm test", exitCode: 0 },
    });
    completeDeliveryStage(run, "developer");
    const audits = {
      code: "review",
      security: "security-review",
      dependencies: "dependency-review",
      configuration: "configuration-review",
    } as const;
    for (const [dimension, skill] of Object.entries(audits)) {
      recordDeliveryEvidence(run, {
        kind: "audit",
        outcome: "passed",
        summary: `${dimension} audit`,
        actor: dimension === "code" ? "developer" : `reviewer-${dimension}`,
        metadata: { dimension, independent: true, skill },
      });
    }
    expect(() => completeDeliveryStage(run, "developer")).toThrow(/reviewer-code/);
  });

  it("bounds debug retries and never reuses passing evidence from an earlier iteration", () => {
    const run = createRun(root(), 1);
    recordDocs(run);
    setDeliveryWorkspace(run, {
      kind: "git-worktree",
      repositoryRoot: run.workspaceRoot,
      path: join(run.workspaceRoot, "worktree"),
      branch: "siliconcode/delivery-checkout-flow",
      baseRef: "HEAD",
      createdAt: new Date().toISOString(),
    });
    completeDeliveryStage(run, "user");
    recordDeliveryEvidence(run, {
      kind: "changes",
      outcome: "passed",
      summary: "first attempt",
      actor: "developer",
    });
    completeDeliveryStage(run, "developer");
    failDeliveryStage(run, "test failed", "developer");
    expect(run.currentStage).toBe("development");
    expect(run.status).toBe("active");

    recordDeliveryEvidence(run, {
      kind: "changes",
      outcome: "passed",
      summary: "second attempt",
      actor: "developer",
    });
    completeDeliveryStage(run, "developer");
    failDeliveryStage(run, "test still failed", "developer");
    expect(run.status).toBe("failed");
  });

  it("forces rollback after a canary failure", () => {
    const run = createRun();
    advanceToProductionApproval(run);
    approveProduction(run, "brown");
    failDeliveryStage(run, "canary error rate exceeded threshold", "observer");
    expect(run.status).toBe("rolling_back");
    recordDeliveryEvidence(run, {
      stage: "rollback",
      kind: "rollback",
      outcome: "passed",
      summary: "rollback command exited 0",
      actor: "release-operator",
      metadata: { command: "rollback production", exitCode: 0 },
    });
    recordDeliveryEvidence(run, {
      stage: "rollback",
      kind: "health",
      outcome: "passed",
      summary: "post-rollback health check exited 0",
      actor: "release-operator",
      metadata: { command: "check production", exitCode: 0 },
    });
    completeRollback(run, "release-operator", "Previous release restored and health checks pass");
    expect(run.status).toBe("rolled_back");
    expect(run.evidence.at(-1)).toMatchObject({ kind: "rollback", outcome: "passed" });
  });

  it("invalidates development, validation, audit and acceptance evidence after a retry", () => {
    const run = createRun();
    advanceToProductionApproval(run);
    // Model a failed acceptance check before production is approved.
    run.currentStage = "acceptance_gate";
    failDeliveryStage(run, "acceptance regression", "reviewer");
    expect(run.currentStage).toBe("development");
    expect(run.acceptanceCriteria.every((entry) => entry.status === "pending")).toBe(true);
    expect(() => completeDeliveryStage(run, "developer")).toThrow(/changes evidence/);
    recordDeliveryEvidence(run, {
      kind: "changes",
      outcome: "passed",
      actor: "developer",
      summary: "fixed regression",
    });
    completeDeliveryStage(run, "developer");
    expect(() => completeDeliveryStage(run, "developer")).toThrow(/test command evidence/);
    recordDeliveryEvidence(run, {
      kind: "test",
      outcome: "passed",
      actor: "developer",
      summary: "retested",
      metadata: { command: "npm test", exitCode: 0 },
    });
    completeDeliveryStage(run, "developer");
    expect(() => completeDeliveryStage(run, "reviewer")).toThrow(/independent audit evidence/);
    expect(run.evidence.some((entry) => entry.kind === "audit")).toBe(true);
    expect(run.stages.audit.evidenceIds).toEqual([]);
  });
});
