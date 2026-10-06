import { spawn } from "node:child_process";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { homedir } from "node:os";
import { join } from "node:path";

const configuredBase = process.env.SILICONCODE_BASE_PATH?.trim() || "/";
if (!/^(?:\/[A-Za-z0-9_-]+)*\/?$/.test(configuredBase)) throw new Error("Invalid SILICONCODE_BASE_PATH");
const basePath = configuredBase.endsWith("/") ? configuredBase : `${configuredBase}/`;
process.env.SILICONCODE_BASE_PATH = basePath;

const stateDir = join(homedir(), ".siliconcode");
mkdirSync(stateDir, { recursive: true, mode: 0o700 });
const configPath = join(stateDir, "config.json");
const tokenPath = join(stateDir, "dashboard-token");
const port = Number(process.env.SILICONCODE_DASHBOARD_PORT || "3100");
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Invalid dashboard port");
const host = process.env.SILICONCODE_DASHBOARD_HOST || "0.0.0.0";
if (!/^[a-zA-Z0-9.:[\]-]+$/.test(host)) throw new Error("Invalid dashboard host");
const token = process.env.SILICONCODE_DASHBOARD_TOKEN?.trim() ||
  (existsSync(tokenPath) ? readFileSync(tokenPath, "utf8").trim() : randomBytes(24).toString("hex"));
// The dashboard HTML embeds alphanumeric tokens. Reject unsupported values rather than silently changing them.
if (!/^[a-zA-Z0-9]{16,128}$/.test(token)) throw new Error("Dashboard token must be 16-128 alphanumeric characters");
writeFileSync(tokenPath, token, { mode: 0o600 });
process.env.SILICONCODE_DASHBOARD_TOKEN = token;

function readConfig() {
  if (!existsSync(configPath)) return {};
  return JSON.parse(readFileSync(configPath, "utf8"));
}

