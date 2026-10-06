// Run after `docker build -t siliconcode:local .`: node docker/smoke-test.mjs
// Isolated disposable containers and fake credentials; never calls the model.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout } from "node:timers/promises";

// Send the proxy's Host explicitly; native fetch may ignore a custom Host.
function fetch(url, options = {}) {
  return new Promise((resolve, reject) => {
    const req = httpRequest(url, { method: options.method, headers: options.headers, signal: options.signal }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("error", reject);
      res.on("end", () => {
        const headers = new Headers();
        for (const [key, value] of Object.entries(res.headers)) {
          for (const item of Array.isArray(value) ? value : [value]) if (item !== undefined) headers.append(key, item);
        }
        resolve(new Response(Buffer.concat(chunks), { status: res.statusCode, headers }));
      });
    });
    req.on("error", reject);
    req.setTimeout(4000, () => req.destroy(new Error("HTTP probe timed out")));
    req.end(options.body);
  });
}

const name = `siliconcode-smoke-${randomBytes(5).toString("hex")}`;
const basePath = process.env.SILICONCODE_BASE_PATH || "/siliconcode/";
const prefix = basePath.replace(/\/+$/, "");
const origin = "https://workbench.example.invalid";
const docker = (...args) => execFileSync("docker", args, { encoding: "utf8", timeout: 30000, stdio: ["ignore", "pipe", "pipe"] }).trim();
const project = mkdtempSync(join(tmpdir(), "siliconcode-docker-smoke-"));
writeFileSync(join(project, "README.md"), "Disposable Docker smoke project\n");
const volumes = ["state", "worktrees", "node-modules"].map(kind => `${name}-${kind}`);
const credentials = { username: "smoke", password: randomBytes(24).toString("hex") };
const fakeKey = "sk-container-smoke-not-real";
let created = false;
let setupToken = "";
function startContainer() {
  docker("run", "-d", "--init", "--name", name, "--restart", "unless-stopped",
    "-p", "127.0.0.1::3100",
    "--mount", `type=bind,source=${project},target=/workspace/project`,
    "-v", `${volumes[0]}:/home/node/.siliconcode`,
    "-v", `${volumes[1]}:/workspace/.siliconcode-worktrees`,
    "-v", `${volumes[2]}:/workspace/project/node_modules`,
    "-e", `SILICONCODE_WORKBENCH_ORIGIN=${origin}`, "-e", "SILICONCODE_DIAGNOSTICS=off", "siliconcode:local");
  created = true;
}
try {
  // A publicly bound workbench must never silently fall back to the token dashboard.
  assert.throws(() => docker("run", "--rm", "siliconcode:local"), /SILICONCODE_WORKBENCH_ORIGIN/);
  assert.throws(() => docker("run", "--rm", "-e", "SILICONCODE_WORKBENCH_ORIGIN=http://invalid.test", "siliconcode:local"), /HTTPS/);
  startContainer();
  let base;
  const refreshPort = () => { base = `http://127.0.0.1:${docker("port", name, "3100/tcp").split(":").at(-1)}`; };
  refreshPort();
  // Match the Host/Origin headers sent by the external HTTPS proxy.
  const request = (path, options = {}) => fetch(`${base}${prefix}${path}`, {
    ...options,
    headers: { Host: new URL(origin).host, Origin: origin, "Content-Type": "application/json", ...options.headers },
    signal: AbortSignal.timeout(4000),
  });
  async function waitFor(check) {
    const deadline = Date.now() + 45000;
    while (Date.now() < deadline) {
      try { if (await check()) return; } catch { /* booting */ }
      await setTimeout(500);
    }
    throw new Error("Container did not become ready within 45 seconds");
  }
  const ready = () => waitFor(async () => (await request("/api/auth/status")).ok);
  const login = async () => {
    const response = await request("/api/auth/login", { method: "POST", body: JSON.stringify(credentials) });
    assert.equal(response.status, 200);
    const cookie = response.headers.get("set-cookie");
    assert.ok(cookie.includes(`Path=${basePath};`));
    assert.ok(cookie.includes("HttpOnly") && cookie.includes("Secure") && cookie.includes("SameSite=Strict"));
    return { cookie: cookie.split(";")[0], "X-Siliconcode-Csrf": (await response.json()).csrf };
  };
  await ready();
  assert.deepEqual(await (await request("/api/auth/status")).json(), { needsSetup: true });
  const html = await (await request("/")).text();
  assert.match(html, /Silicon Code · 开发工作台/);
  assert.ok(html.includes(`src="${prefix}/assets/workbench.js"`));
  assert.ok(!html.includes("siliconcode-token") && !html.includes("assets/app.js"));
  for (const asset of [...html.matchAll(/(?:src|href)="([^\"]+\.(?:js|css))"/g)]) {
    assert.ok(asset[1].startsWith(`${prefix}/assets/`));
    assert.equal((await fetch(`${base}${asset[1]}`, { headers: { Host: new URL(origin).host } })).status, 200);
  }
  assert.equal((await fetch(`${base}${prefix}/`)).status, 403, "unexpected Host must be rejected");
  assert.equal((await request("/api/projects?token=legacy-token")).status, 401);
  if (prefix) {
    assert.equal((await fetch(`${base}/`, { headers: { Host: new URL(origin).host } })).status, 404);
    const redirect = await fetch(`${base}${prefix}`, { headers: { Host: new URL(origin).host }, redirect: "manual" });
    assert.equal(redirect.status, 308);
    assert.equal(redirect.headers.get("location"), `${prefix}/`);
  }
  docker("exec", name, "node", "/opt/siliconcode/docker/healthcheck.mjs");
  setupToken = docker("logs", name).match(/首次设置凭据（仅用于创建管理员）：([a-f0-9]+)/)?.[1];
  assert.ok(setupToken, "first-time credential must be visible in docker logs");
  assert.equal((await request("/api/auth/setup", { method: "POST", body: JSON.stringify({ ...credentials, setupToken: "wrong" }) })).status, 403);
  assert.equal((await request("/api/auth/setup", { method: "POST", body: JSON.stringify({ ...credentials, setupToken }) })).status, 201);
  let headers = await login();
  assert.equal((await request("/api/projects", { method: "POST", headers: { cookie: headers.cookie }, body: '{}' })).status, 403);
  assert.equal((await request("/api/projects", { method: "POST", headers: { ...headers, Origin: "https://wrong.invalid" }, body: '{}' })).status, 403);
  const saved = await request("/api/provider", { method: "PUT", headers,
    body: JSON.stringify({ apiKey: fakeKey, baseUrl: "https://api.deepseek.com", model: "deepseek-flash" }) });
  assert.equal(saved.status, 200);
  assert.equal((await saved.json()).apiKeySet, true);
  const added = await request("/api/projects", { method: "POST", headers,
    body: JSON.stringify({ workdir: "/workspace/project", name: "Docker workbench smoke" }) });
  assert.equal(added.status, 201);
  const projectId = (await added.json()).id;
  const versionsPath = `/api/projects/${projectId}/versions`;
  const draft = await request(versionsPath, { method: "POST", headers,
    body: JSON.stringify({ label: "1.0", requirement: "Persist a draft without starting a model task" }) });
  assert.equal(draft.status, 201);
  const versionId = (await draft.json()).id;
  // Existing token data from attached-dashboard deployments is left untouched, but no longer authenticates.
  docker("exec", name, "sh", "-c", "printf legacy-token > /home/node/.siliconcode/dashboard-token");
  async function verifyRestored() {
    await ready();
    assert.equal((await request("/api/auth/status").then(r => r.json())).needsSetup, false);
    assert.equal((await request("/api/projects", { headers })).status, 401, "restart must invalidate sessions");
    headers = await login();
    const projects = await (await request("/api/projects", { headers })).json();
    assert.ok(projects.some(p => p.id === projectId));
    const versions = await (await request(versionsPath, { headers })).json();
    assert.ok(versions.some(v => v.id === versionId));
    assert.equal((await (await request("/api/provider", { headers })).json()).apiKeySet, true);
    assert.equal(docker("exec", name, "cat", "/home/node/.siliconcode/dashboard-token"), "legacy-token");
    assert.equal((await request("/api/projects?token=legacy-token")).status, 401);
    docker("exec", name, "node", "/opt/siliconcode/docker/healthcheck.mjs");
    assert.equal(docker("exec", name, "stat", "-c", "%a", "/home/node/.siliconcode/config.json"), "600");
    assert.equal(docker("exec", name, "stat", "-c", "%a", "/home/node/.siliconcode/workbench/account.json"), "600");
  }
  docker("restart", name);
  refreshPort();
  await verifyRestored();
  docker("stop", name);
  assert.equal(docker("inspect", "--format", "{{.State.ExitCode}}", name), "0", "graceful shutdown");
  docker("rm", name);
  created = false;
  startContainer();
  refreshPort();
  await verifyRestored();
  docker("exec", name, "sh", "-c", "test -w /workspace/project/node_modules && test -w /workspace/.siliconcode-worktrees");
  console.log("PASS: new workbench entrypoint/assets, subpath, administrator setup/login, Host/Origin/CSRF, healthcheck without API key, project/version/provider persistence, restart/recreation and graceful shutdown (no model calls)");
} catch (error) {
  if (created) console.error(docker("logs", "--tail=20", name).replace(/首次设置凭据（仅用于创建管理员）：\S+/g, "首次设置凭据：[redacted]"));
  throw error;
} finally {
  if (created) docker("rm", "-f", name);
  for (const volume of volumes) {
    try { docker("volume", "rm", volume); } catch { /* not created if docker run failed */ }
  }
  rmSync(project, { recursive: true, force: true });
}
