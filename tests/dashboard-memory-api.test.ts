import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { handleHealth } from "../src/server/api/health.js";
import { handleMemory } from "../src/server/api/memory.js";
import type { DashboardContext } from "../src/server/context.js";

function ctx(configPath: string, rootDir?: string): DashboardContext {
  return {
    mode: "attached",
    configPath,
    usageLogPath: join(configPath, "..", "usage.jsonl"),
    getCurrentCwd: rootDir ? () => rootDir : undefined,
  };
}

describe("dashboard memory and health paths", () => {
  let originalHome: string | undefined;
  let home: string;
  let project: string;
  let configPath: string;

  beforeEach(() => {
    originalHome = process.env.HOME;
    home = mkdtempSync(join(tmpdir(), "siliconcode-dashboard-home-"));
    project = mkdtempSync(join(tmpdir(), "siliconcode-dashboard-project-"));
    configPath = join(home, ".siliconcode", "config.json");
    process.env.HOME = home;
  });

  afterEach(() => {
    if (originalHome === undefined) Reflect.deleteProperty(process.env, "HOME");
    else process.env.HOME = originalHome;
    rmSync(home, { recursive: true, force: true });
    rmSync(project, { recursive: true, force: true });
  });

  it("exposes Silicon Code memory directories from the dashboard API", async () => {
    const res = await handleMemory("GET", [], "", ctx(configPath, project));

    expect(res.status).toBe(200);
    expect((res.body as { global: { path: string } }).global.path).toBe(
      join(home, ".siliconcode", "memory", "global"),
    );
    expect((res.body as { projectMem: { path: string } }).projectMem.path).toMatch(
      /[/\\]\.siliconcode[/\\]memory[/\\][a-f0-9]{16}$/,
    );
  });

  it("writes dashboard global memory under ~/.siliconcode", async () => {
    const res = await handleMemory(
      "POST",
      ["global", "shell_pref"],
      JSON.stringify({ body: "Use pnpm." }),
      ctx(configPath, project),
    );

    expect(res.status).toBe(200);
    const path = (res.body as { path: string }).path;
    expect(path).toBe(join(home, ".siliconcode", "memory", "global", "shell_pref.md"));
    expect(existsSync(path)).toBe(true);
    expect(readFileSync(path, "utf8")).toBe("Use pnpm.");
  });

  it("reports Silicon Code home paths from health", async () => {
    const res = await handleHealth("GET", [], "", ctx(configPath, project));

    expect(res.status).toBe(200);
    expect((res.body as { siliconcodeHome: string }).siliconcodeHome).toBe(
      join(home, ".siliconcode"),
    );
    expect((res.body as { reasonixHome?: string }).reasonixHome).toBeUndefined();
    expect((res.body as { sessions: { path: string } }).sessions.path).toBe(
      join(home, ".siliconcode", "sessions"),
    );
    expect((res.body as { memory: { path: string } }).memory.path).toBe(
      join(home, ".siliconcode", "memory"),
    );
    expect((res.body as { semantic: { path: string } }).semantic.path).toBe(
      join(home, ".siliconcode", "semantic"),
    );
  });
});
