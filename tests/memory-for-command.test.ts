import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { handleSlash } from "../src/cli/ui/slash/dispatch.js";

describe("/memory for", () => {
  let root: string;
  let home: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "carbon-memory-for-root-"));
    home = mkdtempSync(join(tmpdir(), "carbon-memory-for-home-"));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  });

  function run(args: string[]): string {
    return (
      handleSlash("memory", args, {} as never, {
        codeRoot: root,
        memoryRoot: root,
        homeDir: home,
      }).info ?? ""
    );
  }

  it("shows the root rule and closest module rules for a target file", () => {
    mkdirSync(join(root, "packages", "cli", "src"), { recursive: true });
    writeFileSync(join(root, "AGENTS.md"), "root rule\n", "utf8");
    writeFileSync(join(root, "packages", "AGENTS.md"), "package rule\n", "utf8");
    writeFileSync(join(root, "packages", "cli", "SILICON.md"), "cli rule\n", "utf8");
    writeFileSync(join(root, "packages", "cli", "src", "index.ts"), "export {}\n", "utf8");

    const out = run(["for", "packages/cli/src/index.ts"]);

    expect(out).toContain("rules for packages/cli/src/index.ts");
    expect(out).toContain("- root: AGENTS.md");
    expect(out).toContain("root rule");
    expect(out).toContain("- module: packages/cli/SILICON.md");
    expect(out).toContain("cli rule");
    expect(out).toContain("- module: packages/AGENTS.md");
    expect(out).toContain("package rule");
  });

  it("uses a directory target directly when explaining module rules", () => {
    mkdirSync(join(root, "apps", "web"), { recursive: true });
    writeFileSync(join(root, "apps", "web", "AGENTS.md"), "web rule\n", "utf8");

    const out = run(["for", "apps/web"]);

    expect(out).toContain("rules for apps/web");
    expect(out).toContain("- module: apps/web/AGENTS.md");
    expect(out).toContain("web rule");
  });

  it("rejects paths outside the current workspace", () => {
    const out = run(["for", ".."]);

    expect(out).toContain("outside the current workspace");
  });

  it("prints a quiet empty-state when no rules apply", () => {
    writeFileSync(join(root, "main.ts"), "export {}\n", "utf8");

    const out = run(["for", "main.ts"]);

    expect(out).toContain("rules for main.ts");
    expect(out).toContain("No project rule files apply");
  });
});
