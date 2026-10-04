import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { createGitWorktree, gitCommand } from "../git-worktree.js";
import { type Project, WorkbenchError, type WorkbenchStore } from "./store.js";

export function createWorkbenchWorkspace(store: WorkbenchStore, owner: string, projectId: string) {
  const project = store.project(owner, projectId);
  if (project.workspace) throw new WorkbenchError(409, "请从原项目创建新的隔离工作区");
  let root: string;
  try {
    root = realpathSync(gitCommand(project.workdir, ["rev-parse", "--show-toplevel"]));
  } catch {
    throw new WorkbenchError(409, "隔离工作区需要已有提交的 Git 仓库；普通目录可直接开发");
  }
  if (root !== project.workdir) throw new WorkbenchError(409, "请先将 Git 仓库根目录添加为项目");
  const parentBranch = gitCommand(root, ["branch", "--show-current"]);
  if (!parentBranch) throw new WorkbenchError(409, "原项目处于 detached HEAD，请先切换到分支");
  const key = randomUUID();
  const created = createGitWorktree({
    repository: root,
    path: join(dirname(root), ".siliconcode-worktrees", `${basename(root)}-${key}`),
    branch: `codex/workbench-${key}`,
  });
  const isolated = store.addProject(
    owner,
    created.path,
    `${project.name} · 隔离 ${key.slice(0, 8)}`,
  );
  return store.setWorkspace(owner, isolated.id, {
    parentProjectId: project.id,
    repositoryRoot: root,
    branch: created.branch,
    parentBranch,
    baseCommit: created.baseCommit,
  });
}

function sourceProject(store: WorkbenchStore, owner: string, projectId: string) {
  const project = store.project(owner, projectId);
  const workspace = project.workspace;
  if (!workspace) throw new WorkbenchError(409, "此项目不是工作台创建的隔离工作区");
  const parent = store.project(owner, workspace.parentProjectId);
  const commonDir = (cwd: string) =>
    realpathSync(resolve(cwd, gitCommand(cwd, ["rev-parse", "--git-common-dir"])));
  if (
    parent.workdir !== workspace.repositoryRoot ||
    gitCommand(project.workdir, ["branch", "--show-current"]) !== workspace.branch ||
    commonDir(project.workdir) !== commonDir(parent.workdir)
  ) {
    throw new WorkbenchError(409, "工作区分支或原仓库已变化，请先核对 Git 状态");
  }
  return { project, parent, workspace };
}

/** Temporary index includes tracked edits, deletions and nonignored new files; never stages the user's index. */
function snapshotTree(project: Project) {
  const scratch = mkdtempSync(join(tmpdir(), "silicon-worktree-index-"));
  try {
    const git = (args: string[]) =>
      execFileSync("git", args, {
        cwd: project.workdir,
        env: { ...process.env, GIT_INDEX_FILE: join(scratch, "index") },
        stdio: ["ignore", "pipe", "pipe"],
        encoding: "utf8",
        timeout: 30_000,
        maxBuffer: 8 * 1024 * 1024,
      }).trim();
    git(["read-tree", "HEAD"]);
    git(["add", "--all", "--", "."]);
    if (
      git(["ls-files", "--stage"])
        .split("\n")
        .some((line) => line.startsWith("160000 "))
    )
      throw new WorkbenchError(409, "暂不支持合并包含子模块或嵌套 Git 仓库的工作区");
    return git(["write-tree"]);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

export function reviewWorkbenchWorkspace(store: WorkbenchStore, owner: string, projectId: string) {
  const { project, parent, workspace } = sourceProject(store, owner, projectId);
  const tree = snapshotTree(project);
  const targetHead = gitCommand(parent.workdir, ["rev-parse", "HEAD"]);
  const targetBranch = gitCommand(parent.workdir, ["branch", "--show-current"]);
  const targetDirty = Boolean(
    gitCommand(parent.workdir, ["status", "--porcelain", "--untracked-files=all"]),
  );
  const changed =
    tree !== gitCommand(parent.workdir, ["rev-parse", `${workspace.baseCommit}^{tree}`]);
  return {
    tree,
    targetHead,
    targetBranch,
    baseCommit: workspace.baseCommit,
    targetPath: parent.workdir,
    branch: workspace.branch,
    changed,
    mergeable:
      !workspace.mergedCommit &&
      !targetDirty &&
      targetHead === workspace.baseCommit &&
      targetBranch === workspace.parentBranch &&
      changed,
    reason: workspace.mergedCommit
      ? `已合并为 ${workspace.mergedCommit}`
      : targetDirty
        ? "原项目有未提交内容，请先自行提交或保存后再合并"
        : targetBranch !== workspace.parentBranch
          ? "原项目已切换分支，请先切回创建工作区时的分支"
          : targetHead !== workspace.baseCommit
            ? "原项目已有新提交，请在 Git 中人工整合，工作台不会覆盖"
            : !changed
              ? "尚无文件变更"
              : "原项目可快进合并",
    diff: gitCommand(project.workdir, [
      "diff",
      "--no-ext-diff",
      "--no-textconv",
      workspace.baseCommit,
      tree,
      "--",
    ]),
  };
}

export function mergeWorkbenchWorkspace(
  store: WorkbenchStore,
  owner: string,
  projectId: string,
  expected: { tree: string; targetHead: string },
) {
  const { parent, workspace } = sourceProject(store, owner, projectId);
  const review = reviewWorkbenchWorkspace(store, owner, projectId);
  if (review.tree !== expected.tree || review.targetHead !== expected.targetHead)
    throw new WorkbenchError(409, "文件或目标提交已变化，请重新查看差异后再合并");
  if (!review.mergeable) throw new WorkbenchError(409, review.reason);
  // commit-tree records exactly the reviewed tree, without changing the source index/branch.
  const commit = gitCommand(parent.workdir, [
    "commit-tree",
    review.tree,
    "-p",
    review.targetHead,
    "-m",
    `Merge Silicon Code workspace ${projectId}`,
  ]);
  const resultBranch = `codex/workbench-result-${randomUUID()}`;
  gitCommand(parent.workdir, ["update-ref", `refs/heads/${resultBranch}`, commit, ""]);
  const hooks = mkdtempSync(join(tmpdir(), "silicon-worktree-hooks-"));
  try {
    gitCommand(parent.workdir, [
      "-c",
      `core.hooksPath=${hooks}`,
      "merge",
      "--ff-only",
      "--no-autostash",
      "--no-overwrite-ignore",
      commit,
    ]);
  } catch (err) {
    throw new WorkbenchError(
      409,
      `Git 未完成合并，已保留结果分支 ${resultBranch}，请检查原目录：${(err as Error).message}`,
    );
  } finally {
    rmSync(hooks, { recursive: true, force: true });
  }
  store.setWorkspace(owner, projectId, { ...workspace, mergedCommit: commit });
  return { commit, resultBranch, targetPath: parent.workdir };
}
