import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { afterEach, describe, expect, it } from "vitest";
import { DeepSeekClient } from "../src/client.js";
import { WorkbenchRuntime } from "../src/workbench/runtime.js";
import { WorkbenchStore, atomicJson } from "../src/workbench/store.js";

const roots: string[] = [];
const runtimes: WorkbenchRuntime[] = [];
function sse(content: string, tool?: { name: string; args: unknown }): Response {
  const delta = tool
    ? {
        tool_calls: [
          {
            index: 0,
            id: "call_1",
            type: "function",
            function: { name: tool.name, arguments: JSON.stringify(tool.args) },
          },
        ],
      }
    : { content };
  return new Response(
    `data: ${JSON.stringify({ choices: [{ delta, finish_reason: tool ? "tool_calls" : "stop" }] })}\n\ndata: [DONE]\n\n`,
  );
}
function fixture(provider: typeof fetch, gitMode: "commit" | "unborn" | "none" = "commit") {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "silicon-workbench-runtime-")));
  roots.push(root);
  const dir = join(root, "repo");
  mkdirSync(dir);
  const git = (args: string[]) => execFileSync("git", args, { cwd: dir, stdio: "pipe" });
  if (gitMode !== "none") {
    git(["init", "-b", "main"]);
    git(["config", "user.name", "Test"]);
    git(["config", "user.email", "test@example.com"]);
  }
  writeFileSync(join(dir, "app.mjs"), "export const value = 1;\n");
  writeFileSync(
    join(dir, "check.mjs"),
    'import { value } from "./app.mjs"; if(value !== 2) process.exit(1); console.log("real test passed");',
  );
  if (gitMode === "commit") {
    git(["add", "."]);
    git(["commit", "-m", "fixture"]);
  }
  const store = new WorkbenchStore(join(root, "data"));
  const project = store.addProject("owner", dir);
  const version = store.createVersion("owner", project.id, {
    label: "1.0",
    requirement: "change value to 2",
  });
  const configPath = join(root, "config.json");
  writeFileSync(configPath, "{}");
  const runtime = new WorkbenchRuntime(store, {
    configPath,
    maxRepairAttempts: 2,
    client: () =>
      new DeepSeekClient({
        apiKey: "test",
        fetch: provider,
        retry: { maxAttempts: 1 },
        timeoutMs: 1000,
      }),
  });
  runtimes.push(runtime);
  return { root, dir, store, project, version, runtime, configPath };
}
const draft = {
  prd: "# PRD",
  sdd: "# SDD",
  acceptance: ["value is 2"],
  questions: [],
  checks: [
    { kind: "test", command: `"${process.execPath}" check.mjs`, timeoutSec: 10 },
    { kind: "build", command: `"${process.execPath}" --check app.mjs`, timeoutSec: 10 },
  ],
};
function confirm(f: ReturnType<typeof fixture>) {
  f.store.recordDraft("owner", f.project.id, f.version.id, 0, draft);
  f.store.confirm("owner", f.project.id, f.version.id, 1);
}
afterEach(async () => {
  for (const runtime of runtimes.splice(0)) await runtime.close();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("browser agent workflow through the real loop and tools", () => {
  it("stops at the task's frozen token limit before dispatching the next file tool", async () => {
    let calls = 0;
    const f = fixture(async () => {
      calls++;
      return new Response(
        `data: ${JSON.stringify({
          usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 },
          choices: [
            {
              delta: {
                tool_calls: [
                  {
                    index: 0,
                    id: "budget_call",
                    type: "function",
                    function: {
                      name: "write_file",
                      arguments: JSON.stringify({
                        path: "app.mjs",
                        content: "export const value = 2;\n",
                      }),
                    },
                  },
                ],
              },
              finish_reason: "tool_calls",
            },
          ],
        })}\n\ndata: [DONE]\n\n`,
      );
    });
    confirm(f);
    f.store.saveSettings({ maxTokens: 100, budgetUsd: null });
    const task = f.runtime.start("owner", f.project.id, f.version.id, "develop");
    f.store.saveSettings({ maxTokens: null, budgetUsd: null });
    const result = await f.runtime.wait("owner", task.id);
    expect(result.status).toBe("interrupted");
    expect(result.error).toContain("Token 上限");
    expect(result.usage).toMatchObject({ inputTokens: 100, outputTokens: 20, reportedRequests: 1 });
    expect(result.limits?.maxTokens).toBe(100);
    expect(calls).toBe(1);
    expect(readFileSync(join(f.dir, "app.mjs"), "utf8")).toBe("export const value = 1;\n");
    expect(result.reviews).toEqual([]);
    expect(result.checks).toEqual([]);
  });
  it("persists clarification drafts and conversation across runtime restart", async () => {
    const f = fixture(async (_url, init) => {
      const req = JSON.parse(String(init?.body));
      return req.messages.at(-1).role === "tool"
        ? sse("请确认平台")
        : sse("", { name: "record_requirements", args: { ...draft, questions: ["目标平台?"] } });
    });
    const task = f.runtime.start("owner", f.project.id, f.version.id, "clarify", "先问我问题");
    f.runtime.subscribe("owner", task.id, () => {
      throw new Error("browser disconnected");
    });
    const result = await f.runtime.wait("owner", task.id);
    expect(result.status).toBe("completed");
    const v = f.store.version("owner", f.project.id, f.version.id);
    expect(v.revisions[0]?.questions).toEqual(["目标平台?"]);
    expect(v.dialogue.map((d) => d.text)).toEqual(["先问我问题", "请确认平台"]);
    const restart = new WorkbenchRuntime(new WorkbenchStore(f.store.dataDir), {
      configPath: f.configPath,
    });
    runtimes.push(restart);
    expect(restart.list("owner", f.project.id)).toHaveLength(1);
    expect(restart.get("owner", task.id).status).toBe("completed");
  });
  it.each(["commit", "unborn", "none"] as const)(
    "writes, reviews and validates a %s workspace",
    async (gitMode) => {
      const systems: string[] = [];
      const f = fixture(async (_url, init) => {
        const req = JSON.parse(String(init?.body));
        const system = req.messages[0].content;
        systems.push(system);
        if (req.messages.at(-1).role === "tool") return sse("完成");
        return system.includes("独立代码审查员")
          ? sse("", { name: "record_review", args: { summary: "核对 value=2", findings: [] } })
          : sse("", {
              name: "write_file",
              args: { path: "app.mjs", content: "export const value = 2;\n" },
            });
      }, gitMode);
      confirm(f);
      const task = f.runtime.start("owner", f.project.id, f.version.id, "develop");
      expect(() => f.runtime.start("owner", f.project.id, f.version.id, "develop")).toThrow(
        "已有任务",
      );
      const result = await f.runtime.wait("owner", task.id);
      expect(result.error).toBeUndefined();
      expect(result.status).toBe("completed");
      expect(readFileSync(join(f.dir, "app.mjs"), "utf8")).toContain("value = 2");
      expect(result.checks).toHaveLength(2);
      expect(result.checks[0]?.output).toContain("real test passed");
      expect(
        result.checks.every(
          (c) => c.exitCode === 0 && c.fingerprint === result.verifiedFingerprint,
        ),
      ).toBe(true);
      expect(result.reviews).toHaveLength(1);
      expect(result.changes?.diff).toContain("-export const value = 1;");
      expect(result.changes?.diff).toContain("+export const value = 2;");
      expect(systems.some((s) => s.includes("独立代码审查员"))).toBe(true);
      expect(() =>
        f.runtime.start("owner", f.project.id, f.version.id, "develop", "", task.id),
      ).toThrow("只能继续");
    },
  );
  it("does not accept model claims as test evidence and bounds failed repair rounds", async () => {
    const f = fixture(async (_url, init) => {
      const req = JSON.parse(String(init?.body));
      if (req.messages.at(-1).role === "tool") return sse("所有测试通过");
      return req.messages[0].content.includes("独立代码审查员")
        ? sse("", { name: "record_review", args: { summary: "没问题", findings: [] } })
        : sse("我已经写完，测试通过了");
    });
    confirm(f);
    const task = f.runtime.start("owner", f.project.id, f.version.id, "develop");
    const result = await f.runtime.wait("owner", task.id);
    expect(result.status).toBe("failed");
    expect(result.attempt).toBe(2);
    expect(result.checks.filter((c) => c.kind === "test").every((c) => c.exitCode === 1)).toBe(
      true,
    );
    expect(result.verifiedFingerprint).toBeUndefined();
  });
  it.each(["disconnect", "cancel"] as const)(
    "preserves real partial edits when the next model turn ends by %s",
    async (failure) => {
      let calls = 0;
      let notifyRequest!: () => void;
      const nextRequest = new Promise<void>((resolve) => {
        notifyRequest = resolve;
      });
      const f = fixture(async (_url, init) => {
        calls++;
        if (calls === 1)
          return sse("", {
            name: "write_file",
            args: { path: "app.mjs", content: "export const value = 2;\n" },
          });
        notifyRequest();
        if (failure === "disconnect")
          return new Response('data: {"choices":[{"delta":{"content":"partial answer"}}]}\n\n');
        return new Promise<Response>((_resolve, reject) => {
          const signal = init?.signal;
          if (signal?.aborted) reject(signal.reason);
          else signal?.addEventListener("abort", () => reject(signal.reason), { once: true });
        });
      });
      confirm(f);
      const task = f.runtime.start("owner", f.project.id, f.version.id, "develop");
      await nextRequest;
      if (failure === "cancel") f.runtime.cancel("owner", task.id);
      const result = await f.runtime.wait("owner", task.id);
      expect(result.status).toBe(failure === "cancel" ? "interrupted" : "failed");
      if (failure === "disconnect")
        expect(result.error).toContain("disconnected before completion");
      expect(result.changes?.diff).toContain("+export const value = 2;");
      expect(result.changes?.diff).toContain("-export const value = 1;");
      expect(result.changesError).toBeUndefined();
      expect(result.checks).toEqual([]);
      expect(result.reviews).toEqual([]);
      expect(result.verifiedFingerprint).toBeUndefined();
      expect(calls).toBe(2);
      expect(readFileSync(join(f.dir, "app.mjs"), "utf8")).toContain("value = 2");
      const persisted = JSON.parse(
        readFileSync(join(f.store.dataDir, "tasks", `${task.id}.json`), "utf8"),
      );
      expect(persisted.changes).toEqual(result.changes);
    },
  );

  it("reports unavailable failure diffs without losing the original model error", async () => {
    const f = fixture(async () => {
      for (const file of readdirSync(join(f.store.dataDir, "tasks"))) {
        if (file.endsWith(".baseline.json")) rmSync(join(f.store.dataDir, "tasks", file));
      }
      return new Response('data: {"choices":[{"delta":{"content":"partial answer"}}]}\n\n');
    });
    confirm(f);
    const task = f.runtime.start("owner", f.project.id, f.version.id, "develop");
    const result = await f.runtime.wait("owner", task.id);
    expect(result.status).toBe("failed");
    expect(result.error).toContain("disconnected before completion");
    expect(result.changesError).toContain("开发前快照不可用");
  });
  it("requires matching task approval, then cancellation frees a pending command", async () => {
    const f = fixture(async (_url, init) => {
      const req = JSON.parse(String(init?.body));
      return req.messages.at(-1).role === "tool"
        ? sse("done")
        : sse("", {
            name: "run_command",
            args: { command: `"${process.execPath}" -e "console.log('approved')"` },
          });
    });
    confirm(f);
    const task = f.runtime.start("owner", f.project.id, f.version.id, "develop");
    await new Promise<void>((resolve) => {
      const unsub = f.runtime.subscribe("owner", task.id, () => {
        if (f.runtime.get("owner", task.id).approval) {
          unsub();
          resolve();
        }
      });
    });
    const waiting = f.runtime.get("owner", task.id);
    expect(waiting.status).toBe("waiting_for_approval");
    const nestedDir = join(f.dir, "nested");
    mkdirSync(nestedDir);
    const nested = f.store.addProject("owner", nestedDir);
    const nestedVersion = f.store.createVersion("owner", nested.id, {
      label: "1",
      requirement: "nested project",
    });
    expect(() => f.runtime.start("owner", nested.id, nestedVersion.id, "clarify", "hello")).toThrow(
      "重叠",
    );
    expect(() => f.runtime.approve("other", task.id, waiting.approval!.id, true)).toThrow();
    expect(() => f.runtime.approve("owner", task.id, 9999, true)).toThrow();
    f.runtime.cancel("owner", task.id);
    expect((await f.runtime.wait("owner", task.id)).status).toBe("interrupted");
    expect(f.runtime.isBusy(f.project.id)).toBe(false);
  });
  it("marks a crashed run interrupted without replaying commands", async () => {
    const f = fixture(async () => sse("done"));
    const task = f.runtime.start("owner", f.project.id, f.version.id, "clarify", "hello");
    await f.runtime.wait("owner", task.id);
    atomicJson(join(f.store.dataDir, "tasks", `${task.id}.json`), { ...task, status: "running" });
    const restored = new WorkbenchRuntime(f.store, { configPath: f.configPath });
    runtimes.push(restored);
    expect(restored.get("owner", task.id).status).toBe("interrupted");
    expect(restored.get("owner", task.id).error).toContain("不会自动重放");
  });

  it("carries failure receipts into an explicitly resumed task after restart, with fresh evidence", async () => {
    let repairing = false;
    const prompts: string[] = [];
    const provider: typeof fetch = async (_url, init) => {
      const req = JSON.parse(String(init?.body));
      if (req.messages.at(-1).role === "tool") return sse("本回合结束");
      if (req.messages[0].content.includes("独立代码审查员"))
        return sse("", {
          name: "record_review",
          args: { summary: "请以服务命令结果为准", findings: [] },
        });
      prompts.push(req.messages.at(-1).content);
      return repairing
        ? sse("", {
            name: "write_file",
            args: { path: "app.mjs", content: "export const value = 2;\n" },
          })
        : sse("暂未修改");
    };
    const f = fixture(provider);
    confirm(f);
    const failed = f.runtime.start("owner", f.project.id, f.version.id, "develop");
    expect((await f.runtime.wait("owner", failed.id)).status).toBe("failed");
    const previous = f.runtime.get("owner", failed.id);
    const restarted = new WorkbenchRuntime(new WorkbenchStore(f.store.dataDir), {
      configPath: f.configPath,
      client: () => new DeepSeekClient({ apiKey: "test", fetch: provider }),
    });
    runtimes.push(restarted);
    const other = f.store.createVersion("owner", f.project.id, {
      label: "other",
      requirement: "other",
    });
    f.store.recordDraft("owner", f.project.id, other.id, 0, draft);
    f.store.confirm("owner", f.project.id, other.id, 1);
    // Use the original runtime here; the restarted store predates this newly created version.
    expect(() =>
      f.runtime.start("owner", f.project.id, other.id, "develop", "", failed.id),
    ).toThrow("同一需求版本");
    repairing = true;
    const resumed = restarted.start("owner", f.project.id, f.version.id, "develop", "", failed.id);
    const result = await restarted.wait("owner", resumed.id);
    expect(result.status).toBe("completed");
    expect(result.resumesTaskId).toBe(failed.id);
    const prompt = prompts.at(-1)!;
    expect(prompt).toContain(`"id":"${failed.id}"`);
    expect(prompt).toContain('"exitCode":1');
    expect(prompt).toContain("已达到自动修复上限");
    expect(prompt).toContain("check_result");
    expect(result.checks).toHaveLength(2);
    expect(result.checks.every((c) => c.attempt === 1 && c.exitCode === 0)).toBe(true);
    expect(result.verifiedFingerprint).not.toBe(previous.checks[0]?.fingerprint);
    expect(restarted.get("owner", failed.id)).toEqual(previous);
  });

  it("orders task history by creation time after disk reload, not by UUID filenames", async () => {
    const f = fixture(async () => sse("done"));
    const task = f.runtime.start("owner", f.project.id, f.version.id, "clarify", "hello");
    await f.runtime.wait("owner", task.id);
    const laterId = "00000000-0000-4000-8000-000000000001";
    const earlierId = "ffffffff-ffff-4fff-8fff-ffffffffffff";
    for (const [id, createdAt] of [
      [laterId, "2099-10-02T00:00:00.000Z"],
      [earlierId, "2099-10-01T00:00:00.000Z"],
    ]) {
      atomicJson(join(f.store.dataDir, "tasks", `${id}.json`), {
        ...task,
        id,
        createdAt,
        status: "completed",
      });
    }
    const restored = new WorkbenchRuntime(f.store, { configPath: f.configPath });
    runtimes.push(restored);
    expect(
      restored
        .list("owner", f.project.id)
        .slice(-2)
        .map((t) => t.id),
    ).toEqual([earlierId, laterId]);
  });

  it("completes a version upgrade with inherited requirements, regression tests and real npm packages", async () => {
    let upgrading = false;
    const developerContexts: string[] = [];
    const packageJson = (version: string) =>
      JSON.stringify({
        name: "silicon-workbench-fixture",
        version,
        type: "module",
        files: ["app.mjs"],
        main: "app.mjs",
        private: true,
      });
    const f = fixture(async (_url, init) => {
      const req = JSON.parse(String(init?.body));
      const system = req.messages[0].content;
      const last = req.messages.at(-1);
      const called = req.messages.at(-2)?.tool_calls?.[0]?.function?.name;
      if (system.includes("独立代码审查员")) {
        if (last.role !== "tool") return sse("", { name: "read_file", args: { path: "app.mjs" } });
        if (called === "read_file")
          return sse("", {
            name: "record_review",
            args: {
              summary: "读取代码并检查原有 value 与新增 scale",
              findings: last.content.includes("value = 2") ? [] : ["app.mjs 的 value 不符合需求"],
            },
          });
        return sse("审查结束");
      }
      if (last.role === "tool") return sse("完成");
      if (system.includes("需求分析师"))
        return sse("", {
          name: "record_requirements",
          args: {
            ...draft,
            prd: upgrading
              ? "# PRD 2.0\n保留 value=2，新增 scale(n) 返回 n * value"
              : "# PRD 1.0\n兼容契约：value 永远为 2",
            sdd: "# SDD\napp.mjs 为公开模块，保留旧契约，check.mjs 做回归，npm pack 打包",
            checks: [
              draft.checks[0],
              {
                kind: "build",
                command:
                  "npm pack --offline --ignore-scripts --cache .cache --pack-destination dist",
                timeoutSec: 30,
              },
            ],
          },
        });
      developerContexts.push(last.content);
      if (!upgrading)
        return sse("", {
          name: "write_file",
          args: { path: "app.mjs", content: "export const value = 2;\n" },
        });
      return sse("", {
        name: "multi_edit",
        args: {
          edits: [
            {
              path: "app.mjs",
              search: "export const value = 2;",
              replace: "export const value = 2;\nexport function scale(n) { return n * value; }",
            },
            { path: "check.mjs", search: "import { value }", replace: "import { value, scale }" },
            {
              path: "check.mjs",
              search: 'console.log("real test passed");',
              replace:
                'if(scale(3) !== 6) process.exit(2); console.log("legacy and upgrade tests passed");',
            },
            { path: "package.json", search: packageJson("1.0.0"), replace: packageJson("2.0.0") },
          ],
        },
      });
    });
    writeFileSync(join(f.dir, "package.json"), packageJson("1.0.0"));
    writeFileSync(join(f.dir, ".gitignore"), "dist/\n.cache/\n");
    mkdirSync(join(f.dir, "dist"));
    const runVersion = async (versionId: string) => {
      const clarify = f.runtime.start(
        "owner",
        f.project.id,
        versionId,
        "clarify",
        "请结合当前代码生成可执行文档",
      );
      expect((await f.runtime.wait("owner", clarify.id)).status).toBe("completed");
      f.store.confirm("owner", f.project.id, versionId, 1);
      const development = f.runtime.start("owner", f.project.id, versionId, "develop");
      const result = await f.runtime.wait("owner", development.id);
      expect(result.error).toBeUndefined();
      expect(result.status).toBe("completed");
      expect(result.checks.every((c) => c.exitCode === 0)).toBe(true);
      return result;
    };
    const first = await runVersion(f.version.id);
    const originalDocuments = f.store.version("owner", f.project.id, f.version.id).revisions;
    const next = f.store.createVersion("owner", f.project.id, {
      label: "2.0",
      requirement: "保留 1.0 的 value，新增 scale 函数并更新 npm 版本",
      parentId: f.version.id,
    });
    upgrading = true;
    const second = await runVersion(next.id);
    expect(developerContexts.at(-1)).toContain("兼容契约：value 永远为 2");
    expect(second.checks[0]?.output).toContain("legacy and upgrade tests passed");
    expect(f.store.version("owner", f.project.id, f.version.id).revisions).toEqual(
      originalDocuments,
    );
    expect(first.verifiedFingerprint).not.toBe(second.verifiedFingerprint);
    const packages = readdirSync(join(f.dir, "dist")).filter((name) => name.endsWith(".tgz"));
    expect(packages.sort()).toEqual([
      "silicon-workbench-fixture-1.0.0.tgz",
      "silicon-workbench-fixture-2.0.0.tgz",
    ]);
    const archive = gunzipSync(
      readFileSync(join(f.dir, "dist", "silicon-workbench-fixture-2.0.0.tgz")),
    ).toString("utf8");
    expect(archive).toContain("package/app.mjs");
    expect(archive).toContain("export function scale(n)");
    expect(archive).toContain('"version":"2.0.0"');
  });
});
