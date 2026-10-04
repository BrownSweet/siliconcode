import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { browseDirectories } from "../src/workbench/directories.js";
import { projectDirectoryAccess } from "../src/workbench/directory-policy.js";
import { WorkbenchStore } from "../src/workbench/store.js";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
function fixture() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "silicon-folders-")));
  roots.push(root);
  const store = new WorkbenchStore(join(root, "data"));
  return { root, store };
}
describe("project directory browsing", () => {
  it("lists only directories, resolves symlinks, and keeps account data hidden", async () => {
    const { root, store } = fixture();
    const project = join(root, "中文 project");
    mkdirSync(project);
    mkdirSync(join(root, ".hidden"));
    writeFileSync(join(root, "private.txt"), "not a directory");
    if (process.platform !== "win32") {
      symlinkSync(store.dataDir, join(root, "account-alias"));
      symlinkSync(project, join(root, "project-alias"));
    }
    const listing = await browseDirectories(store, root);
    expect(listing.directories.map((d) => d.name)).toContain("中文 project");
    expect(listing.directories.map((d) => d.name)).not.toContain("data");
    expect(listing.directories.map((d) => d.name)).not.toContain("account-alias");
    expect(listing.directories.map((d) => d.name)).not.toContain("private.txt");
    expect(listing.directories.map((d) => d.name)).not.toContain(".hidden");
    expect(listing.selectable).toBe(false); // ancestor of the account store
    const selected = await browseDirectories(store, project);
    expect(selected.selectable).toBe(true);
    expect(selected.parent).toBe(root);
    expect(store.listProjects("owner")).toEqual([]);
    expect(store.addProject("owner", selected.path).workdir).toBe(project);
  });
  it("rejects missing, relative, file, and protected directories", async () => {
    const { root, store } = fixture();
    const file = join(root, "file.txt");
    writeFileSync(file, "hello");
    await expect(browseDirectories(store, "relative")).rejects.toThrow("绝对");
    await expect(browseDirectories(store, join(root, "missing"))).rejects.toThrow("不存在");
    await expect(browseDirectories(store, file)).rejects.toThrow("不存在");
    await expect(browseDirectories(store, store.dataDir)).rejects.toThrow("不可浏览");
    expect((await browseDirectories(store, homedir())).selectable).toBe(false);
    for (const name of [".ssh", ".aws", ".gnupg", ".kube", ".config", ".codex", ".siliconcode"]) {
      expect(projectDirectoryAccess(join(homedir(), name, "project"), store.dataDir)).toMatchObject(
        { browse: false, selectable: false },
      );
    }
    expect(projectDirectoryAccess(join(store.dataDir, "child"), store.dataDir).selectable).toBe(
      false,
    );
    expect(projectDirectoryAccess(root, store.dataDir).selectable).toBe(false);
    if (process.platform !== "win32") {
      expect(projectDirectoryAccess(realpathSync("/var"), store.dataDir).selectable).toBe(false);
      expect(
        projectDirectoryAccess(join(realpathSync("/var"), "www", "project"), store.dataDir),
      ).toMatchObject({ browse: true, selectable: true });
    }
  });
});
