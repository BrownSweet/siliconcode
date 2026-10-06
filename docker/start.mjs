import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const configuredBase = process.env.SILICONCODE_BASE_PATH?.trim() || "/";
if (!/^(?:\/[A-Za-z0-9_-]+)*\/?$/.test(configuredBase)) throw new Error("Invalid SILICONCODE_BASE_PATH");
const basePath = configuredBase.endsWith("/") ? configuredBase : `${configuredBase}/`;
process.env.SILICONCODE_BASE_PATH = basePath;

// Keep existing container host/port variables compatible with deployed configurations.
const port = Number(process.env.SILICONCODE_DASHBOARD_PORT || "3100");
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Invalid dashboard port");
const host = process.env.SILICONCODE_DASHBOARD_HOST || "0.0.0.0";
const configuredOrigin = process.env.SILICONCODE_WORKBENCH_ORIGIN?.trim();
let origin;
if (configuredOrigin) {
  const url = new URL(configuredOrigin);
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || url.pathname !== "/") {
    throw new Error("SILICONCODE_WORKBENCH_ORIGIN 必须是 HTTPS 域名地址，不含路径，例如 https://tec.zhiquant.com");
  }
  origin = url.origin;
} else if (!["localhost", "127.0.0.1", "::1"].includes(host)) {
  throw new Error("请设置 SILICONCODE_WORKBENCH_ORIGIN 为外部 HTTPS 地址，例如 https://tec.zhiquant.com；由反向代理提供 HTTPS。");
}

const stateDir = join(homedir(), ".siliconcode");
mkdirSync(stateDir, { recursive: true, mode: 0o700 });
const configPath = join(stateDir, "config.json");
const config = existsSync(configPath) ? JSON.parse(readFileSync(configPath, "utf8")) : {};
const temp = `${configPath}.tmp`;
writeFileSync(temp, `${JSON.stringify({ lang: "zh-CN", ...config, autoUpdate: false }, null, 2)}\n`, { mode: 0o600 });
renameSync(temp, configPath);

const args = [fileURLToPath(new URL("../dist/cli/index.js", import.meta.url)), "serve",
  "--host", host, "--port", String(port),
  "--data-dir", join(stateDir, "workbench"), "--config-path", configPath];
if (origin) args.push("--origin", origin);

// Stream the workbench's first-time administrator credential to `docker logs`.
// No model key or terminal session is needed to reach the login/setup page.
// Skip the CLI's synchronous heap re-launch wrapper so SIGTERM reaches the server
// and releases its data lock. Keep Node's container-aware heap default (or NODE_OPTIONS).
const child = spawn(process.execPath, args, {
  stdio: "inherit", env: { ...process.env, SILICONCODE_HEAP_REEXEC: "1" },
});
let shuttingDown = false;
for (const signal of ["SIGTERM", "SIGINT"]) {
  process.on(signal, () => {
    if (shuttingDown) return;
    shuttingDown = true;
    child.kill("SIGTERM");
    setTimeout(() => { child.kill("SIGKILL"); }, 8000).unref();
  });
}
child.on("error", (error) => { console.error(error.message); process.exitCode = 1; });
child.on("exit", (code) => { process.exit(code ?? 1); });
