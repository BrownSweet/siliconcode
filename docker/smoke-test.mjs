// Run after `docker compose build`: node docker/smoke-test.mjs
// Uses an isolated, disposable container and a fake key; never calls the model.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { setTimeout } from "node:timers/promises";

const name = `siliconcode-smoke-${randomBytes(5).toString("hex")}`;
const token = randomBytes(24).toString("hex");
const docker = (...args) => execFileSync("docker", args, { encoding: "utf8", timeout: 30000 }).trim();
let created = false;
try {
  docker("run", "-d", "--init", "--name", name, "-p", "127.0.0.1::3100",
    "-e", `SILICONCODE_DASHBOARD_TOKEN=${token}`, "-e", "SILICONCODE_DIAGNOSTICS=off", "siliconcode:local");
  created = true;
  const port = docker("port", name, "3100/tcp").split(":").at(-1);
  let base = `http://127.0.0.1:${port}`;
  const request = (path, options = {}) => fetch(`${base}${path}`, {
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
    assert.equal((await request(asset[1].replaceAll("&amp;", "&"))).status, 200, asset[1]);
  }
  docker("exec", name, "node", "/opt/siliconcode/docker/healthcheck.mjs");
  docker("exec", name, "sh", "-c", "test -w /workspace/project/node_modules && test -w /workspace/.siliconcode-worktrees");
  docker("restart", name);
  // Docker may allocate a new ephemeral host port on restart.
  base = `http://127.0.0.1:${docker("port", name, "3100/tcp").split(":").at(-1)}`;
  await waitFor(async () => (await request("/api/delivery", { headers })).ok);
  const restored = await (await request(`/api/delivery/${runId}`, { headers })).json();
  assert.equal(restored.run.id, runId);
  assert.equal(docker("exec", name, "stat", "-c", "%a", "/home/node/.siliconcode/config.json"), "600");
  console.log("PASS: setup, authentication, dashboard assets, attached delivery API, state persistence, permissions, healthcheck and restart");
} catch (error) {
  if (created) console.error(docker("logs", "--tail=20", name).replaceAll(token, "[token]"));
  throw error;
} finally {
  if (created) docker("rm", "-f", name);
}
