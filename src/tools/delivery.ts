/** Model-facing tools for the durable delivery workflow. Human production approval stays CLI/Web-only. */

import { deliveryConfigPath, loadDeliveryConfig } from "../delivery/config.js";
import { executeConfiguredRollback } from "../delivery/rollback.js";
import {
  completeDeliveryStage,
  failDeliveryStage,
  finishDeliveryIteration,
  recordDeliveryDocuments,
  recordDeliveryEvidence,
  updateAcceptanceCriterion,
} from "../delivery/state-machine.js";
import { createDeliveryRun, listDeliveryRuns, loadDeliveryRun } from "../delivery/store.js";
import type {
  DeliveryAcceptanceCriterion,
  DeliveryEvidenceKind,
  DeliveryRun,
} from "../delivery/types.js";
import type { ToolRegistry } from "../tools.js";

export interface DeliveryToolsOptions {
  workspaceRoot: string;
  /** Trust only a worktree already persisted by the human CLI/Web workspace gate. */
  addWorkspaceRoot?: (path: string) => { roots: string[] } | { error: string };
}

function requireRun(workspaceRoot: string, runId: unknown): DeliveryRun {
  const id = typeof runId === "string" ? runId.trim() : "";
  if (!id) throw new Error("runId is required");
  const run = loadDeliveryRun(workspaceRoot, id);
  if (!run) throw new Error(`delivery run not found: ${id}`);
  return run;
}

function runSummary(run: DeliveryRun): Record<string, unknown> {
  return {
    id: run.id,
    title: run.title,
    status: run.status,
    currentStage: run.currentStage,
    iteration: run.iteration,
    workspace: run.workspace,
    productionApproval: run.productionApproval,
    acceptanceCriteria: run.acceptanceCriteria,
    stages: run.stages,
    artifacts: run.artifacts,
    newIssues: run.newIssues,
  };
}

