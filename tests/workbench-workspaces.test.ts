import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { WorkbenchStore } from "../src/workbench/store.js";
import {
  createWorkbenchWorkspace,
  mergeWorkbenchWorkspace,
  reviewWorkbenchWorkspace,
} from "../src/workbench/workspaces.js";

const roots: string[] = [];
function fixture() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "silicon-workspace-test-")));
  roots.push(root);
  const repo = join(root, "repo");
  mkdirSync(repo);
  const git = (args: string[], cwd = repo) =>
    execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  git(["init", "-b", "main"]);
  git(["config", "user.name", "Fixture"]);
  git(["config", "user.email", "fixture@example.invalid"]);
  writeFileSync(join(repo, "app.txt"), "original\n");
  writeFileSync(join(repo, ".gitignore"), "ignored\n");
  git(["add", "."]);
  git(["commit", "-m", "initial"]);
  const store = new WorkbenchStore(join(root, "data"));
  const project = store.addProject("owner", repo);
  return { root, repo, git, store, project };
}
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("browser Git workspaces", () => {
  it("isolates from committed HEAD, reviews all files without changing indexes, and merges exactly the reviewed tree", () => {
    const f = fixture();
    writeFileSync(join(f.repo, "app.txt"), "original local edit\n");
    const child = createWorkbenchWorkspace(f.store, "owner", f.project.id);
    expect(child.workspace?.branch).toMatch(/^codex\/workbench-/);
    expect(readFileSync(join(child.workdir, "app.txt"), "utf8")).toBe("original\n");
    expect(readFileSync(join(f.repo, "app.txt"), "utf8")).toBe("original local edit\n");
    writeFileSync(join(child.workdir, "app.txt"), "approved\n");
    writeFileSync(join(child.workdir, "new.txt"), "new file\n");
    writeFileSync(join(child.workdir, "ignored"), "do not merge\n");
    const dirty = reviewWorkbenchWorkspace(f.store, "owner", child.id);
    expect(dirty.mergeable).toBe(false);
    expect(dirty.diff).toContain("new file");
    expect(dirty.diff).not.toContain("do not merge");
    expect(() => mergeWorkbenchWorkspace(f.store, "owner", child.id, dirty)).toThrow("未提交");
    writeFileSync(join(f.repo, "app.txt"), "original\n");
    f.git(["add", "app.txt"], child.workdir);
    const stagedBefore = f.git(["diff", "--cached"], child.workdir);
    const review = reviewWorkbenchWorkspace(f.store, "owner", child.id);
    expect(review.mergeable).toBe(true);
    expect(f.git(["diff", "--cached"], child.workdir)).toBe(stagedBefore);
    const result = mergeWorkbenchWorkspace(f.store, "owner", child.id, review);
    expect(f.git(["rev-parse", "HEAD"])).toBe(result.commit);
    expect(f.git(["rev-parse", "HEAD^{tree}"])).toBe(review.tree);
    expect(readFileSync(join(f.repo, "new.txt"), "utf8")).toBe("new file\n");
    expect(f.git(["status", "--porcelain"])).toBe("");
    expect(f.git(["diff", "--cached"], child.workdir)).toBe(stagedBefore);
    expect(
      new WorkbenchStore(f.store.dataDir).project("owner", child.id).workspace?.mergedCommit,
    ).toBe(result.commit);
    expect(() => mergeWorkbenchWorkspace(f.store, "owner", child.id, review)).toThrow();
  });

  it("rejects stale reviews, advanced targets, wrong owners and changed branches without overwriting anything", () => {
    const f = fixture();
    const child = createWorkbenchWorkspace(f.store, "owner", f.project.id);
    writeFileSync(join(child.workdir, "app.txt"), "first\n");
    const review = reviewWorkbenchWorkspace(f.store, "owner", child.id);
    writeFileSync(join(child.workdir, "app.txt"), "second\n");
    expect(() => mergeWorkbenchWorkspace(f.store, "owner", child.id, review)).toThrow("已变化");
    expect(() => reviewWorkbenchWorkspace(f.store, "stranger", child.id)).toThrow("不存在");
    writeFileSync(join(f.repo, "new-original.txt"), "keep\n");
    f.git(["add", "."]);
    f.git(["commit", "-m", "user change"]);
    const advanced = reviewWorkbenchWorkspace(f.store, "owner", child.id);
    expect(advanced.mergeable).toBe(false);
    expect(advanced.reason).toContain("新提交");
    expect(() => mergeWorkbenchWorkspace(f.store, "owner", child.id, advanced)).toThrow("新提交");
    expect(readFileSync(join(f.repo, "app.txt"), "utf8")).toBe("original\n");
    f.git(["switch", "-c", "different"], child.workdir);
    expect(() => reviewWorkbenchWorkspace(f.store, "owner", child.id)).toThrow("分支");
  });

  it("keeps ordinary directories usable and rejects nested repositories from automatic merge", () => {
    const f = fixture();
    const plain = join(f.root, "plain");
    mkdirSync(plain);
    const project = f.store.addProject("owner", plain);
    expect(() => createWorkbenchWorkspace(f.store, "owner", project.id)).toThrow("Git");
    expect(f.store.project("owner", project.id).workdir).toBe(plain);
    const child = createWorkbenchWorkspace(f.store, "owner", f.project.id);
    const nested = join(child.workdir, "nested");
    mkdirSync(nested);
    f.git(["init", "-b", "main"], nested);
    writeFileSync(join(nested, "a"), "x");
    f.git(["add", "."], nested);
    f.git(
      [
        "-c",
        "user.name=Fixture",
        "-c",
        "user.email=fixture@example.invalid",
        "commit",
        "-m",
        "nested",
      ],
      nested,
    );
    expect(() => reviewWorkbenchWorkspace(f.store, "owner", child.id)).toThrow("子模块");
  });
});
