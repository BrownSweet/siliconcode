import { basename, dirname, join, resolve } from "node:path";
import { createGitWorktree, gitCommand } from "../git-worktree.js";
import { completeDeliveryStage, setDeliveryWorkspace } from "./state-machine.js";
import type { DeliveryRun, DeliveryWorkspace } from "./types.js";

export interface PrepareDeliveryWorkspaceOptions {
  baseRef?: string;
  actor?: string;
  /** Test seam. Production callers use git from PATH. */
  gitBin?: string;
}

export function deliveryWorktreePath(repositoryRoot: string, runId: string): string {
  const root = resolve(repositoryRoot);
  return join(dirname(root), ".siliconcode-worktrees", `${basename(root)}-${runId}`);
}

export function prepareDeliveryWorkspace(
  run: DeliveryRun,
  opts: PrepareDeliveryWorkspaceOptions = {},
): DeliveryWorkspace {
  if (run.currentStage !== "workspace") {
    throw new Error(`delivery workspace is unavailable at ${run.currentStage}`);
  }
  if (run.workspace) return run.workspace;
  const repositoryRoot = resolve(
    gitCommand(run.workspaceRoot, ["rev-parse", "--show-toplevel"], opts.gitBin),
  );
  const created = createGitWorktree({
    repository: repositoryRoot,
    path: deliveryWorktreePath(repositoryRoot, run.id),
    branch: `siliconcode/delivery-${run.id}`,
    baseRef: opts.baseRef,
    reuseBranch: true,
    gitBin: opts.gitBin,
  });
  const workspace: DeliveryWorkspace = {
    kind: "git-worktree",
    repositoryRoot: created.repositoryRoot,
    path: created.path,
    branch: created.branch,
    baseRef: created.baseRef,
    createdAt: new Date().toISOString(),
  };
  const actor = opts.actor?.trim() || "user";
  setDeliveryWorkspace(run, workspace, actor);
  completeDeliveryStage(run, actor);
  return workspace;
}
