// Run after `docker build -t siliconcode:local .`: node docker/smoke-test.mjs
// Uses an isolated, disposable container and a fake key; never calls the model.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout } from "node:timers/promises";

const name = `siliconcode-smoke-${randomBytes(5).toString("hex")}`;
const basePath = process.env.SILICONCODE_BASE_PATH || "/siliconcode/";
const prefix = basePath.replace(/\/+$/, "");
const token = randomBytes(24).toString("hex");
const docker = (...args) => execFileSync("docker", args, { encoding: "utf8", timeout: 30000 }).trim();
const project = mkdtempSync(join(tmpdir(), "siliconcode-docker-smoke-"));
writeFileSync(join(project, "README.md"), "Disposable Docker smoke project\n");
const volumes = ["state", "worktrees", "node-modules"].map(kind => `${name}-${kind}`);
let created = false;
function startContainer() {
  docker("run", "-d", "--init", "--name", name, "--restart", "unless-stopped",
    "-p", "127.0.0.1::3100",
    "--mount", `type=bind,source=${project},target=/workspace/project`,
    "-v", `${volumes[0]}:/home/node/.siliconcode`,
    "-v", `${volumes[1]}:/workspace/.siliconcode-worktrees`,
    "-v", `${volumes[2]}:/workspace/project/node_modules`,
    "-e", `SILICONCODE_DASHBOARD_TOKEN=${token}`, "-e", "SILICONCODE_DIAGNOSTICS=off", "siliconcode:local");
  created = true;
}
try {
  startContainer();
  const port = docker("port", name, "3100/tcp").split(":").at(-1);
  let base = `http://127.0.0.1:${port}`;
  const request = (path, options = {}) => fetch(`${base}${prefix}${path}`, {
    ...options, signal: AbortSignal.timeout(4000),
  });
  async function waitFor(check) {
    const deadline = Date.now() + 45000;
    while (Date.now() < deadline) {
      try { if (await check()) return; } catch { /* booting */ }
      await setTimeout(500);
    }
    throw new Error("Container did not become ready within 45 seconds");
  }
  await waitFor(async () => (await request(`/?token=${token}`)).ok);
  assert.equal((await request("/")).status, 401);
  if (prefix) {
    assert.equal((await fetch(`${base}/`)).status, 404);
    const redirect = await fetch(`${base}${prefix}?token=${token}`, { redirect: "manual" });
    assert.equal(redirect.status, 308);
    assert.equal(redirect.headers.get("location"), `${prefix}/?token=${token}`);
  }
  docker("exec", name, "node", "/opt/siliconcode/docker/healthcheck.mjs");
  assert.match(await (await request(`/?token=${token}`)).text(), /容器已启动/);
  const headers = { "Content-Type": "application/json", "X-Siliconcode-Token": token };
  assert.equal((await request(`/setup?token=${token}`, { method: "POST", body: "{}" })).status, 401);
  assert.equal((await request("/setup", { method: "POST", headers, body: '{"apiKey":""}' })).status, 400);
  assert.equal((await request("/setup", { method: "POST", headers, body: '{"apiKey":"sk-container-smoke-not-real"}' })).status, 200);
  await waitFor(async () => (await (await request(`/?token=${token}`)).text()).includes('name="siliconcode-token"'));
  assert.equal((await request("/api/delivery")).status, 401);
  const listing = await request("/api/delivery", { headers });
  assert.equal(listing.status, 200);
  assert.deepEqual((await listing.json()).runs, []);
  const createdRun = await request("/api/delivery", { method: "POST", headers,
    body: JSON.stringify({ title: "Docker smoke", requirement: "Test persistence only; do not run agent" }) });
  assert.equal(createdRun.status, 201);
  const runId = (await createdRun.json()).run.id;
  assert.ok(runId);
  const html = await (await request(`/?token=${token}`)).text();
  for (const asset of [...html.matchAll(/(?:src|href)="([^\"]+\.(?:js|css)[^\"]*)"/g)]) {
    if (!asset[1].startsWith("/")) continue;
    assert.ok(asset[1].startsWith(`${prefix}/assets/`), asset[1]);
    assert.equal((await fetch(`${base}${asset[1].replaceAll("&amp;", "&")}`)).status, 200, asset[1]);
  }
  docker("exec", name, "node", "/opt/siliconcode/docker/healthcheck.mjs");
  const controller = new AbortController();
  const events = await fetch(`${base}${prefix}/api/events?token=${token}`, { signal: controller.signal });
  assert.match(events.headers.get("content-type"), /text\/event-stream/);
  assert.ok((await events.body.getReader().read()).value.length);
  controller.abort();
  docker("exec", name, "sh", "-c", "test -w /workspace/project/node_modules && test -w /workspace/.siliconcode-worktrees");
  docker("restart", name);
  // Docker may allocate a new ephemeral host port on restart.
  base = `http://127.0.0.1:${docker("port", name, "3100/tcp").split(":").at(-1)}`;
  await waitFor(async () => (await request("/api/delivery", { headers })).ok);
  const restored = await (await request(`/api/delivery/${runId}`, { headers })).json();
  assert.equal(restored.run.id, runId);
  assert.equal(docker("exec", name, "stat", "-c", "%a", "/home/node/.siliconcode/config.json"), "600");
  docker("stop", name);
  docker("rm", name);
  created = false;
  startContainer();
  base = `http://127.0.0.1:${docker("port", name, "3100/tcp").split(":").at(-1)}`;
  await waitFor(async () => (await request("/api/delivery", { headers })).ok);
  const recreated = await (await request(`/api/delivery/${runId}`, { headers })).json();
  assert.equal(recreated.run.id, runId);
  docker("exec", name, "node", "/opt/siliconcode/docker/healthcheck.mjs");
  console.log("PASS: subpath routing, SSE, setup, authentication, dashboard assets, attached delivery API, state persistence, permissions, healthcheck, restart and container recreation with persistent mounts");
} catch (error) {
  if (created) console.error(docker("logs", "--tail=20", name).replaceAll(token, "[token]"));
  throw error;
} finally {
  if (created) docker("rm", "-f", name);
  for (const volume of volumes) {
    try { docker("volume", "rm", volume); } catch { /* not created if docker run failed */ }
  }
  rmSync(project, { recursive: true, force: true });
}
