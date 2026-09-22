/** Multi-root sandbox (/add-dir): a path is in-sandbox if it's under the primary OR any added root; everything else still gates. */

import { promises as fs } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { homedir } from "node:os";
import { join } from "node:path";
import { resolve as resolvePath } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { isUnsafeRoot } from "../src/code/setup.js";
import { PauseGate } from "../src/core/pause-gate.js";
import { ToolRegistry } from "../src/tools.js";
import { registerFilesystemTools } from "../src/tools/filesystem.js";

describe("filesystem multi-root sandbox (/add-dir)", () => {
  let primary: string;
  let added: string;
  let outside: string;
  let gate: PauseGate;
  let gateRequests: number;

  beforeEach(async () => {
    primary = await mkdtemp(join(tmpdir(), "cc-primary-"));
    added = await mkdtemp(join(tmpdir(), "cc-added-"));
    outside = await mkdtemp(join(tmpdir(), "cc-outside-"));
    await fs.writeFile(join(added, "lib.ts"), "added-root content");
    await fs.writeFile(join(outside, "secret.txt"), "secret content");
    await fs.writeFile(join(primary, "main.ts"), "primary content");
    gateRequests = 0;
    gate = new PauseGate();
    gate.on(() => {
      gateRequests += 1;
    });
  });

  afterEach(async () => {
    await rm(primary, { recursive: true, force: true });
    await rm(added, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  });

  it("reads a file under an added root with no gate prompt", async () => {
    const tools = new ToolRegistry();
    registerFilesystemTools(tools, { rootDir: primary, additionalRoots: [added] });
    const result = await tools.dispatch(
      "read_file",
      { path: join(added, "lib.ts") },
      { confirmationGate: gate },
    );
    expect(result).toContain("added-root content");
    expect(gateRequests).toBe(0);
  });

  it("writes under an added root without gating", async () => {
    const tools = new ToolRegistry();
    registerFilesystemTools(tools, { rootDir: primary, additionalRoots: [added] });
    await tools.dispatch(
      "write_file",
      { path: join(added, "new.ts"), content: "written" },
      { confirmationGate: gate },
    );
    expect(await fs.readFile(join(added, "new.ts"), "utf8")).toBe("written");
    expect(gateRequests).toBe(0);
  });

  it("still gates a path that is outside BOTH the primary and the added root", async () => {
    const tools = new ToolRegistry();
    registerFilesystemTools(tools, { rootDir: primary, additionalRoots: [added] });
    const call = tools.dispatch(
      "read_file",
      { path: join(outside, "secret.txt") },
      { confirmationGate: gate },
    );
    await new Promise((r) => setTimeout(r, 5));
    expect(gateRequests).toBe(1);
    gate.resolve(gate.current!.id, { type: "deny" });
    expect(await call).toMatch(/user denied/);
  });

  it("without additionalRoots, the added dir is NOT in-sandbox (single-root parity)", async () => {
    const tools = new ToolRegistry();
    registerFilesystemTools(tools, { rootDir: primary });
    const call = tools.dispatch(
      "read_file",
      { path: join(added, "lib.ts") },
      { confirmationGate: gate },
    );
    await new Promise((r) => setTimeout(r, 5));
    expect(gateRequests).toBe(1); // gated, because added isn't a root here
    gate.resolve(gate.current!.id, { type: "deny" });
    expect(await call).toMatch(/user denied/);
  });

  it("the primary root still works normally alongside added roots", async () => {
    const tools = new ToolRegistry();
    registerFilesystemTools(tools, { rootDir: primary, additionalRoots: [added] });
    expect(
      await tools.dispatch("read_file", { path: "main.ts" }, { confirmationGate: gate }),
    ).toContain("primary content");
    expect(gateRequests).toBe(0);
  });
});

describe("isUnsafeRoot — /add-dir refuses system / secret directories", () => {
  const home = resolvePath(homedir());

  it("rejects filesystem root, home, secret dirs, and system trees", () => {
    expect(isUnsafeRoot(resolvePath("/"))).toBe(true);
    expect(isUnsafeRoot(home)).toBe(true);
    expect(isUnsafeRoot(resolvePath(home, ".ssh"))).toBe(true);
    expect(isUnsafeRoot(resolvePath(home, ".ssh", "keys"))).toBe(true);
    expect(isUnsafeRoot(resolvePath("/etc"))).toBe(true);
    expect(isUnsafeRoot(resolvePath("/usr"))).toBe(true);
  });

  it("allows ordinary project directories", () => {
    expect(isUnsafeRoot(resolvePath(home, "code", "my-project"))).toBe(false);
    expect(isUnsafeRoot(resolvePath(home, "work", "repo"))).toBe(false);
  });
});
