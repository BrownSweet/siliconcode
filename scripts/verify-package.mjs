// Run after npm run verify. Installs the actual tarball in an empty prefix and
// boots its browser server with disposable state; no model request is made.
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repository = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const output = resolve(process.argv[2] || mkdtempSync(join(tmpdir(), "silicon-package-")));
const scratch = mkdtempSync(join(tmpdir(), "silicon-package-install-"));
mkdirSync(output, { recursive: true });
const npm = "npm";
const npmCli = process.env.npm_execpath;
assert(npmCli, "Use npm run verify:package to provide the npm CLI path");
function command(bin, args, cwd = repository) {
  return execFileSync(bin === npm ? process.execPath : bin, bin === npm ? [npmCli, ...args] : args, { cwd, env: { ...process.env, npm_config_cache: join(scratch, "npm-cache"), npm_config_ignore_scripts: "true", SKIP_INSTALL_SIMPLE_GIT_HOOKS: "1" }, encoding: "utf8", timeout: 180_000, maxBuffer: 8 * 1024 * 1024 });
}
let child;
let closed;
try {
  const packed = command(npm, ["pack", "--ignore-scripts", "--json", "--pack-destination", output]);
  const jsonStart = packed.lastIndexOf("\n[");
  const [pack] = JSON.parse(packed.slice(jsonStart < 0 ? 0 : jsonStart + 1));
  const paths = new Set(pack.files.map((file) => file.path));
  for (const path of ["LICENSE", "THIRD_PARTY_NOTICES.md", "LICENSES/DeepSeek-Reasonix-MIT.txt", "dist/cli/index.js", "dashboard/workbench.html", "dashboard/workbench.css", "dashboard/dist/workbench.js"])
    assert(paths.has(path), `Missing package file: ${path}`);
  assert(![...paths].some((path) => /(^|\/)(\.env|account\.json|config\.json)$/.test(path)), "Private configuration included");
  const archive = join(output, pack.filename);
  command(npm, ["install", "--prefix", scratch, "--ignore-scripts", "--no-audit", "--no-fund", "--cache", join(scratch, "npm-cache"), archive], scratch);
  const installed = join(scratch, "node_modules", "@brownsweet", "siliconcode");
  const cli = join(installed, "dist", "cli", "index.js");
  const metadata = JSON.parse(readFileSync(join(installed, "package.json"), "utf8"));
  assert.deepEqual(Object.keys(metadata.bin), ["brown"]);
  assert(command(process.execPath, [cli, "--version"], scratch).includes(metadata.version));
  assert(command(npm, ["exec", "--offline", "--no", "--", "brown", "--version"], scratch).includes(metadata.version));
  assert(readFileSync(join(installed, "LICENSES", "DeepSeek-Reasonix-MIT.txt"), "utf8").includes("Permission is hereby granted"));
  assert(command(process.execPath, [cli, "serve", "--help"], scratch).includes("--data-dir"));
  assert(command(process.execPath, [cli, "workbench-restore", "--help"], scratch).includes("--data-dir"));
  const config = join(scratch, "fixture-config.json"); writeFileSync(config, "{}");
  child = spawn(process.execPath, [cli, "serve", "--host", "127.0.0.1", "--port", "0", "--data-dir", join(scratch, "data"), "--config-path", config], { cwd: scratch, stdio: ["ignore", "pipe", "pipe"] });
  closed = new Promise((resolve) => child.once("close", resolve));
  child.on("error", () => {});
  let stdout = "";
  child.stdout.on("data", (data) => { stdout = (stdout + data).slice(-16_384); });
  child.stderr.resume();
  const deadline = Date.now() + 15_000;
  let url;
  while (Date.now() < deadline) {
    url = stdout.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0];
    if (url) break;
    assert(child.exitCode === null, "Installed server exited before startup");
    await new Promise((r) => setTimeout(r, 50));
  }
  assert(url, "Installed server did not report its URL");
  const html = await (await fetch(url)).text();
  assert(html.includes("Silicon Code"));
  for (const path of ["/assets/workbench.js", "/assets/workbench.css"])
    assert.equal((await fetch(url + path)).status, 200, path);
  assert.equal((await fetch(url + "/api/projects")).status, 401);
  child.kill("SIGTERM");
  const code = await Promise.race([closed, new Promise((_, reject) => setTimeout(() => reject(new Error("Server shutdown timed out")), 10_000).unref())]);
  assert(code === 0 || (process.platform === "win32" && code === null), `Server exit code: ${code}`);
  child = undefined;
  const report = { archive, version: metadata.version, node: process.version, platform: process.platform,
    sha256: createHash("sha256").update(readFileSync(archive)).digest("hex"), packageFiles: paths.size,
    verified: ["empty-prefix install", "brown version and help", "serve and restore command availability", "installed HTTP server and assets", "authenticated API boundary", "process shutdown", "MIT attribution included"],
    testedAt: new Date().toISOString() };
  writeFileSync(join(output, "verification.json"), JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify(report, null, 2));
} finally {
  if (child && child.exitCode === null) {
    child.kill("SIGTERM");
    const force = setTimeout(() => child?.kill("SIGKILL"), 5000);
    try { await closed; } finally { clearTimeout(force); }
  }
  rmSync(scratch, { recursive: true, force: true });
}
