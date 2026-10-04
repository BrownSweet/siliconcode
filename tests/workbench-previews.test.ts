import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { WorkbenchPreviews, previewUrl } from "../src/workbench/previews.js";
import { WorkbenchStore } from "../src/workbench/store.js";

const roots: string[] = [];
const registries: WorkbenchPreviews[] = [];
function fixture() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "silicon-preview-test-")));
  roots.push(root);
  const dir = join(root, "project");
  mkdirSync(dir);
  const store = new WorkbenchStore(join(root, "data"));
  const project = store.addProject("owner", dir);
  const previews = new WorkbenchPreviews(store);
  registries.push(previews);
  writeFileSync(
    join(dir, "preview.mjs"),
    'console.log("ready " + process.cwd()); setInterval(() => {}, 1000);',
  );
  const command = `"${process.execPath}" preview.mjs`;
  return { dir, project, previews, command };
}
afterEach(async () => {
  for (const registry of registries.splice(0)) await registry.close();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("project preview lifecycle", () => {
  it.skipIf(process.platform === "win32")(
    "cleans up a child that ignores SIGTERM when its wrapper exits",
    async () => {
      const f = fixture();
      writeFileSync(
        join(f.dir, "child.mjs"),
        'import {writeFileSync} from "node:fs"; process.on("SIGTERM",()=>{}); setInterval(()=>writeFileSync("pulse", String(Date.now())),10); console.log("ready child");',
      );
      writeFileSync(
        join(f.dir, "wrapper.mjs"),
        'import {spawn} from "node:child_process"; spawn(process.execPath,["child.mjs"],{stdio:"inherit"}); process.on("SIGTERM",()=>process.exit(0));',
      );
      await f.previews.start(
        "owner",
        f.project.id,
        `"${process.execPath}" wrapper.mjs`,
        "http://localhost",
      );
      await new Promise((r) => setTimeout(r, 60));
      await f.previews.stop("owner", f.project.id);
      await new Promise((r) => setTimeout(r, 60));
      const pulse = readFileSync(join(f.dir, "pulse"), "utf8");
      await new Promise((r) => setTimeout(r, 100));
      expect(readFileSync(join(f.dir, "pulse"), "utf8")).toBe(pulse);
    },
  );
  it("starts a real process in the project, enforces ownership, stops it and cleans up on service close", async () => {
    const f = fixture();
    const started = await f.previews.start(
      "owner",
      f.project.id,
      f.command,
      "http://127.0.0.1:5173",
    );
    expect(started?.status).toBe("running");
    expect(started?.output).toContain(f.dir);
    expect(() => f.previews.get("stranger", f.project.id)).toThrow("不存在");
    await expect(
      f.previews.start("owner", f.project.id, f.command, "http://localhost:5173"),
    ).rejects.toThrow("先停止");
    await f.previews.stop("owner", f.project.id);
    expect(f.previews.get("owner", f.project.id)?.status).toBe("exited");
    expect(() => process.kill(started!.pid!, 0)).toThrow();
    const second = await f.previews.start(
      "owner",
      f.project.id,
      f.command,
      "http://localhost:5173",
    );
    await f.previews.close();
    expect(f.previews.isBusy(f.project.id)).toBe(false);
    expect(() => process.kill(second!.pid!, 0)).toThrow();
  });

  it("rejects external URLs and shell composition and retains early exit logs", async () => {
    const f = fixture();
    for (const url of [
      "https://example.com",
      "javascript:alert(1)",
      "http://user:secret@localhost",
      "http://localhost.evil.test",
    ])
      expect(() => previewUrl(url)).toThrow();
    await expect(
      f.previews.start("owner", f.project.id, `${f.command} && echo bad`, "http://localhost"),
    ).rejects.toThrow("shell operator");
    expect(f.previews.isBusy(f.project.id)).toBe(false);
    writeFileSync(join(f.dir, "exit.mjs"), 'console.error("fixture failure"); process.exit(9);');
    const result = await f.previews.start(
      "owner",
      f.project.id,
      `"${process.execPath}" exit.mjs`,
      "http://localhost",
    );
    expect(result?.status).toBe("exited");
    expect(result?.exitCode).toBe(9);
    expect(result?.output).toContain("fixture failure");
  });
});
