import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, readFile, readdir, readlink } from "node:fs/promises";
import { isAbsolute, join, relative, sep } from "node:path";
import { promisify } from "node:util";
import ignore, { type Ignore } from "ignore";
import { lineDiff } from "../tools/fs/edit.js";

const exec = promisify(execFile);
const MAX_FILES = 50_000;
const MAX_TEXT_BYTES = 128 * 1024;
const MAX_SNAPSHOT_TEXT = 4 * 1024 * 1024;
// Without Git metadata these directories are outside the source evidence set.
const DEFAULT_IGNORED_DIRS = new Set([
  ".git",
  "node_modules",
  ".venv",
  "venv",
  "__pycache__",
  ".cache",
]);
interface SnapshotFile {
  digest: string;
  mode: number;
  kind: "file" | "symlink";
  text?: string;
}
export interface WorkspaceSnapshot {
  fingerprint: string;
  head: string | null;
  files: Record<string, SnapshotFile>;
}
async function git(cwd: string, args: string[]): Promise<string> {
  const result = await exec("git", ["--no-optional-locks", ...args], {
    cwd,
    env: { ...process.env, LC_ALL: "C" },
    timeout: 15_000,
    maxBuffer: 10 * 1024 * 1024,
    encoding: "utf8",
  });
  return result.stdout;
}

async function gitHead(cwd: string): Promise<string | null> {
  try {
    if ((await git(cwd, ["rev-parse", "--is-inside-work-tree"])).trim() !== "true") return null;
  } catch (err) {
    const e = err as NodeJS.ErrnoException & { stderr?: string };
    if (e.code === "ENOENT" || e.stderr?.includes("not a git repository")) return null;
    throw err;
  }
  try {
    return (await git(cwd, ["rev-parse", "--verify", "--quiet", "HEAD"])).trim();
  } catch (err) {
    if ((err as { code?: number }).code === 1) return "unborn";
    throw err;
  }
}

async function directoryFiles(cwd: string): Promise<string[]> {
  const names: string[] = [];
  let entriesSeen = 0;
  const walk = async (dir: string, parents: Array<{ dir: string; rules: Ignore }>) => {
    const layers = [...parents];
    try {
      // Do not follow a .gitignore symlink outside the selected project.
      if ((await lstat(join(dir, ".gitignore"))).isFile())
        layers.push({ dir, rules: ignore().add(await readFile(join(dir, ".gitignore"), "utf8")) });
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    }
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (++entriesSeen > MAX_FILES)
        throw new Error("项目条目超过 50000，请缩小工作目录或配置 .gitignore");
      if (entry.name === ".git" || (entry.isDirectory() && DEFAULT_IGNORED_DIRS.has(entry.name)))
        continue;
      const path = join(dir, entry.name);
      let excluded = false;
      for (const layer of layers) {
        const name =
          relative(layer.dir, path).split(sep).join("/") + (entry.isDirectory() ? "/" : "");
        const match = layer.rules.test(name);
        if (match.ignored) excluded = true;
        else if (match.unignored) excluded = false;
      }
      if (excluded) continue;
      if (entry.isDirectory()) await walk(path, layers);
      else names.push(relative(cwd, path).split(sep).join("/"));
    }
  };
  await walk(cwd, []);
  return names;
}

/** Never traverse an intermediate symlink, including a tracked directory replaced after checkout. */
async function assertParents(cwd: string, name: string): Promise<void> {
  const rel = relative(cwd, join(cwd, name));
  if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel))
    throw new Error(`项目路径越界: ${name}`);
  const parts = rel.split(sep);
  let parent = cwd;
  for (const part of parts.slice(0, -1)) {
    parent = join(parent, part);
    if (!(await lstat(parent)).isDirectory())
      throw new Error(`验证路径包含非目录或符号链接: ${name}`);
  }
}

