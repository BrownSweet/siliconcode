import { createHash, randomUUID } from "node:crypto";
import { type Stats, createReadStream } from "node:fs";
import { lstat, mkdir, open, readFile, readdir, rename, rm, rmdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { Readable, type Writable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createGunzip, createGzip } from "node:zlib";

const rootFiles = [
  "account.json",
  "projects.json",
  "requirements.json",
  "settings.json",
  "format.json",
];
const taskFile = /^[a-f0-9-]{36}(?:\.baseline)?\.json$|^[a-f0-9-]{36}\.jsonl$/;
const allowed = (path: string) =>
  rootFiles.includes(path) || (path.startsWith("tasks/") && taskFile.test(path.slice(6)));
const maxBytes = 1024 * 1024 * 1024;

/** Caller holds the workbench mutation gate and has verified there are no active tasks. */
export async function exportWorkbench(dataDir: string, output: Writable): Promise<void> {
  async function* records() {
    yield `${JSON.stringify({ kind: "header", format: "siliconcode-workbench", version: 1 })}\n`;
    const names = [...rootFiles];
    try {
      names.push(
        ...(await readdir(join(dataDir, "tasks")))
          .filter((f) => taskFile.test(f))
          .sort()
          .map((f) => `tasks/${f}`),
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    let files = 0;
    let total = 0;
    for (const name of names) {
      const path = join(dataDir, name);
      let info: Stats;
      try {
        info = await lstat(path);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
        throw error;
      }
      if (!info.isFile() || info.isSymbolicLink()) throw new Error("备份不支持符号链接或特殊文件");
      total += info.size;
      if (total > maxBytes) throw new Error("备份数据超过 1 GiB，请先整理记录");
      yield `${JSON.stringify({ kind: "file", path: name, size: info.size })}\n`;
      const hash = createHash("sha256");
      for await (const chunk of createReadStream(path, { highWaterMark: 64 * 1024 })) {
        const bytes = Buffer.from(chunk);
        hash.update(bytes);
        yield `${JSON.stringify({ kind: "chunk", data: bytes.toString("base64") })}\n`;
      }
      yield `${JSON.stringify({ kind: "end", sha256: hash.digest("hex") })}\n`;
      files++;
    }
    yield `${JSON.stringify({ kind: "complete", files })}\n`;
  }
  await pipeline(Readable.from(records()), createGzip(), output);
}

/** Restore only into an empty destination; validate everything before publishing it. */
export async function restoreWorkbench(archive: string, destination: string): Promise<void> {
  const target = resolve(destination);
  const empty = async () => {
    try {
      if ((await lstat(target)).isSymbolicLink() || (await readdir(target)).length)
        throw new Error("恢复目标必须为空目录，不会覆盖已有工作台数据");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  };
  await empty();
  await mkdir(dirname(target), { recursive: true });
  const stage = `${target}.restore-${randomUUID()}`;
  await mkdir(stage, { mode: 0o700 });
  const input = createReadStream(archive);
  const decoded = createGunzip();
  input.on("error", (error) => decoded.destroy(error));
  input.pipe(decoded);
  let file: Awaited<ReturnType<typeof open>> | undefined;
  let hash = createHash("sha256");
  let expected = 0;
  let written = 0;
  let total = 0;
  let header = false;
  let complete = false;
  const seen = new Set<string>();
  let ended = 0;
  let buffer = "";
  async function record(line: string) {
    const value = JSON.parse(line);
    if (complete) throw new Error("备份结束后包含额外数据");
    if (!header) {
      if (
        value.kind !== "header" ||
        value.format !== "siliconcode-workbench" ||
        value.version !== 1
      )
        throw new Error("不支持的备份格式或版本");
      header = true;
      return;
    }
    if (value.kind === "file") {
      if (
        file ||
        typeof value.path !== "string" ||
        !allowed(value.path) ||
        seen.has(value.path) ||
        !Number.isSafeInteger(value.size) ||
        value.size < 0
      )
        throw new Error("备份包含无效文件记录");
      total += value.size;
      if (total > maxBytes || seen.size >= 100_000) throw new Error("备份数据超过恢复上限");
      const path = join(stage, value.path);
      await mkdir(dirname(path), { recursive: true, mode: 0o700 });
      file = await open(path, "wx", 0o600);
      seen.add(value.path);
      expected = value.size;
      written = 0;
      hash = createHash("sha256");
    } else if (value.kind === "chunk") {
      if (!file || typeof value.data !== "string" || !/^[A-Za-z0-9+/]*={0,2}$/.test(value.data))
        throw new Error("备份数据块无效");
      const bytes = Buffer.from(value.data, "base64");
      written += bytes.length;
      if (written > expected) throw new Error("备份文件长度不匹配");
      hash.update(bytes);
      await file.writeFile(bytes);
    } else if (value.kind === "end") {
      if (!file || written !== expected || hash.digest("hex") !== value.sha256)
        throw new Error("备份文件校验失败");
      await file.close();
      file = undefined;
      ended++;
    } else if (value.kind === "complete") {
      if (file || value.files !== ended) throw new Error("备份未完整结束");
      complete = true;
    } else throw new Error("未知备份记录");
  }
  try {
    for await (const chunk of decoded) {
      buffer += chunk.toString("utf8");
      let boundary = buffer.indexOf("\n");
      while (boundary >= 0) {
        if (boundary > 100_000) throw new Error("备份记录过大");
        const line = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 1);
        await record(line);
        boundary = buffer.indexOf("\n");
      }
      if (buffer.length > 100_000) throw new Error("备份记录过大");
    }
    if (!complete || buffer.length) throw new Error("备份已截断，未写入目标目录");
    for (const required of ["account.json", "projects.json", "requirements.json"])
      if (!seen.has(required)) throw new Error(`备份缺少 ${required}`);
    for (const name of seen) {
      if (name.endsWith(".json")) JSON.parse(await readFile(join(stage, name), "utf8"));
    }
    const account = JSON.parse(await readFile(join(stage, "account.json"), "utf8"));
    if (
      !account ||
      typeof account.id !== "string" ||
      typeof account.username !== "string" ||
      !/^[a-f0-9]{64}$/.test(account.salt) ||
      !/^[a-f0-9]{128}$/.test(account.passwordHash)
    )
      throw new Error("备份中的账户记录无效");
    // Validate the record version and collection shape before replacing an empty folder.
    const format = seen.has("format.json")
      ? JSON.parse(await readFile(join(stage, "format.json"), "utf8"))
      : { schemaVersion: 1 };
    if (format.schemaVersion !== 1) throw new Error("备份的数据版本不受支持");
    for (const name of ["projects.json", "requirements.json"])
      if (!Array.isArray(JSON.parse(await readFile(join(stage, name), "utf8"))))
        throw new Error("备份记录格式无效");
    await empty();
    try {
      await rmdir(target);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    await rename(stage, target);
  } finally {
    input.destroy();
    decoded.destroy();
    await file?.close();
    await rm(stage, { recursive: true, force: true });
  }
}
