/** Silicon project-memory loader — filesystem-backed tests in a temp dir. */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CODE_SYSTEM_PROMPT, codeSystemPrompt } from "../src/code/prompt.js";
import {
  PROJECT_MEMORY_FILE,
  PROJECT_MEMORY_FILES,
  PROJECT_MEMORY_MAX_CHARS,
  applyProjectMemory,
  detectForeignAgentPlatform,
  findProjectMemoryPath,
  memoryEnabled,
  readProjectMemory,
  resolveProjectMemoryWritePath,
} from "../src/memory/project.js";

const BASE = "You are a test assistant.";

describe("project-memory", () => {
  let root: string;
  const originalSiliconEnv = process.env.SILICONCODE_MEMORY;
  const originalReasonixEnv = process.env.REASONIX_MEMORY;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "carbon-mem-"));
    // biome-ignore lint/performance/noDelete: avoid leaking "undefined" into env
    delete process.env.SILICONCODE_MEMORY;
    // biome-ignore lint/performance/noDelete: avoid leaking "undefined" into env
    delete process.env.REASONIX_MEMORY;
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
    if (originalSiliconEnv === undefined) {
      // biome-ignore lint/performance/noDelete: same reason
      delete process.env.SILICONCODE_MEMORY;
    } else {
      process.env.SILICONCODE_MEMORY = originalSiliconEnv;
    }
    if (originalReasonixEnv === undefined) {
      // biome-ignore lint/performance/noDelete: same reason
      delete process.env.REASONIX_MEMORY;
    } else {
      process.env.REASONIX_MEMORY = originalReasonixEnv;
    }
  });

  describe("readProjectMemory", () => {
    it("returns null when no project memory candidate is absent", () => {
      expect(readProjectMemory(root)).toBeNull();
    });

    it("returns null when SILICON.md is empty / whitespace-only", () => {
      writeFileSync(join(root, PROJECT_MEMORY_FILE), "   \n\n\t  \n", "utf8");
      expect(readProjectMemory(root)).toBeNull();
    });

    it("returns trimmed content + correct metadata for a normal file", () => {
      const body = "# Notes\nAlways prefer tabs over spaces in this repo.\n";
      writeFileSync(join(root, PROJECT_MEMORY_FILE), `\n\n${body}\n\n`, "utf8");
      const mem = readProjectMemory(root);
      expect(mem).not.toBeNull();
      expect(mem?.content).toBe(body.trim());
      expect(mem?.truncated).toBe(false);
      expect(mem?.originalChars).toBe(body.trim().length);
      expect(mem?.path.endsWith(PROJECT_MEMORY_FILE)).toBe(true);
    });

    it("truncates with a visible marker when over PROJECT_MEMORY_MAX_CHARS", () => {
      const huge = "x".repeat(PROJECT_MEMORY_MAX_CHARS + 1500);
      writeFileSync(join(root, PROJECT_MEMORY_FILE), huge, "utf8");
      const mem = readProjectMemory(root);
      expect(mem?.truncated).toBe(true);
      expect(mem?.originalChars).toBe(PROJECT_MEMORY_MAX_CHARS + 1500);
      expect(mem?.content).toMatch(/truncated 1500 chars/);
      // Content is bounded: first MAX chars + the marker line.
      expect(mem?.content.length).toBeLessThan(PROJECT_MEMORY_MAX_CHARS + 64);
    });

    it("reads AGENTS.md when present", () => {
      writeFileSync(join(root, "AGENTS.md"), "open-spec content\n", "utf8");
      const mem = readProjectMemory(root);
      expect(mem?.content).toBe("open-spec content");
      expect(mem?.path.endsWith("AGENTS.md")).toBe(true);
    });

    it("falls back to SILICON.md when AGENTS.md is absent", () => {
      writeFileSync(join(root, "SILICON.md"), "carbon content\n", "utf8");
      const mem = readProjectMemory(root);
      expect(mem?.content).toBe("carbon content");
      expect(mem?.path.endsWith("SILICON.md")).toBe(true);
    });

    it("skips non-file candidates and falls back to the next project memory file", () => {
      mkdirSync(join(root, "AGENTS.md"));
      writeFileSync(join(root, "SILICON.md"), "carbon file wins\n", "utf8");
      const mem = readProjectMemory(root);
      expect(mem?.content).toBe("carbon file wins");
      expect(mem?.path.endsWith("SILICON.md")).toBe(true);
    });

    it("falls back to legacy REASONIX.md when AGENTS.md and SILICON.md are absent", () => {
      writeFileSync(join(root, "REASONIX.md"), "legacy content\n", "utf8");
      const mem = readProjectMemory(root);
      expect(mem?.content).toBe("legacy content");
      expect(mem?.path.endsWith("REASONIX.md")).toBe(true);
    });

    it("falls back to AGENT.md (singular) when no higher-priority candidate exists", () => {
      writeFileSync(join(root, "AGENT.md"), "singular variant\n", "utf8");
      const mem = readProjectMemory(root);
      expect(mem?.content).toBe("singular variant");
      expect(mem?.path.endsWith("AGENT.md")).toBe(true);
    });

    it("prefers AGENTS.md when multiple candidates exist", () => {
      writeFileSync(join(root, "REASONIX.md"), "reasonix loses\n", "utf8");
      writeFileSync(join(root, "SILICON.md"), "carbon loses\n", "utf8");
      writeFileSync(join(root, "AGENTS.md"), "agents wins\n", "utf8");
      writeFileSync(join(root, "AGENT.md"), "agent loses too\n", "utf8");
      const mem = readProjectMemory(root);
      expect(mem?.content).toBe("agents wins");
      expect(mem?.path.endsWith("AGENTS.md")).toBe(true);
    });

    it("PROJECT_MEMORY_FILES priority matches the documented read order", () => {
      expect(PROJECT_MEMORY_FILES).toEqual(["AGENTS.md", "SILICON.md", "REASONIX.md", "AGENT.md"]);
    });
  });

  describe("findProjectMemoryPath", () => {
    it("returns null when no candidate exists", () => {
      expect(findProjectMemoryPath(root)).toBeNull();
    });

    it.each(PROJECT_MEMORY_FILES)("finds %s when it's the only candidate", (name) => {
      writeFileSync(join(root, name), "x", "utf8");
      expect(findProjectMemoryPath(root)?.endsWith(name)).toBe(true);
    });
  });

  describe("resolveProjectMemoryWritePath", () => {
    it("returns SILICON.md path when no candidate exists yet (fresh project)", () => {
      expect(resolveProjectMemoryWritePath(root).endsWith("SILICON.md")).toBe(true);
    });

    it("writes to the existing AGENTS.md when present (don't fragment)", () => {
      writeFileSync(join(root, "AGENTS.md"), "x", "utf8");
      expect(resolveProjectMemoryWritePath(root).endsWith("AGENTS.md")).toBe(true);
    });

    it("does not choose a non-file AGENTS.md as the write target", () => {
      mkdirSync(join(root, "AGENTS.md"));
      writeFileSync(join(root, "SILICON.md"), "x", "utf8");
      expect(resolveProjectMemoryWritePath(root).endsWith("SILICON.md")).toBe(true);
    });

    it("writes to the existing SILICON.md when present", () => {
      writeFileSync(join(root, "SILICON.md"), "x", "utf8");
      expect(resolveProjectMemoryWritePath(root).endsWith("SILICON.md")).toBe(true);
    });

    it("keeps writing to legacy REASONIX.md when it is the only existing candidate", () => {
      writeFileSync(join(root, "REASONIX.md"), "x", "utf8");
      expect(resolveProjectMemoryWritePath(root).endsWith("REASONIX.md")).toBe(true);
    });

    it("AGENTS.md wins as the write target when it coexists with legacy REASONIX.md", () => {
      writeFileSync(join(root, "REASONIX.md"), "x", "utf8");
      writeFileSync(join(root, "AGENTS.md"), "y", "utf8");
      expect(resolveProjectMemoryWritePath(root).endsWith("AGENTS.md")).toBe(true);
    });
  });

  describe("memoryEnabled", () => {
    it("defaults to true when env is unset", () => {
      expect(memoryEnabled()).toBe(true);
    });

    it.each(["off", "false", "0"])("returns false for SILICONCODE_MEMORY=%s", (val) => {
      process.env.SILICONCODE_MEMORY = val;
      expect(memoryEnabled()).toBe(false);
    });

    it("normalizes SILICONCODE_MEMORY before checking opt-out values", () => {
      process.env.SILICONCODE_MEMORY = " OFF ";
      expect(memoryEnabled()).toBe(false);
    });

    it.each(["off", "false", "0"])("keeps legacy REASONIX_MEMORY=%s as an opt-out", (val) => {
      process.env.REASONIX_MEMORY = val;
      expect(memoryEnabled()).toBe(false);
    });

    it("normalizes legacy REASONIX_MEMORY opt-out values", () => {
      process.env.REASONIX_MEMORY = " False ";
      expect(memoryEnabled()).toBe(false);
    });

    it("lets SILICONCODE_MEMORY override a legacy REASONIX_MEMORY setting", () => {
      process.env.SILICONCODE_MEMORY = "on";
      process.env.REASONIX_MEMORY = "off";
      expect(memoryEnabled()).toBe(true);
    });

    it("returns true for unrelated env values (on, 1, truthy, etc.)", () => {
      for (const val of ["on", "1", "true", "yes"]) {
        process.env.SILICONCODE_MEMORY = val;
        expect(memoryEnabled()).toBe(true);
      }
    });
  });

  describe("applyProjectMemory", () => {
    it("returns the base prompt unchanged when no memory file exists", () => {
      expect(applyProjectMemory(BASE, root)).toBe(BASE);
    });

    it("appends a '# Project memory' fenced block when the file exists", () => {
      writeFileSync(
        join(root, PROJECT_MEMORY_FILE),
        "# Notes\nTreat snake_case as the house style.\n",
        "utf8",
      );
      const out = applyProjectMemory(BASE, root);
      expect(out.length).toBeGreaterThan(BASE.length);
      expect(out).toMatch(/# Project memory \(SILICON\.md\)/);
      expect(out).toContain("snake_case");
      // Fenced block present.
      expect(out).toMatch(/```\n[\s\S]*```/);
    });

    it("header reflects AGENTS.md when that's the file we fell back to", () => {
      writeFileSync(join(root, "AGENTS.md"), "open-spec rules\n", "utf8");
      const out = applyProjectMemory(BASE, root);
      expect(out).toMatch(/# Project memory \(AGENTS\.md\)/);
      expect(out).not.toMatch(/# Project memory \(SILICON\.md\)/);
      expect(out).toContain("open-spec rules");
    });

    it("no-ops when SILICONCODE_MEMORY=off, even with a file present", () => {
      writeFileSync(join(root, PROJECT_MEMORY_FILE), "content\n", "utf8");
      process.env.SILICONCODE_MEMORY = "off";
      expect(applyProjectMemory(BASE, root)).toBe(BASE);
    });

    it("is deterministic for identical inputs (cache-prefix-safe)", () => {
      writeFileSync(join(root, PROJECT_MEMORY_FILE), "stable content\n", "utf8");
      const a = applyProjectMemory(BASE, root);
      const b = applyProjectMemory(BASE, root);
      expect(a).toBe(b);
    });
  });

  describe("detectForeignAgentPlatform", () => {
    it("returns null for a normal project root", () => {
      writeFileSync(join(root, "package.json"), "{}", "utf8");
      expect(detectForeignAgentPlatform(root)).toBeNull();
    });

    it("flags a SOUL.md sibling", () => {
      writeFileSync(join(root, "SOUL.md"), "# persona\n", "utf8");
      expect(detectForeignAgentPlatform(root)).toEqual(["SOUL.md"]);
    });

    it("flags a PERSONA.md sibling", () => {
      writeFileSync(join(root, "PERSONA.md"), "# persona\n", "utf8");
      expect(detectForeignAgentPlatform(root)).toEqual(["PERSONA.md"]);
    });

    it("does NOT flag AGENT.md (we read it as a memory candidate)", () => {
      writeFileSync(join(root, "AGENT.md"), "# agent\n", "utf8");
      expect(detectForeignAgentPlatform(root)).toBeNull();
    });

    it("does NOT flag AGENTS.md (open spec — we read it as a memory candidate)", () => {
      writeFileSync(join(root, "AGENTS.md"), "# agents\n", "utf8");
      expect(detectForeignAgentPlatform(root)).toBeNull();
    });

    it("flags a skills/ + memories/ pair (typical agent-platform data dir)", () => {
      mkdirSync(join(root, "skills"));
      mkdirSync(join(root, "memories"));
      expect(detectForeignAgentPlatform(root)).toEqual(["skills/ + memories/"]);
    });

    it("does NOT flag a lone skills/ directory (common in coding repos)", () => {
      mkdirSync(join(root, "skills"));
      expect(detectForeignAgentPlatform(root)).toBeNull();
    });

    it("returns every marker that hit, in order", () => {
      writeFileSync(join(root, "SOUL.md"), "x", "utf8");
      writeFileSync(join(root, "PERSONA.md"), "y", "utf8");
      mkdirSync(join(root, "skills"));
      mkdirSync(join(root, "memories"));
      expect(detectForeignAgentPlatform(root)).toEqual([
        "SOUL.md",
        "PERSONA.md",
        "skills/ + memories/",
      ]);
    });
  });

  describe("codeSystemPrompt integration", () => {
    it("stacks base → memory → .gitignore when both files exist", () => {
      writeFileSync(
        join(root, PROJECT_MEMORY_FILE),
        "## House rules\nAlways write tests alongside new tools.\n",
        "utf8",
      );
      writeFileSync(join(root, ".gitignore"), "node_modules/\ndist/\n", "utf8");
      const out = codeSystemPrompt(root);
      const memIdx = out.indexOf("# Project memory");
      const gitIdx = out.indexOf("# Project .gitignore");
      expect(memIdx).toBeGreaterThan(CODE_SYSTEM_PROMPT.length - 1);
      expect(gitIdx).toBeGreaterThan(memIdx);
      expect(out).toContain("Always write tests");
      expect(out).toContain("node_modules/");
    });

    it("memory alone (no .gitignore) still appends only the memory block", () => {
      writeFileSync(join(root, PROJECT_MEMORY_FILE), "memory-only content\n", "utf8");
      const out = codeSystemPrompt(root);
      expect(out).toContain("memory-only content");
      expect(out).not.toMatch(/# Project \.gitignore/);
    });
  });
});