/** A portable source snapshot; binary files are hashed and symlink targets are never read. */
export async function captureWorkspace(
  cwd: string,
  includeText = true,
): Promise<WorkspaceSnapshot> {
  const head = await gitHead(cwd);
  const names =
    head === null
      ? await directoryFiles(cwd)
      : (await git(cwd, ["ls-files", "-c", "-o", "--exclude-standard", "-z", "--", "."]))
          .split("\0")
          .filter(Boolean);
  if (names.length > MAX_FILES)
    throw new Error("项目文件超过 50000，请缩小工作目录或配置 .gitignore");
  const files: Record<string, SnapshotFile> = Object.create(null);
  let textBytes = 0;
  for (const name of [...new Set(names)].sort()) {
    try {
      await assertParents(cwd, name);
      const path = join(cwd, name);
      const info = await lstat(path);
      if (info.isSymbolicLink()) {
        const target = await readlink(path);
        files[name] = {
          mode: info.mode,
          kind: "symlink",
          digest: createHash("sha256").update(target).digest("hex"),
          text: target,
        };
      } else if (info.isFile()) {
        const hash = createHash("sha256");
        const chunks: Buffer[] = [];
        let bytes = 0;
        let retain =
          includeText && info.size <= MAX_TEXT_BYTES && textBytes + info.size <= MAX_SNAPSHOT_TEXT;
        for await (const chunk of createReadStream(path)) {
          const buffer = Buffer.from(chunk);
          hash.update(buffer);
          bytes += buffer.length;
          if (bytes > MAX_TEXT_BYTES || textBytes + bytes > MAX_SNAPSHOT_TEXT) {
            retain = false;
            chunks.length = 0;
          }
          if (retain) chunks.push(buffer);
        }
        const content = retain ? Buffer.concat(chunks) : undefined;
        // Invalid UTF-8 and NUL-containing files remain binary evidence.
        const text =
          content && !content.includes(0) && Buffer.from(content.toString("utf8")).equals(content)
            ? content.toString("utf8")
            : undefined;
        if (text !== undefined) textBytes += bytes;
        files[name] = { mode: info.mode, kind: "file", digest: hash.digest("hex"), text };
      } else throw new Error(`自动验证暂不支持子模块或非文件条目: ${name}`);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
      // Missing tracked files are represented by absence, matching ordinary directories.
    }
  }
  const hash = createHash("sha256").update(head ?? "directory");
  for (const [name, file] of Object.entries(files))
    hash.update(JSON.stringify([name, file.mode, file.kind, file.digest]));
  return { head, files, fingerprint: hash.digest("hex") };
}

export async function workspaceFingerprint(cwd: string): Promise<string> {
  return (await captureWorkspace(cwd, false)).fingerprint;
}

/** Changes relative to task start include new files, rather than only Git's tracked diff. */
export function workspaceDiff(
  before: WorkspaceSnapshot,
  after: WorkspaceSnapshot,
): { diff: string; status: string } {
  const statuses: string[] = [];
  const patches: string[] = [];
  let length = 0;
  for (const name of [
    ...new Set([...Object.keys(before.files), ...Object.keys(after.files)]),
  ].sort()) {
    const a = before.files[name];
    const b = after.files[name];
    if (a?.digest === b?.digest && a?.mode === b?.mode && a?.kind === b?.kind) continue;
    statuses.push(`${!a ? "A" : !b ? "D" : "M"} ${JSON.stringify(name)}`);
    if (length > MAX_SNAPSHOT_TEXT) continue;
    let patch = `--- ${a ? `a/${name}` : "/dev/null"}\n+++ ${b ? `b/${name}` : "/dev/null"}\n`;
    if (a && b && a.mode !== b.mode)
      patch += `mode ${a.mode.toString(8)} → ${b.mode.toString(8)}\n`;
    const oldLines = a ? a.text?.split("\n") : [];
    const newLines = b ? b.text?.split("\n") : [];
    if (!oldLines || !newLines || oldLines.length > 1000 || newLines.length > 1000) {
      patch += "二进制或大文件已变化，正文省略；请读取文件核对。\n";
    } else {
      patch += `@@ -${a ? 1 : 0},${oldLines.length} +${b ? 1 : 0},${newLines.length} @@\n`;
      patch += lineDiff(oldLines, newLines)
        .map(({ op, line }) => `${op}${line}`)
        .join("\n");
    }
    patches.push(patch);
    length += patch.length;
  }
  if (length > MAX_SNAPSHOT_TEXT)
    patches.push("差异正文达到显示上限；完整变更路径见列表，请读取文件核对。");
  return { diff: patches.join("\n\n"), status: statuses.join("\n") };
}
