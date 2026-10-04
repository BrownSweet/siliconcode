import { resolve } from "node:path";
import { initializeDeliveryConfig, loadDeliveryConfig } from "../../delivery/config.js";
import { executeConfiguredRollback } from "../../delivery/rollback.js";
import { approveProduction, rejectProduction } from "../../delivery/state-machine.js";
import { createDeliveryRun, listDeliveryRuns, loadDeliveryRun } from "../../delivery/store.js";
import type { DeliveryRun } from "../../delivery/types.js";
import { prepareDeliveryWorkspace } from "../../delivery/workspace.js";

function requireRun(workspaceRoot: string, runId: string): DeliveryRun {
  const run = loadDeliveryRun(resolve(workspaceRoot), runId);
  if (!run) throw new Error(`delivery run not found: ${runId}`);
  return run;
}

function concise(run: DeliveryRun): Record<string, unknown> {
  return {
    id: run.id,
    title: run.title,
    status: run.status,
    currentStage: run.currentStage,
    iteration: run.iteration,
    workspace: run.workspace ?? null,
    productionApproval: run.productionApproval,
    acceptance: {
      total: run.acceptanceCriteria.length,
      passed: run.acceptanceCriteria.filter((criterion) => criterion.status === "passed").length,
      failed: run.acceptanceCriteria.filter((criterion) => criterion.status === "failed").length,
    },
    updatedAt: run.updatedAt,
  };
}

function print(value: unknown, json = false): void {
  if (json) {
    process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
    return;
  }
  process.stdout.write(`${typeof value === "string" ? value : JSON.stringify(value, null, 2)}\n`);
}

export function deliveryCreateCommand(opts: {
  workspaceRoot?: string;
  title?: string;
  requirement: string;
  id?: string;
  maxDebugRetries?: number;
  maxIterations?: number;
  json?: boolean;
}): DeliveryRun {
  const workspaceRoot = resolve(opts.workspaceRoot ?? process.cwd());
  const title = opts.title?.trim() || opts.requirement.trim().slice(0, 60);
  const run = createDeliveryRun({
    id: opts.id,
    title,
    requirement: opts.requirement,
    workspaceRoot,
    maxDebugRetries: opts.maxDebugRetries,
    maxIterations: opts.maxIterations,
  });
  if (opts.json) {
    print(run, true);
  } else {
    print(
      [
        `✓ delivery run created: ${run.id}`,
        `  stage: ${run.currentStage}`,
        `  state: .siliconcode/delivery/runs/${run.id}/run.json`,
        "",
        "Next: open `brown code` and run:",
        `  /skill prd-agent delivery run ${run.id}; original requirement is stored in the run`,
      ].join("\n"),
    );
  }
  return run;
}

export function deliveryListCommand(opts: {
  workspaceRoot?: string;
  json?: boolean;
}): DeliveryRun[] {
  const runs = listDeliveryRuns(resolve(opts.workspaceRoot ?? process.cwd()));
  if (opts.json) {
    print(runs, true);
  } else if (runs.length === 0) {
    print("(no delivery runs)");
  } else {
    print(
      runs
        .map(
          (run) =>
            `${run.id.padEnd(32)} ${run.status.padEnd(31)} ${run.currentStage.padEnd(22)} iter=${run.iteration}`,
        )
        .join("\n"),
    );
  }
  return runs;
}

export function deliveryStatusCommand(opts: {
  workspaceRoot?: string;
  runId: string;
  json?: boolean;
}): DeliveryRun {
  const run = requireRun(resolve(opts.workspaceRoot ?? process.cwd()), opts.runId);
  print(opts.json ? run : concise(run), Boolean(opts.json));
  return run;
}

export function deliveryWorkspaceCommand(opts: {
  workspaceRoot?: string;
  runId: string;
  baseRef?: string;
  actor?: string;
  json?: boolean;
}): DeliveryRun {
  const root = resolve(opts.workspaceRoot ?? process.cwd());
  const run = requireRun(root, opts.runId);
  const workspace = prepareDeliveryWorkspace(run, {
    baseRef: opts.baseRef,
    actor: opts.actor ?? "user",
  });
  print(opts.json ? run : { ...concise(run), workspace }, Boolean(opts.json));
  return run;
}

export function deliveryApproveCommand(opts: {
  workspaceRoot?: string;
  runId: string;
  actor: string;
  comment?: string;
  json?: boolean;
}): DeliveryRun {
  const run = requireRun(resolve(opts.workspaceRoot ?? process.cwd()), opts.runId);
  approveProduction(run, opts.actor, opts.comment);
  print(opts.json ? run : concise(run), Boolean(opts.json));
  return run;
}

export function deliveryRejectCommand(opts: {
  workspaceRoot?: string;
  runId: string;
  actor: string;
  comment: string;
  json?: boolean;
}): DeliveryRun {
  const run = requireRun(resolve(opts.workspaceRoot ?? process.cwd()), opts.runId);
  rejectProduction(run, opts.actor, opts.comment);
  print(opts.json ? run : concise(run), Boolean(opts.json));
  return run;
}

export async function deliveryRollbackCompleteCommand(opts: {
  workspaceRoot?: string;
  runId: string;
  actor: string;
  summary: string;
  json?: boolean;
}): Promise<DeliveryRun> {
  const run = requireRun(resolve(opts.workspaceRoot ?? process.cwd()), opts.runId);
  await executeConfiguredRollback(run, opts.actor, opts.summary);
  print(opts.json ? run : concise(run), Boolean(opts.json));
  return run;
}

export function deliveryInitConfigCommand(opts: {
  workspaceRoot?: string;
  force?: boolean;
  json?: boolean;
}): string {
  const root = resolve(opts.workspaceRoot ?? process.cwd());
  const path = initializeDeliveryConfig(root, opts.force === true);
  print(
    opts.json
      ? { path }
      : `✓ created ${path}\nReplace every REPLACE_WITH_* placeholder before autonomous validation or deployment.`,
    Boolean(opts.json),
  );
  return path;
}

export function deliveryConfigCommand(opts: {
  workspaceRoot?: string;
  json?: boolean;
}): unknown {
  const root = resolve(opts.workspaceRoot ?? process.cwd());
  const config = loadDeliveryConfig(root);
  if (!config) throw new Error("delivery config is missing; run brown delivery init-config");
  print(config, Boolean(opts.json));
  return config;
}
