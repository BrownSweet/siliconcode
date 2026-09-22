import { promises as fs } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ToolRegistry } from "../src/tools.js";
import { registerFilesystemTools } from "../src/tools/filesystem.js";

describe("apply_patch filesystem tool", () => {
  let root: string;
  let tools: ToolRegistry;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "carbon-patch-"));
    tools = new ToolRegistry();
    registerFilesystemTools(tools, { rootDir: root });
    await fs.mkdir(join(root, "src"), { recursive: true });
    await fs.writeFile(join(root, "src", "cart.js"), "export const total = 1;\n");
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("applies a git-style patch to an existing file", async () => {
    const out = await tools.dispatch(
      "apply_patch",
      JSON.stringify({
        patch: [
          "diff --git a/src/cart.js b/src/cart.js",
          "--- a/src/cart.js",
          "+++ b/src/cart.js",
          "@@ -1 +1 @@",
          "-export const total = 1;",
          "+export const total = 2;",
          "",
        ].join("\n"),
      }),
    );

    expect(out).toMatch(/apply_patch: applied 1 file/);
    expect(await fs.readFile(join(root, "src", "cart.js"), "utf8")).toBe(
      "export const total = 2;\n",
    );
  });

  it("creates new files from /dev/null patches", async () => {
    const out = await tools.dispatch(
      "apply_patch",
      JSON.stringify({
        patch: [
          "diff --git a/src/shipping.js b/src/shipping.js",
          "--- /dev/null",
          "+++ b/src/shipping.js",
          "@@ -0,0 +1,2 @@",
          "+export function shippingCost() {",
          "+  return 5;",
          "+}",
          "",
        ].join("\n"),
      }),
    );

    expect(out).toMatch(/created src\/shipping\.js/);
    expect(await fs.readFile(join(root, "src", "shipping.js"), "utf8")).toBe(
      "export function shippingCost() {\n  return 5;\n}\n",
    );
  });

  it("does not write any file when a later hunk fails", async () => {
    const out = await tools.dispatch(
      "apply_patch",
      JSON.stringify({
        patch: [
          "diff --git a/src/cart.js b/src/cart.js",
          "--- a/src/cart.js",
          "+++ b/src/cart.js",
          "@@ -1 +1 @@",
          "-export const total = 1;",
          "+export const total = 2;",
          "diff --git a/src/missing.js b/src/missing.js",
          "--- a/src/missing.js",
          "+++ b/src/missing.js",
          "@@ -1 +1 @@",
          "-missing",
          "+present",
          "",
        ].join("\n"),
      }),
    );

    expect(out).toMatch(/no files written/);
    expect(await fs.readFile(join(root, "src", "cart.js"), "utf8")).toBe(
      "export const total = 1;\n",
    );
  });
});
