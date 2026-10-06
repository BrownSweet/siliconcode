import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { normalizeBasePath } from "../src/server/base-path.js";
import { startDashboardServer } from "../src/server/index.js";
import { startWorkbenchServer } from "../src/workbench/server.js";

const roots: string[] = [];
const servers: { close(): Promise<void> }[] = [];
function root() {
  const dir = mkdtempSync(join(tmpdir(), "siliconcode-base-"));
  roots.push(dir);
  return dir;
}
afterEach(async () => {
  for (const server of servers.splice(0)) await server.close();
  for (const dir of roots.splice(0)) rmSync(dir, { recursive: true, force: true });
  vi.unstubAllEnvs();
});

describe("application subpath", () => {
  it("normalizes paths and rejects unsafe mounts", () => {
    expect(normalizeBasePath("/siliconcode")).toBe("/siliconcode/");
    expect(normalizeBasePath("/")).toBe("/");
    for (const value of ["//example.com/", "/../", "/a?x=1", '/a"/', "relative"]) {
      expect(() => normalizeBasePath(value)).toThrow(/SILICONCODE_BASE_PATH/);
    }
  });

  it("routes dashboard assets, API and SSE under the prefix with unchanged auth", async () => {
    vi.stubEnv("SILICONCODE_BASE_PATH", "/siliconcode");
    const dir = root();
    const server = await startDashboardServer({
      mode: "attached",
      isBusy: () => false,
      subscribeEvents: () => () => {},
      configPath: join(dir, "config.json"),
      usageLogPath: join(dir, "usage.jsonl"),
    });
    servers.push(server);
    const origin = new URL(server.url).origin;
    expect(new URL(server.url).pathname).toBe("/siliconcode/");
    const redirected = await fetch(`${origin}/siliconcode?token=${server.token}`, {
      redirect: "manual",
    });
    expect(redirected.status).toBe(308);
    expect(redirected.headers.get("location")).toBe(`/siliconcode/?token=${server.token}`);
    for (const path of ["/", "/api/overview", "/siliconcode-other/", "/jiami/"]) {
      expect((await fetch(`${origin}${path}?token=${server.token}`)).status).toBe(404);
    }
    const base = `${origin}/siliconcode`;
    const html = await (await fetch(server.url)).text();
    expect(html).toContain('content="/siliconcode/"');
    for (const match of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
      expect(match[1]).toMatch(/^\/siliconcode\/assets\//);
      expect((await fetch(`${origin}${match[1]}`)).status).toBe(200);
    }
    expect((await fetch(`${base}/api/overview`)).status).toBe(401);
    expect((await fetch(`${base}/api/overview?token=${server.token}`)).status).toBe(200);
    expect(
      (await fetch(`${base}/api/settings?token=${server.token}`, { method: "POST", body: "{}" }))
        .status,
    ).toBe(403);
    expect(
      (
        await fetch(`${base}/api/settings`, {
          method: "POST",
          headers: { "X-Siliconcode-Token": server.token },
          body: '{"lang":"zh-CN"}',
        })
      ).status,
    ).toBe(200);
    const controller = new AbortController();
    const events = await fetch(`${base}/api/events?token=${server.token}`, {
      signal: controller.signal,
    });
    expect(events.headers.get("content-type")).toContain("text/event-stream");
    expect((await events.body!.getReader().read()).value?.length).toBeGreaterThan(0);
    controller.abort();
  });

  it("scopes workbench login cookies, HTML, API and logout to the mount", async () => {
    vi.stubEnv("SILICONCODE_BASE_PATH", "/siliconcode/");
    const server = await startWorkbenchServer({ dataDir: root(), port: 0 });
    servers.push(server);
    const html = await (await fetch(`${server.url}/`)).text();
    expect(html).toContain('src="/siliconcode/assets/workbench.js"');
    const request = (path: string, body: unknown, headers: Record<string, string> = {}) =>
      fetch(`${server.url}${path}`, {
        method: "POST",
        headers: { "content-type": "application/json", ...headers },
        body: JSON.stringify(body),
      });
    const credentials = { username: "brown", password: "safe-password-123" };
    expect(
      (await request("/api/auth/setup", { ...credentials, setupToken: server.auth.setupToken }))
        .status,
    ).toBe(201);
    const login = await request("/api/auth/login", credentials);
    expect(login.status).toBe(200);
    const cookie = login.headers.get("set-cookie")!;
    expect(cookie).toContain("Path=/siliconcode/;");
    const session = await login.json();
    const logout = await request(
      "/api/auth/logout",
      {},
      { cookie: cookie.split(";")[0]!, "x-siliconcode-csrf": session.csrf },
    );
    expect(logout.status).toBe(200);
    expect(logout.headers.get("set-cookie")).toContain("Path=/siliconcode/; Max-Age=0");
    expect((await fetch(`${new URL(server.url).origin}/api/auth/status`)).status).toBe(404);
  });
});
