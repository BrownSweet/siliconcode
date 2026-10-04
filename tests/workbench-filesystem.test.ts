import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { ToolRegistry } from "../src/tools.js";
import { registerFilesystemTools } from "../src/tools/filesystem.js";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
it("confines browser file reads and writes to the canonical project, including new files beneath symlinks", async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "silicon-workbench-fs-")));
  roots.push(root);
  const project = join(root, "project");
  const outside = join(root, "outside");
  mkdirSync(project);
  mkdirSync(outside);
  writeFileSync(join(outside, "secret"), "private");
  symlinkSync(outside, join(project, "link"));
  const tools = new ToolRegistry();
  registerFilesystemTools(tools, { rootDir: project, restrictToRoot: true });
  expect(await tools.dispatch("read_file", { path: join(outside, "secret") })).toContain(
    "outside the selected project",
  );
  expect(await tools.dispatch("read_file", { path: "link/secret" })).toContain("symlink escapes");
  expect(await tools.dispatch("write_file", { path: "link/new.txt", content: "oops" })).toContain(
    "symlink escapes",
  );
  expect(
    await tools.dispatch("write_file", { path: "local/new.txt", content: "allowed" }),
  ).not.toContain('"error"');
  expect(await tools.dispatch("read_file", { path: "local/new.txt" })).toContain("allowed");
});
