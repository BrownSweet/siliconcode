import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

export function gitCommand(cwd: string, args: string[], gitBin = "git"): string {
  return execFileSync(gitBin, args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 30_000,
    maxBuffer: 8 * 1024 * 1024,
  }).trim();
}

/** Shared Git operation; callers retain their own workflow and persistence. */
export function createGitWorktree(options: {
  repository: string;
  path: string;
  branch: string;
  baseRef?: string;
  reuseBranch?: boolean;
  gitBin?: string;
}) {
  const git = (cwd: string, args: string[]) => gitCommand(cwd, args, options.gitBin);
  const repositoryRoot = resolve(git(options.repository, ["rev-parse", "--show-toplevel"]));
  const baseRef = options.baseRef?.trim() || "HEAD";
  const baseCommit = git(repositoryRoot, [
    "rev-parse",
    "--verify",
    "--end-of-options",
    `${baseRef}^{commit}`,
  ]);
  git(repositoryRoot, ["check-ref-format", "--branch", options.branch]);
  const path = resolve(options.path);
  if (existsSync(path)) throw new Error(`worktree path already exists: ${path}`);
  let branchExists = false;
  try {
    git(repositoryRoot, ["show-ref", "--verify", "--quiet", `refs/heads/${options.branch}`]);
    branchExists = true;
  } catch {
    /* branch does not exist */
  }
  if (branchExists && !options.reuseBranch) throw new Error("worktree branch already exists");
  mkdirSync(dirname(path), { recursive: true });
  git(
    repositoryRoot,
    branchExists
      ? ["worktree", "add", path, options.branch]
      : ["worktree", "add", "-b", options.branch, path, baseCommit],
  );
  return { repositoryRoot, path, branch: options.branch, baseRef, baseCommit };
}
