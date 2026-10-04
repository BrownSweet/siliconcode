import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import {
  captureWorkspace,
  workspaceDiff,
  workspaceFingerprint,
} from "../src/workbench/verification.js";

const roots: string[] = [];
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "silicon-snapshot-"));
  roots.push(root);
  const repo = join(root, "project");
  mkdirSync(repo);
  return { root, repo };
}
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

it("compares against dirty task-start content, including new, deleted, binary and executable files", async () => {
  const { repo } = fixture();
  writeFileSync(join(repo, "dirty.txt"), "user edit\n");
  writeFileSync(join(repo, "deleted.txt"), "old\n");
  writeFileSync(join(repo, "binary.bin"), Buffer.from([0, 1]));
  writeFileSync(join(repo, "script.sh"), "exit 0\n");
  const before = await captureWorkspace(repo);
  writeFileSync(join(repo, "dirty.txt"), "user edit\nagent edit\n");
  writeFileSync(join(repo, "added.txt"), "new content\n");
  rmSync(join(repo, "deleted.txt"));
  writeFileSync(join(repo, "binary.bin"), Buffer.from([0, 2]));
  chmodSync(join(repo, "script.sh"), 0o755);
  const after = await captureWorkspace(repo);
  const changes = workspaceDiff(before, after);
  expect(changes.status).toContain('A "added.txt"');
  expect(changes.status).toContain('D "deleted.txt"');
  expect(changes.diff).toContain("+agent edit");
  expect(changes.diff).toContain(" user edit");
  expect(changes.diff).toContain("+new content");
  expect(changes.diff).toContain("-old");
  expect(changes.diff).toContain("mode ");
  expect(changes.diff).toContain("二进制或大文件已变化");
  expect(after.fingerprint).not.toBe(before.fingerprint);
  expect(await workspaceFingerprint(repo)).toBe(after.fingerprint);
});

it("honors nested ignore overrides without following symlinks in ordinary projects", async () => {
  const { root, repo } = fixture();
  writeFileSync(join(repo, ".gitignore"), "*.log\ndist/\n");
  mkdirSync(join(repo, "nested"));
  writeFileSync(join(repo, "nested/.gitignore"), "!keep.log\n");
  writeFileSync(join(repo, "nested/keep.log"), "source\n");
  writeFileSync(join(repo, "nested/skip.log"), "ignored\n");
  mkdirSync(join(repo, "dist"));
  writeFileSync(join(repo, "dist/bundle.js"), "generated");
  mkdirSync(join(repo, "node_modules"));
  writeFileSync(join(repo, "node_modules/dep.js"), "dependency");
  writeFileSync(join(root, "outside.txt"), "secret outside contents");
  symlinkSync(join(root, "outside.txt"), join(repo, "link"));
  const before = await captureWorkspace(repo);
  expect(before.files["nested/keep.log"]?.text).toBe("source\n");
  expect(before.files["nested/skip.log"]).toBeUndefined();
  expect(before.files["dist/bundle.js"]).toBeUndefined();
  expect(before.files["node_modules/dep.js"]).toBeUndefined();
  expect(before.files.link?.kind).toBe("symlink");
  expect(JSON.stringify(before)).not.toContain("secret outside contents");
  writeFileSync(join(root, "outside.txt"), "changed outside");
  writeFileSync(join(repo, "dist/bundle.js"), "changed build");
  expect(await workspaceFingerprint(repo)).toBe(before.fingerprint);
  writeFileSync(join(repo, "nested/keep.log"), "changed source");
  expect(await workspaceFingerprint(repo)).not.toBe(before.fingerprint);
});

it("scopes a Git subdirectory to the selected project and includes ignored tracked files", async () => {
  const { repo } = fixture();
  const git = (args: string[]) => execFileSync("git", args, { cwd: repo, stdio: "pipe" });
  git(["init", "-b", "main"]);
  mkdirSync(join(repo, "selected"));
  writeFileSync(join(repo, "selected/.gitignore"), "*.txt\n");
  writeFileSync(join(repo, "selected/tracked.txt"), "tracked\n");
  writeFileSync(join(repo, "sibling.txt"), "unrelated\n");
  git(["add", "-f", "selected/tracked.txt"]);
  const selected = join(repo, "selected");
  const before = await captureWorkspace(selected);
  expect(before.head).toBe("unborn");
  expect(before.files["tracked.txt"]?.text).toBe("tracked\n");
  expect(before.files["sibling.txt"]).toBeUndefined();
  writeFileSync(join(repo, "sibling.txt"), "sibling changed\n");
  expect(await workspaceFingerprint(selected)).toBe(before.fingerprint);
  writeFileSync(join(selected, "tracked.txt"), "tracked changed\n");
  expect(await workspaceFingerprint(selected)).not.toBe(before.fingerprint);
});

it("refuses an intermediate tracked directory replaced by an outside symlink", async () => {
  const { root, repo } = fixture();
  const git = (args: string[]) => execFileSync("git", args, { cwd: repo, stdio: "pipe" });
  git(["init", "-b", "main"]);
  mkdirSync(join(repo, "source"));
  writeFileSync(join(repo, "source/a.txt"), "source");
  git(["add", "."]);
  mkdirSync(join(root, "outside"));
  writeFileSync(join(root, "outside/a.txt"), "outside");
  rmSync(join(repo, "source"), { recursive: true });
  symlinkSync(join(root, "outside"), join(repo, "source"));
  await expect(captureWorkspace(repo)).rejects.toThrow("符号链接");
});