function saveConfig(config) {
  const temp = `${configPath}.tmp`;
  writeFileSync(temp, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  renameSync(temp, configPath);
}

const config = readConfig();
saveConfig({ lang: "zh-CN", ...config, autoUpdate: false });
console.log(`\nSilicon Code 浏览器地址：http://localhost:${port}${basePath}?token=${token}`);
console.log("远程访问时将 localhost 换为服务器地址；访问端口以 Docker 映射为准。\n");

let child;
let setupServer;
let shuttingDown = false;

function startAgent() {
  if (child || shuttingDown) return;
  // Ink needs a TTY. script gives the existing attached dashboard its full chat,
  // approval, session, and delivery callbacks even under `docker run -d`.
  child = spawn("script", ["-q", "-e", "-c",
    `brown code /workspace/project --resume --dashboard-host ${host} --dashboard-port ${port}`,
    "/dev/null"], {
    detached: true,
    stdio: ["pipe", "pipe", "pipe"],
    env: process.env,
  });
  let tail = "";
  const capture = (chunk) => { tail = (tail + chunk.toString()).slice(-8000); };
  child.stdout.on("data", capture);
  child.stderr.on("data", capture);
  child.on("error", (error) => { console.error(error.message); process.exitCode = 1; });
  child.on("exit", (code) => {
    if (!shuttingDown && code !== 0) console.error(tail.replaceAll(token, "[token]"));
    process.exit(shuttingDown ? 0 : (code ?? 1));
  });
  console.log("正在启动编码会话与完整面板……");
}

for (const signal of ["SIGTERM", "SIGINT"]) {
  process.on(signal, () => {
    if (shuttingDown) return;
    shuttingDown = true;
    if (child?.pid) {
      try { process.kill(-child.pid, "SIGTERM"); } catch { /* already stopped */ }
      setTimeout(() => process.exit(0), 8000).unref();
    } else if (setupServer) {
      setupServer.close(() => process.exit(0));
      setupServer.closeAllConnections();
    } else process.exit(0);
  });
}

function authorized(value) {
  return typeof value === "string" && Buffer.byteLength(value) === Buffer.byteLength(token) &&
    timingSafeEqual(Buffer.from(value), Buffer.from(token));
}

const setupHtml = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Silicon Code · 容器配置</title>
<style>body{font-family:system-ui;background:#10131a;color:#e5e7eb;max-width:560px;margin:10vh auto;padding:24px}input,button{box-sizing:border-box;width:100%;padding:14px;margin:12px 0;border-radius:8px;border:1px solid #536078}input{background:#1b2230;color:white}button{background:#87bfff;color:#10131a;cursor:pointer}p{line-height:1.7;color:#b6c0d0}#error{color:#fca5a5}</style>
<h1>Silicon Code</h1><p>容器已启动。填写 DeepSeek API Key 后即可进入编码与自动交付面板。Key 保存在容器的数据卷中。</p>
<form><label for="key">DeepSeek API Key</label><input id="key" name="key" type="password" autocomplete="off" required placeholder="sk-…"><button>保存并打开面板</button></form><p id="error" role="alert"></p>
<script>document.querySelector('form').onsubmit=async e=>{e.preventDefault();const button=document.querySelector('button');button.disabled=true;try{const r=await fetch('${basePath}setup',{method:'POST',headers:{'Content-Type':'application/json','X-Siliconcode-Token':new URLSearchParams(location.search).get('token')},body:JSON.stringify({apiKey:document.querySelector('#key').value})});if(!r.ok)throw new Error((await r.json()).error);document.querySelector('#key').value='';button.textContent='正在启动面板…';const poll=setInterval(async()=>{try{const r=await fetch(location.href);if(r.ok&&(await r.text()).includes('name="siliconcode-token"')){clearInterval(poll);location.reload()}}catch{}},1500)}catch(err){document.querySelector('#error').textContent=err.message;button.disabled=false}};</script></html>`;

const activeProvider = config.modelProviders?.find?.(p => p.id === (config.activeModelProviderId || "deepseek"));
const configuredKey = Array.isArray(config.modelProviders) ? activeProvider?.apiKey : config.apiKey;
if (process.env.DEEPSEEK_API_KEY?.trim() || configuredKey?.trim()) {
  startAgent();
} else {
  setupServer = createServer(async (req, res) => {
    const url = new URL(req.url || "/", "http://localhost");
    if (basePath !== "/" && url.pathname === basePath.slice(0, -1)) {
      res.writeHead(308, { location: `${basePath}${url.search}` }); res.end(); return;
    }
    if (!url.pathname.startsWith(basePath)) { res.writeHead(404); res.end("not found"); return; }
    const path = `/${url.pathname.slice(basePath.length)}`;
    const mutation = req.method === "POST";
    const credential = mutation ? req.headers["x-siliconcode-token"] : url.searchParams.get("token");
    if (!authorized(credential)) { res.writeHead(401); res.end("请使用容器日志中的完整 token 链接访问。"); return; }
    if (req.method === "GET" && path === "/") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
      res.end(setupHtml);
      return;
    }
    if (mutation && path === "/setup") {
      try {
        let body = "";
        for await (const chunk of req) {
          body += chunk;
          if (Buffer.byteLength(body) > 8192) throw new Error("配置请求过大");
        }
        const apiKey = JSON.parse(body).apiKey;
        if (typeof apiKey !== "string" || !apiKey.trim() || apiKey.length > 4096) throw new Error("请填写有效的 API Key");
        const saved = readConfig();
        // A provider registry takes precedence over the legacy apiKey field.
        if (Array.isArray(saved.modelProviders)) {
          saved.modelProviders = saved.modelProviders.filter(p => p.id !== "deepseek");
          saved.modelProviders.push({ id: "deepseek", kind: "deepseek", name: "DeepSeek", apiKey: apiKey.trim() });
          saved.activeModelProviderId = "deepseek";
        }
        saveConfig({ ...saved, apiKey: apiKey.trim(), lang: "zh-CN", setupCompleted: true });
        res.writeHead(200, { "content-type": "application/json" });
        res.end('{"ok":true}');
        setupServer.close(() => startAgent());
        setupServer.closeIdleConnections();
      } catch (error) {
        res.writeHead(400, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: error.message }));
      }
      return;
    }
    res.writeHead(404); res.end("not found");
  });
  setupServer.listen(port, host, () => console.log("首次启动配置页已就绪，请在浏览器填写 API Key。"));
}
