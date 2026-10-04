import { execFileSync } from "node:child_process";
import {
  appendFileSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { startWorkbenchServer } from "../src/workbench/server.js";

const roots: string[] = [];
const servers: Awaited<ReturnType<typeof startWorkbenchServer>>[] = [];
async function fixture(probeFetch?: typeof fetch) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "silicon-workbench-http-")));
  roots.push(root);
  const configPath = join(root, "config.json");
  writeFileSync(configPath, "{}");
  const options = {
    dataDir: join(root, "data"),
    configPath,
    port: 0,
    probeFetch,
    client: () => {
      throw new Error("fixture: no model request");
    },
  };
  const server = await startWorkbenchServer(options);
  servers.push(server);
  const request = (
    path: string,
    method = "GET",
    body?: unknown,
    headers: Record<string, string> = {},
  ) =>
    fetch(`${server.url}${path}`, {
      method,
      headers: { "content-type": "application/json", ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  const login = async () => {
    await request("/api/auth/setup", "POST", {
      username: "brown",
      password: "safe-password-123",
      setupToken: server.auth.setupToken,
    });
    const res = await request("/api/auth/login", "POST", {
      username: "brown",
      password: "safe-password-123",
    });
    const session = await res.json();
    return {
      cookie: res.headers.get("set-cookie")!.split(";")[0]!,
      "x-siliconcode-csrf": session.csrf,
    };
  };
  return { root, options, server, request, login };
}
afterEach(async () => {
  for (const server of servers.splice(0)) await server.close();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  vi.unstubAllEnvs();
});

describe("standalone browser HTTP service", () => {
  it("exposes authorized workspace review/merge and preview controls through the real HTTP path", async () => {
    const f = await fixture();
    const headers = await f.login();
    const dir = join(f.root, "project");
    mkdirSync(dir);
    const git = (args: string[]) => execFileSync("git", args, { cwd: dir, stdio: "ignore" });
    git(["init", "-b", "main"]);
    git(["config", "user.name", "Fixture"]);
    git(["config", "user.email", "fixture@example.invalid"]);
    writeFileSync(join(dir, "app.txt"), "initial\n");
    writeFileSync(join(dir, "preview.mjs"), 'console.log("ready"); setInterval(() => {}, 1000);');
    git(["add", "."]);
    git(["commit", "-m", "initial"]);
    const project = await (
      await f.request("/api/projects", "POST", { workdir: dir }, headers)
    ).json();
    const root = `/api/projects/${project.id}`;
    expect((await f.request(`${root}/workspace`, "POST", { authorize: true })).status).toBe(401);
    expect(
      (
        await f.request(
          `${root}/workspace`,
          "POST",
          { authorize: true },
          { cookie: headers.cookie },
        )
      ).status,
    ).toBe(403);
    expect((await f.request(`${root}/workspace`, "POST", {}, headers)).status).toBe(400);
    const created = await f.request(`${root}/workspace`, "POST", { authorize: true }, headers);
    expect(created.status).toBe(201);
    const child = await created.json();
    writeFileSync(join(child.workdir, "app.txt"), "reviewed\n");
    const review = await (
      await f.request(`/api/projects/${child.id}/workspace-review`, "GET", undefined, headers)
    ).json();
    expect(review.mergeable).toBe(true);
    expect(review.diff).toContain("+reviewed");
    const merged = await f.request(
      `/api/projects/${child.id}/workspace-merge`,
      "POST",
      { authorize: true, tree: review.tree, targetHead: review.targetHead },
      headers,
    );
    expect(merged.status).toBe(200);
    const previewBody = {
      authorize: true,
      command: `"${process.execPath}" preview.mjs`,
      url: "http://127.0.0.1:5173",
    };
    expect(
      (await f.request(`${root}/preview`, "POST", previewBody, { cookie: headers.cookie })).status,
    ).toBe(403);
    const started = await f.request(`${root}/preview`, "POST", previewBody, headers);
    expect(started.status).toBe(202);
    const preview = await started.json();
    expect(preview.status).toBe("running");
    const version = await (
      await f.request(`${root}/versions`, "POST", { label: "1", requirement: "fixture" }, headers)
    ).json();
    expect(
      (await f.request(`${root}/versions/${version.id}/chat`, "POST", { text: "start" }, headers))
        .status,
    ).toBe(409);
    expect(
      (await f.request(`${root}/workspace`, "POST", { authorize: true }, headers)).status,
    ).toBe(409);
    const view = await (await f.request(`${root}/preview`, "GET", undefined, headers)).json();
    expect(view.process.output).toContain("ready");
    expect((await f.request(`${root}/preview-stop`, "POST", {}, headers)).status).toBe(200);
    expect(() => process.kill(preview.pid, 0)).toThrow();
    const restarted = await (
      await f.request(`${root}/preview`, "POST", previewBody, headers)
    ).json();
    await f.server.close();
    expect(() => process.kill(restarted.pid, 0)).toThrow();
  });
  it("serves a public login shell but protects data and mutations with session plus CSRF", async () => {
    const f = await fixture();
    expect((await f.request("/")).status).toBe(200);
    expect((await f.request("/api/projects")).status).toBe(401);
    expect((await f.request("/api/directories")).status).toBe(401);
    expect((await f.request("/api/directories/choose", "POST", {})).status).toBe(401);
    const headers = await f.login();
    const directoryResponse = await f.request("/api/directories", "GET", undefined, headers);
    expect(directoryResponse.status).toBe(200);
    const directoryListing = await directoryResponse.json();
    expect(directoryListing.selectable).toBe(false);
    expect(Array.isArray(directoryListing.directories)).toBe(true);
    expect(typeof directoryListing.nativePicker).toBe("boolean");
    expect(
      (await f.request("/api/directories/choose", "POST", {}, { cookie: headers.cookie })).status,
    ).toBe(403);
    const dir = join(f.root, "project");
    mkdirSync(dir);
    expect(
      (await f.request("/api/projects", "POST", { workdir: dir }, { cookie: headers.cookie }))
        .status,
    ).toBe(403);
    expect(
      (
        await f.request(
          "/api/projects",
          "POST",
          { workdir: dir },
          { ...headers, origin: "https://evil.example" },
        )
      ).status,
    ).toBe(403);
    const res = await f.request("/api/projects", "POST", { workdir: dir }, headers);
    expect(res.status).toBe(201);
    expect((await f.request("/api/projects", "GET", undefined, headers)).status).toBe(200);
    await f.request("/api/auth/logout", "POST", {}, headers);
    expect((await f.request("/api/projects", "GET", undefined, headers)).status).toBe(401);
  });
  it("never returns model secrets and requires authorization plus confirmed documents to develop", async () => {
    const f = await fixture();
    const headers = await f.login();
    const key = "fixture-secret-key-not-for-real";
    const saved = await f.request(
      "/api/provider",
      "PUT",
      { apiKey: key, baseUrl: "https://api.deepseek.com", model: "deepseek-flash" },
      headers,
    );
    expect(await saved.text()).not.toContain(key);
    const dir = join(f.root, "project");
    mkdirSync(dir);
    const project = await (
      await f.request("/api/projects", "POST", { workdir: dir }, headers)
    ).json();
    const version = await (
      await f.request(
        `/api/projects/${project.id}/versions`,
        "POST",
        { label: "1.0", requirement: "app" },
        headers,
      )
    ).json();
    expect(
      (
        await f.request(
          `/api/projects/${project.id}/versions/${version.id}/develop`,
          "POST",
          { revision: 1, authorizeChecks: true },
          headers,
        )
      ).status,
    ).toBe(409);
    expect(
      (
        await f.request(
          `/api/projects/${project.id}/versions/${version.id}/develop`,
          "POST",
          { revision: 1 },
          headers,
        )
      ).status,
    ).toBe(400);
  });
  it("prevents a second host from racing the same data store", async () => {
    const f = await fixture();
    await expect(startWorkbenchServer(f.options)).rejects.toThrow("已有工作台服务");
    await f.server.close();
    const again = await startWorkbenchServer(f.options);
    servers.push(again);
    expect(again.auth.needsSetup).toBe(true);
  });
});

describe("task event recovery", () => {
  async function history(count: number) {
    const f = await fixture();
    const headers = await f.login();
    const user = (await (await f.request("/api/auth/me", "GET", undefined, headers)).json()).userId;
    const workdir = join(f.root, "project");
    mkdirSync(workdir);
    const p = f.server.store.addProject(user, workdir);
    const v = f.server.store.createVersion(user, p.id, { label: "1.0", requirement: "fixture" });
    const task = f.server.runtime.start(user, p.id, v.id, "clarify", "fixture");
    await f.server.runtime.wait(user, task.id);
    const event = (seq: number) => ({
      seq,
      at: new Date().toISOString(),
      type: "loop",
      data: { role: "assistant_delta", content: "x".repeat(1024) },
    });
    const path = join(f.options.dataDir, "tasks", `${task.id}.jsonl`);
    writeFileSync(
      path,
      `${Array.from({ length: count }, (_, i) => JSON.stringify(event(i + 1))).join("\n")}\n`,
    );
    return { ...f, headers, task, path, event, user };
  }
  async function readThrough(
    response: Response,
    last: number,
    slow = false,
    firstChunk?: () => void,
  ) {
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    const ids: number[] = [];
    let onFirstChunk = firstChunk;
    try {
      while (ids.at(-1) !== last) {
        const chunk = await reader.read();
        if (chunk.done) throw new Error("premature SSE close");
        onFirstChunk?.();
        onFirstChunk = undefined;
        buffer += decoder.decode(chunk.value, { stream: true });
        const frames = buffer.split("\n\n");
        buffer = frames.pop()!;
        for (const frame of frames) {
          const match = /^id: (\d+)/m.exec(frame);
          if (match) ids.push(Number(match[1]));
        }
        if (slow) await new Promise((r) => setTimeout(r, 1));
      }
      return ids;
    } finally {
      await reader.cancel();
    }
  }
  it.each([100, 3_000, 30_000])(
    "recovers %i KiB history without losing the cursor",
    async (count) => {
      const f = await history(count);
      const response = await f.request(
        `/api/tasks/${f.task.id}/events`,
        "GET",
        undefined,
        f.headers,
      );
      expect(response.status).toBe(200);
      const ids = await readThrough(response, count, count === 30_000);
      expect(ids).toEqual(Array.from({ length: count }, (_, i) => i + 1));
      const resumed = await f.request(`/api/tasks/${f.task.id}/events`, "GET", undefined, {
        ...f.headers,
        "last-event-id": String(count - 2),
      });
      expect(await readThrough(resumed, count)).toEqual([count - 1, count]);
    },
  );
  it("orders and deduplicates events appended while history is replayed, then releases the subscription", async () => {
    const f = await history(3_000);
    const subscribe = f.server.runtime.subscribe.bind(f.server.runtime);
    let release = vi.fn();
    let notify!: (event: ReturnType<typeof f.event>) => void;
    vi.spyOn(f.server.runtime, "subscribe").mockImplementation((owner, id, listener) => {
      const unsubscribe = subscribe(owner, id, listener);
      notify = listener;
      release = vi.fn(unsubscribe);
      // These events are in both the file snapshot and the live subscription.
      for (const seq of [3001, 3002]) {
        const event = f.event(seq);
        appendFileSync(f.path, `${JSON.stringify(event)}\n`);
        listener(event);
      }
      return release;
    });
    const response = await f.request(`/api/tasks/${f.task.id}/events`, "GET", undefined, f.headers);
    expect(
      await readThrough(response, 3003, true, () => {
        const event = f.event(3003);
        appendFileSync(f.path, `${JSON.stringify(event)}\n`);
        notify(event);
      }),
    ).toEqual(Array.from({ length: 3003 }, (_, i) => i + 1));
    await vi.waitFor(() => expect(release).toHaveBeenCalledTimes(1));
  });
  it("releases history and subscriptions when the client disconnects during replay", async () => {
    const f = await history(30_000);
    const subscribe = f.server.runtime.subscribe.bind(f.server.runtime);
    const release = vi.fn();
    vi.spyOn(f.server.runtime, "subscribe").mockImplementation((owner, id, listener) => {
      const off = subscribe(owner, id, listener);
      return () => {
        release();
        off();
      };
    });
    const response = await f.request(`/api/tasks/${f.task.id}/events`, "GET", undefined, f.headers);
    const reader = response.body!.getReader();
    await reader.read();
    await reader.cancel();
    await vi.waitFor(() => expect(release).toHaveBeenCalledTimes(1));
  });
});

describe("effective provider configuration", () => {
  it("reports env overrides without returning or implicitly persisting an environment key", async () => {
    const f = await fixture();
    const headers = await f.login();
    vi.stubEnv("DEEPSEEK_API_KEY", "fixture-environment-key-123456");
    vi.stubEnv("DEEPSEEK_BASE_URL", "https://api.deepseek.com/v1");
    writeFileSync(
      f.options.configPath,
      JSON.stringify({
        activeModelProviderId: "deepseek",
        modelProviders: [{ id: "deepseek", kind: "deepseek", name: "DeepSeek" }],
      }),
    );
    const body = { baseUrl: "https://api.deepseek.com", model: "deepseek-flash" };
    const saved = await (await f.request("/api/provider", "PUT", body, headers)).json();
    expect(saved.sources).toEqual({
      apiKey: "environment",
      baseUrl: "environment",
      model: "config",
    });
    expect(saved.baseUrl).toBe("https://api.deepseek.com/v1");
    expect(JSON.stringify(saved)).not.toContain("fixture-environment-key");
    const { readFileSync } = await import("node:fs");
    expect(readFileSync(f.options.configPath, "utf8")).not.toContain("fixture-environment-key");
    const next = await (
      await f.request(
        "/api/provider",
        "PUT",
        { ...body, apiKey: "fixture-updated-key-123456" },
        headers,
      )
    ).json();
    expect(next.sources.apiKey).toBe("environment");
    vi.stubEnv("DEEPSEEK_API_KEY", "");
    vi.stubEnv("DEEPSEEK_BASE_URL", "");
    const effective = await (await f.request("/api/provider", "GET", undefined, headers)).json();
    expect(effective.sources).toEqual({ apiKey: "config", baseUrl: "config", model: "config" });
    expect(effective.apiKeySet).toBe(true);
    expect(effective.baseUrl).toBe(body.baseUrl);
  });
});

describe("task metadata and reversible archive", () => {
  it("renames and archives without altering requirements, then restores after a store reload", async () => {
    const f = await fixture();
    const headers = await f.login();
    const workdir = join(f.root, "project");
    mkdirSync(workdir);
    const project = await (await f.request("/api/projects", "POST", { workdir }, headers)).json();
    const version = await (
      await f.request(
        `/api/projects/${project.id}/versions`,
        "POST",
        { label: "1.0", requirement: "original requirement" },
        headers,
      )
    ).json();
    const path = `/api/projects/${project.id}/versions/${version.id}`;
    expect(
      (await f.request(`${path}/metadata`, "POST", { title: "renamed", archived: true })).status,
    ).toBe(401);
    const changed = await (
      await f.request(`${path}/metadata`, "POST", { title: "renamed", archived: true }, headers)
    ).json();
    expect(changed).toMatchObject({
      id: version.id,
      label: "1.0",
      title: "renamed",
      requirement: "original requirement",
      messages: [],
      revisions: [],
    });
    expect(changed.archivedAt).toBeTruthy();
    expect((await f.request(`${path}/chat`, "POST", { text: "run" }, headers)).status).toBe(409);
    const { WorkbenchStore } = await import("../src/workbench/store.js");
    const reloaded = new WorkbenchStore(f.options.dataDir);
    expect(reloaded.listVersions(project.ownerId, project.id)[0]).toMatchObject(changed);
    const restored = await (
      await f.request(`${path}/metadata`, "POST", { archived: false }, headers)
    ).json();
    expect(restored.archivedAt).toBeUndefined();
    expect(restored.requirement).toBe("original requirement");
    expect((await f.request(`${path}/chat`, "POST", { text: "run" }, headers)).status).toBe(202);
  });
});

describe("workbench settings and model probe", () => {
  it("probes the effective model catalog without inference or changing configuration", async () => {
    const requests: string[] = [];
    const f = await fixture(async (url) => {
      requests.push(String(url));
      return new Response(JSON.stringify({ data: [{ id: "deepseek-v4-flash" }] }), {
        headers: { "content-type": "application/json" },
      });
    });
    const headers = await f.login();
    vi.stubEnv("DEEPSEEK_API_KEY", "");
    vi.stubEnv("DEEPSEEK_BASE_URL", "");
    await f.request(
      "/api/provider",
      "PUT",
      {
        apiKey: "fixture-catalog-key-only",
        baseUrl: "https://fixture.invalid",
        model: "deepseek-v4-flash",
      },
      headers,
    );
    const { readFileSync } = await import("node:fs");
    const before = readFileSync(f.options.configPath, "utf8");
    expect((await f.request("/api/provider/probe", "POST", {})).status).toBe(401);
    const result = await (await f.request("/api/provider/probe", "POST", {}, headers)).json();
    expect(result).toMatchObject({
      ok: true,
      modelListed: true,
      selectedModel: "deepseek-v4-flash",
    });
    expect(requests).toEqual(["https://fixture.invalid/models"]);
    expect(JSON.stringify(result)).not.toContain("fixture-catalog-key-only");
    expect(readFileSync(f.options.configPath, "utf8")).toBe(before);
    expect(
      (
        await f.request(
          "/api/settings",
          "PUT",
          { budgetUsd: 1, maxTokens: 1000 },
          { cookie: headers.cookie },
        )
      ).status,
    ).toBe(403);
    const limits = await (
      await f.request("/api/settings", "PUT", { budgetUsd: 1, maxTokens: 1000 }, headers)
    ).json();
    expect(limits).toEqual({ budgetUsd: 1, maxTokens: 1000 });
    expect((await f.request("/api/settings", "PUT", { budgetUsd: -1 }, headers)).status).toBe(400);
    expect((await f.request("/api/backup")).status).toBe(401);
    const backup = await f.request("/api/backup", "GET", undefined, headers);
    expect(backup.status).toBe(200);
    expect(backup.headers.get("content-type")).toBe("application/gzip");
    const { gunzipSync } = await import("node:zlib");
    const records = gunzipSync(Buffer.from(await backup.arrayBuffer())).toString();
    expect(records).toContain('"format":"siliconcode-workbench"');
    expect(records).not.toContain('"path":"config.json"');
  });
});
