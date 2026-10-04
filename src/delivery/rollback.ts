import { runCommand } from "../tools/shell/exec.js";
import { loadDeliveryConfig } from "./config.js";
import { completeRollback, recordDeliveryEvidence } from "./state-machine.js";
import type { DeliveryRun } from "./types.js";

async function execute(
  run: DeliveryRun,
  command: string,
  kind: "rollback" | "health",
  actor: string,
) {
  const cwd = run.workspace?.path;
  if (!cwd) throw new Error("rollback requires the persisted delivery worktree");
  const result = await runCommand(command, { cwd, timeoutSec: 600 });
  recordDeliveryEvidence(run, {
    stage: "rollback",
    kind,
    outcome: result.exitCode === 0 && !result.timedOut ? "passed" : "failed",
    summary: `${kind} command ${result.timedOut ? "timed out" : `exited ${result.exitCode ?? "unknown"}`}`,
    actor,
    metadata: { command, exitCode: result.exitCode, timedOut: result.timedOut },
  });
  if (result.exitCode !== 0 || result.timedOut) {
    throw new Error(
      `${kind} command failed: ${command} (${result.timedOut ? "timeout" : `exit ${result.exitCode ?? "unknown"}`})`,
    );
  }
}

export async function executeConfiguredRollback(
  run: DeliveryRun,
  actor: string,
  operatorNote?: string,
): Promise<void> {
  if (run.status !== "rolling_back") {
    throw new Error(`rollback is unavailable while run is ${run.status}`);
  }
  const config = loadDeliveryConfig(run.workspaceRoot);
  if (!config) throw new Error("delivery config is missing; cannot execute rollback");
  await execute(run, config.production.rollbackCommand, "rollback", actor);
  for (const command of config.production.postRollbackHealthCheckCommands) {
    await execute(run, command, "health", actor);
  }
  const note = operatorNote?.trim();
  completeRollback(
    run,
    actor,
    note
      ? `Configured rollback and post-rollback health checks passed. ${note}`
      : "Configured rollback and post-rollback health checks passed.",
  );
}
