import { execFile } from "node:child_process";
import type { Dirent } from "node:fs";
import { readdir, realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join } from "node:path";
import { promisify } from "node:util";
import { createProjectDirectoryPolicy } from "./directory-policy.js";
import { WorkbenchError, type WorkbenchStore } from "./store.js";

const execute = promisify(execFile);

/** Authenticated, directory names only. This does not grant model access or create a project. */
export async function browseDirectories(store: WorkbenchStore, input?: string) {
  const home = await realpath(homedir());
  if (input && !isAbsolute(input)) throw new WorkbenchError(400, "请输入绝对目录路径");
  const policy = createProjectDirectoryPolicy(store.dataDir);
  const allowed = (path: string) => policy(path).browse;
  let path: string;
  try {
    path = await realpath(input || home);
    if (!(await stat(path)).isDirectory()) throw new Error("not a directory");
  } catch {
    throw new WorkbenchError(400, "目录不存在或不可读取，请选择其他文件夹");
  }
  if (!allowed(path)) throw new WorkbenchError(403, "此目录不可浏览，请选择项目文件夹");
  let selectable = true;
  let reason = "";
  try {
    store.validateProjectDirectory(path);
  } catch (err) {
    selectable = false;
    reason = (err as Error).message;
  }
  let entries: Dirent[];
  try {
    entries = await readdir(path, { withFileTypes: true });
  } catch {
    throw new WorkbenchError(403, "没有权限读取此目录，请选择其他文件夹");
  }
  const names = entries
    .filter(
      (entry) => !entry.name.startsWith(".") && (entry.isDirectory() || entry.isSymbolicLink()),
    )
    .sort((a, b) => a.name.localeCompare(b.name, "zh-CN", { numeric: true }));
  const directories = (
    await Promise.all(
      names.slice(0, 1000).map(async (entry) => {
        try {
          const target = await realpath(join(path, entry.name));
          if (!allowed(target) || !(await stat(target)).isDirectory()) return null;
          return { name: entry.name, path: target };
        } catch {
          return null;
        }
      }),
    )
  ).filter((entry) => entry !== null);
  const parent = dirname(path);
  return {
    path,
    name: basename(path) || path,
    parent: parent !== path && allowed(parent) ? parent : null,
    home,
    directories,
    selectable,
    reason,
    truncated: names.length > 1000,
  };
}

/** Static script, no shell interpolation. Only exposed by a loopback-only macOS server. */
export async function chooseNativeDirectory(signal: AbortSignal): Promise<string | null> {
  try {
    const { stdout } = await execute(
      "/usr/bin/osascript",
      [
        "-e",
        'tell application "Finder"\nactivate\nreturn POSIX path of (choose folder with prompt "选择 Silicon Code 项目文件夹")\nend tell',
      ],
      { timeout: 120_000, maxBuffer: 16_384, signal },
    );
    return stdout.replace(/\r?\n$/, "") || null;
  } catch (err) {
    const details = err as Error & { stderr?: string };
    if (details.stderr?.includes("(-128)")) return null;
    throw new WorkbenchError(400, "系统选择器未完成，请使用下方目录列表选择文件夹");
  }
}