export function registerDeliveryTools(
  registry: ToolRegistry,
  opts: DeliveryToolsOptions,
): ToolRegistry {
  registry.register({
    name: "delivery_create",
    description:
      "Create a durable autonomous-delivery run from a vague requirement. Use this before the prd-agent intake when no runId exists. This persists workflow state only; it does not edit product code or approve production.",
    readOnly: false,
    parameters: {
      type: "object",
      properties: {
        title: { type: "string", description: "Short human-readable delivery title." },
        requirement: { type: "string", description: "The user's original requirement verbatim." },
        id: { type: "string", description: "Optional lowercase kebab-case run id." },
        maxDebugRetries: {
          type: "integer",
          description: "Maximum debug retries after a failed validation/audit gate (default 3).",
        },
        maxIterations: {
          type: "integer",
          description: "Maximum develop-to-observe iterations (default 10).",
        },
      },
      required: ["title", "requirement"],
    },
    fn: async (args: {
      title: string;
      requirement: string;
      id?: string;
      maxDebugRetries?: number;
      maxIterations?: number;
    }) => {
      const run = createDeliveryRun({
        id: args.id,
        title: args.title,
        requirement: args.requirement,
        workspaceRoot: opts.workspaceRoot,
        maxDebugRetries: args.maxDebugRetries,
        maxIterations: args.maxIterations,
      });
      return JSON.stringify(runSummary(run));
    },
  });

  registry.register({
    name: "delivery_status",
    description:
      "Read one delivery run, or list all delivery runs when runId is omitted. Use before taking action so the persisted currentStage is authoritative.",
    readOnly: true,
    parallelSafe: true,
    stormExempt: true,
    parameters: {
      type: "object",
      properties: {
        runId: { type: "string", description: "Optional delivery run id." },
      },
    },
    fn: async (args: { runId?: string }) => {
      if (args.runId?.trim())
        return JSON.stringify(runSummary(requireRun(opts.workspaceRoot, args.runId)));
      return JSON.stringify(listDeliveryRuns(opts.workspaceRoot).map(runSummary));
    },
  });

  registry.register({
    name: "delivery_config",
    description:
      "Read the validated project delivery automation config. The configured validation, staging, health, regression, canary, observation, and rollback commands are the only commands the delivery agent may treat as authoritative.",
    readOnly: true,
    parallelSafe: true,
    parameters: { type: "object", properties: {} },
    fn: async () => {
      const config = loadDeliveryConfig(opts.workspaceRoot);
      if (!config) {
        throw new Error(
          `delivery automation config is missing: ${deliveryConfigPath(opts.workspaceRoot)}; run brown delivery init-config and replace every placeholder`,
        );
      }
      return JSON.stringify(config);
    },
  });

  registry.register({
    name: "delivery_record_documents",
    description:
      "Persist the prd-agent output as PRD.md, SDD.md, ACCEPTANCE.md, and structured acceptance criteria. Valid only during intake/acceptance. On success it closes both gates and advances to workspace creation.",
    readOnly: false,
    parameters: {
      type: "object",
      properties: {
        runId: { type: "string" },
        prd: { type: "string", description: "Complete product requirements document in Markdown." },
        sdd: { type: "string", description: "Complete software design document in Markdown." },
        acceptance: {
          type: "string",
          description: "Human-readable acceptance plan in Markdown.",
        },
        criteria: {
          type: "array",
          items: {
            type: "object",
            properties: {
              id: { type: "string" },
              description: { type: "string" },
              verification: { type: "string" },
            },
            required: ["id", "description", "verification"],
          },
        },
        actor: { type: "string", description: "Defaults to prd-agent." },
      },
      required: ["runId", "prd", "sdd", "acceptance", "criteria"],
    },
    fn: async (args: {
      runId: string;
      prd: string;
      sdd: string;
      acceptance: string;
      criteria: Array<Pick<DeliveryAcceptanceCriterion, "id" | "description" | "verification">>;
      actor?: string;
    }) => {
      const run = requireRun(opts.workspaceRoot, args.runId);
      const actor = args.actor?.trim() || "prd-agent";
      recordDeliveryDocuments(run, { ...args, actor });
      if (run.currentStage === "intake") completeDeliveryStage(run, actor);
      if (run.currentStage === "acceptance") completeDeliveryStage(run, actor);
      return JSON.stringify(runSummary(run));
    },
  });

  registry.register({
    name: "delivery_activate_workspace",
    description:
      "Add the run's already human-created git worktree to this code session's filesystem sandbox. This cannot choose an arbitrary path and cannot create a worktree; it only activates the exact persisted run.workspace path.",
    readOnly: false,
    parameters: {
      type: "object",
      properties: {
        runId: { type: "string" },
      },
      required: ["runId"],
    },
    fn: async (args: { runId: string }) => {
      const run = requireRun(opts.workspaceRoot, args.runId);
      if (!run.workspace) throw new Error("delivery workspace has not been created by the user");
      if (!opts.addWorkspaceRoot) {
        throw new Error("this host cannot add a delivery workspace root");
      }
      const result = opts.addWorkspaceRoot(run.workspace.path);
      if ("error" in result && !result.error.includes("already")) throw new Error(result.error);
      return JSON.stringify({
        runId: run.id,
        workspace: run.workspace,
        roots: "roots" in result ? result.roots : [opts.workspaceRoot, run.workspace.path],
      });
    },
  });

  registry.register({
    name: "delivery_record_evidence",
    description:
      "Record evidence for the current delivery stage. Evidence does not advance the gate by itself; call delivery_complete_stage after all required evidence exists. Never claim a command/test/deployment passed unless its real result was observed.",
    readOnly: false,
    parameters: {
      type: "object",
      properties: {
        runId: { type: "string" },
        kind: {
          type: "string",
          enum: [
            "requirement",
            "document",
            "changes",
            "test",
            "audit",
            "acceptance",
            "deployment",
            "health",
            "regression",
            "observation",
            "rollback",
            "summary",
          ],
        },
        outcome: { type: "string", enum: ["passed", "failed", "info"] },
        summary: { type: "string" },
        actor: { type: "string" },
        metadata: {
          type: "object",
          description:
            "Stage-specific facts, e.g. audit dimension+independent, deployment environment+canaryPercent, command+exitCode.",
          additionalProperties: true,
        },
      },
      required: ["runId", "kind", "outcome", "summary", "actor"],
    },
    fn: async (args: {
      runId: string;
      kind: DeliveryEvidenceKind;
      outcome: "passed" | "failed" | "info";
      summary: string;
      actor: string;
      metadata?: Record<string, unknown>;
    }) => {
      const run = requireRun(opts.workspaceRoot, args.runId);
      const evidence = recordDeliveryEvidence(run, args);
      return JSON.stringify({ evidence, run: runSummary(run) });
    },
  });

  registry.register({
    name: "delivery_acceptance_result",
    description:
      "Set one structured acceptance criterion to passed/failed with observed evidence. Valid only at acceptance_gate.",
    readOnly: false,
    parameters: {
      type: "object",
      properties: {
        runId: { type: "string" },
        criterionId: { type: "string" },
        status: { type: "string", enum: ["passed", "failed"] },
        evidence: { type: "string" },
      },
      required: ["runId", "criterionId", "status", "evidence"],
    },
    fn: async (args: {
      runId: string;
      criterionId: string;
      status: "passed" | "failed";
      evidence: string;
    }) => {
      const run = requireRun(opts.workspaceRoot, args.runId);
      updateAcceptanceCriterion(run, args.criterionId, args.status, args.evidence);
      return JSON.stringify(runSummary(run));
    },
  });

  registry.register({
    name: "delivery_complete_stage",
    description:
      "Validate evidence for the persisted current stage and advance exactly one gate. Production approval is deliberately impossible through this model tool and requires a human CLI/Web action.",
    readOnly: false,
    parameters: {
      type: "object",
      properties: {
        runId: { type: "string" },
        actor: { type: "string" },
      },
      required: ["runId", "actor"],
    },
    fn: async (args: { runId: string; actor: string }) => {
      const run = requireRun(opts.workspaceRoot, args.runId);
      completeDeliveryStage(run, args.actor);
      return JSON.stringify(runSummary(run));
    },
  });

  registry.register({
    name: "delivery_fail_stage",
    description:
      "Record a real stage failure. Validation/audit/acceptance failures return to development until the configured retry limit; canary/observation failures enter mandatory rollback.",
    readOnly: false,
    parameters: {
      type: "object",
      properties: {
        runId: { type: "string" },
        error: { type: "string" },
        actor: { type: "string" },
      },
      required: ["runId", "error", "actor"],
    },
    fn: async (args: { runId: string; error: string; actor: string }) => {
      const run = requireRun(opts.workspaceRoot, args.runId);
      failDeliveryStage(run, args.error, args.actor);
      return JSON.stringify(runSummary(run));
    },
  });

  registry.register({
    name: "delivery_finish_iteration",
    description:
      "Record iteration results and newly discovered issues. No new issues completes the run; otherwise it starts the next development cycle up to maxIterations.",
    readOnly: false,
    parameters: {
      type: "object",
      properties: {
        runId: { type: "string" },
        summary: { type: "string" },
        newIssues: { type: "array", items: { type: "string" } },
        actor: { type: "string" },
      },
      required: ["runId", "summary", "newIssues", "actor"],
    },
    fn: async (args: { runId: string; summary: string; newIssues: string[]; actor: string }) => {
      const run = requireRun(opts.workspaceRoot, args.runId);
      finishDeliveryIteration(run, args);
      return JSON.stringify(runSummary(run));
    },
  });

  registry.register({
    name: "delivery_complete_rollback",
    description:
      "After a real configured rollback command and post-rollback health check have succeeded, persist the observed rollback result and terminate the run as rolled_back. Valid only while status=rolling_back.",
    readOnly: false,
    parameters: {
      type: "object",
      properties: {
        runId: { type: "string" },
        actor: { type: "string" },
        summary: {
          type: "string",
          description: "Observed rollback command result and health-check evidence.",
        },
      },
      required: ["runId", "actor", "summary"],
    },
    fn: async (args: { runId: string; actor: string; summary: string }) => {
      const run = requireRun(opts.workspaceRoot, args.runId);
      await executeConfiguredRollback(run, args.actor, args.summary);
      return JSON.stringify(runSummary(run));
    },
  });

  return registry;
}
