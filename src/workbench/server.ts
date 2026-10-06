import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { type IncomingMessage, type ServerResponse, createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { isAbsolute, join, relative } from "node:path";
import { z } from "zod";
import {
  loadActiveModelProvider,
  loadModelProviderSources,
  loadModelProviders,
  saveModelProvider,
} from "../config.js";
import { probeOpenAICompatibleProvider } from "../provider-probe.js";
import { serveWorkbenchAsset } from "../server/assets.js";
import { getBasePath, routeUnderBase } from "../server/base-path.js";
import { readBody } from "../server/index.js";
import { WorkbenchAuth } from "./auth.js";
import { exportWorkbench } from "./backup.js";
import { browseDirectories, chooseNativeDirectory } from "./directories.js";
import { streamTaskEvents } from "./event-stream.js";
import { WorkbenchPreviews } from "./previews.js";
import { type RuntimeOptions, WorkbenchRuntime } from "./runtime.js";
import { WorkbenchError, WorkbenchStore } from "./store.js";
import {
  createWorkbenchWorkspace,
  mergeWorkbenchWorkspace,
  reviewWorkbenchWorkspace,
} from "./workspaces.js";

const cookieName = "siliconcode_session";
const credentials = z.object({ username: z.string().max(120), password: z.string().max(1024) });
const id = z.string().uuid();
const str = z.string().trim().min(1);
const loopback = new Set(["localhost", "127.0.0.1", "::1"]);
function token(req: IncomingMessage): string {
  return (
    (req.headers.cookie ?? "")
      .split(";")
      .map((c) => c.trim())
      .find((c) => c.startsWith(`${cookieName}=`))
      ?.slice(cookieName.length + 1) ?? ""
  );
}
function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}
function acquireLock(dataDir: string): () => void {
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const path = join(dataDir, "server.lock");
  const value = { pid: process.pid, token: randomUUID() };
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      writeFileSync(path, JSON.stringify(value), { flag: "wx", mode: 0o600 });
      return () => {
        try {
          if (JSON.parse(readFileSync(path, "utf8")).token === value.token) unlinkSync(path);
        } catch {
          /* already removed */
        }
      };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
      const existing = JSON.parse(readFileSync(path, "utf8")) as { pid: number };
      try {
        process.kill(existing.pid, 0);
      } catch (probe) {
        if ((probe as NodeJS.ErrnoException).code === "ESRCH") {
          unlinkSync(path);
          continue;
        }
      }
      throw new Error("此数据目录已有工作台服务运行；请使用原服务或另选 --data-dir");
    }
  }
  throw new Error("无法获取工作台数据锁");
}

export interface WorkbenchServerOptions extends RuntimeOptions {
  dataDir: string;
  host?: string;
  port?: number;
  /** Required HTTPS public origin when listening beyond loopback (TLS terminates at a reverse proxy). */
  origin?: string;
  probeFetch?: typeof fetch;
}

export async function startWorkbenchServer(options: WorkbenchServerOptions) {
  const basePath = getBasePath();
  const host = options.host ?? "127.0.0.1";
  if (!loopback.has(host) && (!options.origin || new URL(options.origin).protocol !== "https:")) {
    throw new Error("远程访问需要 HTTPS 反向代理，并通过 --origin 指定外部 HTTPS 地址");
  }
  const unlock = acquireLock(options.dataDir);
  let store: WorkbenchStore;
  let auth: WorkbenchAuth;
  let runtime: WorkbenchRuntime;
  try {
    store = new WorkbenchStore(options.dataDir);
    auth = new WorkbenchAuth(options.dataDir);
    runtime = new WorkbenchRuntime(store, options);
  } catch (err) {
    unlock();
    throw err;
  }
  let origin = options.origin ? new URL(options.origin).origin : "";
  const previews = new WorkbenchPreviews(store);
  const overlaps = (a: string, b: string) => {
    const rel = relative(a, b);
    return (
      rel === "" ||
      (rel !== ".." &&
        !rel.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) &&
        !isAbsolute(rel))
    );
  };
  const assertIdle = (owner: string, projectId: string, includeRepository = false) => {
    const project = store.project(owner, projectId);
    const root = includeRepository
      ? (project.workspace?.repositoryRoot ?? project.workdir)
      : project.workdir;
    for (const other of store.listProjects(owner)) {
      const otherRoot = includeRepository
        ? (other.workspace?.repositoryRoot ?? other.workdir)
        : other.workdir;
      if (
        (overlaps(root, otherRoot) || overlaps(otherRoot, root)) &&
        (runtime.isBusy(other.id) || previews.isBusy(other.id))
      )
        throw new WorkbenchError(409, "相关项目仍有任务或预览运行，请先停止后重试");
    }
  };
  const connections = new Set<ServerResponse>();
  const nativePicker = process.platform === "darwin" && loopback.has(host) && !options.origin;
  let pickerAbort: AbortController | undefined;
  let exporting = false;
  const server = createServer((req, res) => {
    res.setHeader("cache-control", "no-store");
    res.setHeader("x-content-type-options", "nosniff");
    res.setHeader("referrer-policy", "no-referrer");
    res.setHeader(
      "content-security-policy",
      "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
    );
    handle(req, res).catch((err) => {
      if (res.headersSent) {
        res.end();
        return;
      }
      json(
        res,
        err instanceof WorkbenchError ? err.status : err instanceof z.ZodError ? 400 : 500,
        { error: err instanceof z.ZodError ? "请求字段不正确" : (err as Error).message },
      );
    });
  });
  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "/", origin);
    const method = req.method ?? "GET";
    if (req.headers.host !== new URL(origin).host)
      throw new WorkbenchError(403, "Host 不匹配，请使用服务公布的地址");
    const mutation = !["GET", "HEAD"].includes(method);
    if (mutation && req.headers.origin && req.headers.origin !== origin)
      throw new WorkbenchError(403, "跨站请求被拒绝");
    const path = routeUnderBase(url, res, basePath);
    if (path === null) return;
    if (path === "/" || path.startsWith("/assets/")) {
      const asset = serveWorkbenchAsset(path === "/" ? "index.html" : path.slice(8), basePath);
      if (!asset || method !== "GET") throw new WorkbenchError(404, "资源不存在");
      res.writeHead(200, { "content-type": asset.contentType });
      res.end(asset.body);
      return;
    }
    let body: unknown = {};
    if (mutation) {
      if (!req.headers["content-type"]?.startsWith("application/json"))
        throw new WorkbenchError(415, "需要 application/json 请求");
      try {
        body = JSON.parse(await readBody(req));
      } catch {
        throw new WorkbenchError(400, "无效或过大的 JSON 请求");
      }
    }
    if (path === "/api/auth/status" && method === "GET") {
      json(res, 200, { needsSetup: auth.needsSetup });
      return;
    }
    if (path === "/api/auth/setup" && method === "POST") {
      const data = credentials.extend({ setupToken: str }).parse(body);
      await auth.setup(data.setupToken, data.username, data.password);
      json(res, 201, { ok: true });
      return;
    }
    if (path === "/api/auth/login" && method === "POST") {
      const data = credentials.parse(body);
      const login = await auth.login(
        data.username,
        data.password,
        req.socket.remoteAddress ?? "local",
      );
      res.setHeader(
        "set-cookie",
        `${cookieName}=${login.token}; HttpOnly; SameSite=Strict; Path=${basePath}; Max-Age=43200${origin.startsWith("https:") ? "; Secure" : ""}`,
      );
      json(res, 200, login.session);
      return;
    }
    const session = auth.session(token(req));
    if (!session) throw new WorkbenchError(401, "请先登录");
    if (mutation) auth.checkCsrf(session, String(req.headers["x-siliconcode-csrf"] ?? ""));
    if (exporting && mutation) throw new WorkbenchError(409, "正在导出备份，请稍后再修改数据");
    const user = session.userId;
    if (path === "/api/backup" && method === "GET") {
      if (exporting || store.listProjects(user).some((project) => runtime.isBusy(project.id)))
        throw new WorkbenchError(409, "请等待任务结束后再导出备份");
      exporting = true;
      try {
        res.writeHead(200, {
          "content-type": "application/gzip",
          "content-disposition": 'attachment; filename="siliconcode-workbench.scwb.gz"',
        });
        await exportWorkbench(options.dataDir, res);
      } finally {
        exporting = false;
      }
      return;
    }
    if (path === "/api/settings") {
      if (method === "GET") json(res, 200, store.settings());
      else if (method === "PUT") json(res, 200, store.saveSettings(body));
      else throw new WorkbenchError(405, "仅支持 GET/PUT");
      return;
    }
    if (path === "/api/provider/probe" && method === "POST") {
      const provider = loadActiveModelProvider(options.configPath);
      const result = await probeOpenAICompatibleProvider({
        baseUrl: provider.baseUrl,
        apiKey: provider.apiKey,
        fetch: options.probeFetch,
        timeoutMs: 15_000,
      });
      json(res, 200, {
        ...result,
        selectedModel: provider.model,
        modelListed: result.ok ? result.models.includes(provider.model ?? "") : false,
        sources: loadModelProviderSources(options.configPath),
      });
      return;
    }
    if (path === "/api/directories" && method === "GET") {
      json(res, 200, {
        ...(await browseDirectories(store, url.searchParams.get("path") || undefined)),
        nativePicker,
      });
      return;
    }
    if (path === "/api/directories/choose" && method === "POST") {
      if (!nativePicker) throw new WorkbenchError(400, "当前环境请使用目录列表选择项目");
      if (pickerAbort) throw new WorkbenchError(409, "已有文件夹选择窗口，请先完成或取消");
      pickerAbort = new AbortController();
      try {
        const selected = await chooseNativeDirectory(pickerAbort.signal);
        json(res, 200, { path: selected ? store.validateProjectDirectory(selected) : null });
      } finally {
        pickerAbort = undefined;
      }
      return;
    }
    if (path === "/api/auth/me" && method === "GET") {
      json(res, 200, session);
      return;
    }
    if (path === "/api/auth/logout" && method === "POST") {
      auth.logout(token(req));
      res.setHeader(
        "set-cookie",
        `${cookieName}=; HttpOnly; SameSite=Strict; Path=${basePath}; Max-Age=0`,
      );
      json(res, 200, { ok: true });
      return;
    }
    if (path === "/api/auth/password" && method === "POST") {
      const data = z
        .object({ oldPassword: z.string().max(1024), password: z.string().max(1024) })
        .parse(body);
      await auth.changePassword(session, data.oldPassword, data.password);
      json(res, 200, { ok: true });
      return;
    }
    if (path === "/api/provider") {
      if (method === "PUT") {
        const data = z
          .object({
            apiKey: str.min(16).optional(),
            baseUrl: z.url().refine((s) => ["https:", "http:"].includes(new URL(s).protocol)),
            model: str.max(200),
          })
          .parse(body);
        const previous = loadActiveModelProvider(options.configPath);
        const stored = loadModelProviders(options.configPath, {}).find((p) => p.id === previous.id);
        saveModelProvider(
          {
            ...previous,
            apiKey: data.apiKey ?? stored?.apiKey,
            baseUrl: data.baseUrl,
            model: data.model,
          },
          options.configPath,
        );
      } else if (method !== "GET") throw new WorkbenchError(405, "仅支持 GET/PUT");
      const p = loadActiveModelProvider(options.configPath);
      json(res, 200, {
        model: p.model,
        baseUrl: p.baseUrl,
        apiKeySet: Boolean(p.apiKey),
        name: p.name,
        sources: loadModelProviderSources(options.configPath),
      });
      return;
    }
    if (path === "/api/projects") {
      if (method === "GET") {
        json(res, 200, store.listProjects(user));
        return;
      }
      if (method === "POST") {
        const data = z.object({ workdir: str, name: str.optional() }).parse(body);
        json(res, 201, store.addProject(user, data.workdir, data.name));
        return;
      }
    }
    const workspaceRoute =
      /^\/api\/projects\/([^/]+)\/(workspace|workspace-review|workspace-merge|preview|preview-stop)$/.exec(
        path,
      );
    if (workspaceRoute) {
      const projectId = id.parse(workspaceRoute[1]);
      store.project(user, projectId);
      const operation = workspaceRoute[2];
      if (operation === "workspace" && method === "POST") {
        z.object({ authorize: z.literal(true) }).parse(body);
        assertIdle(user, projectId, true);
        json(res, 201, createWorkbenchWorkspace(store, user, projectId));
        return;
      }
      if (operation === "workspace-review" && method === "GET") {
        assertIdle(user, projectId, true);
        json(res, 200, reviewWorkbenchWorkspace(store, user, projectId));
        return;
      }
      if (operation === "workspace-merge" && method === "POST") {
        const data = z
          .object({
            authorize: z.literal(true),
            tree: str.regex(/^[a-f0-9]{40,64}$/),
            targetHead: str.regex(/^[a-f0-9]{40,64}$/),
          })
          .parse(body);
        assertIdle(user, projectId, true);
        json(res, 200, mergeWorkbenchWorkspace(store, user, projectId, data));
        return;
      }
      if (operation === "preview" && method === "GET") {
        json(res, 200, {
          process: previews.get(user, projectId),
          localAccess: nativePicker || (loopback.has(host) && !options.origin),
        });
        return;
      }
      if (operation === "preview" && method === "POST") {
        const data = z
          .object({ authorize: z.literal(true), command: str.max(4000), url: str.max(2048) })
          .parse(body);
        assertIdle(user, projectId);
        json(res, 202, await previews.start(user, projectId, data.command, data.url));
        return;
      }
      if (operation === "preview-stop" && method === "POST") {
        json(res, 200, await previews.stop(user, projectId));
        return;
      }
      throw new WorkbenchError(405, "请求方法不支持");
    }
    const projectRoute = /^\/api\/projects\/([^/]+)\/(versions|tasks|activity)$/.exec(path);
    if (projectRoute) {
      const projectId = id.parse(projectRoute[1]);
      if (projectRoute[2] === "activity" && method === "GET") {
        json(res, 200, runtime.activity(user, projectId));
        return;
      }
      if (projectRoute[2] === "tasks" && method === "GET") {
        json(res, 200, runtime.list(user, projectId));
        return;
      }
      if (projectRoute[2] === "versions") {
        if (method === "GET") {
          json(res, 200, store.listVersions(user, projectId));
          return;
        }
        if (method === "POST") {
          const data = z
            .object({ label: str, requirement: str, parentId: id.optional() })
            .parse(body);
          json(res, 201, store.createVersion(user, projectId, data));
          return;
        }
      }
    }
    const versionRoute =
      /^\/api\/projects\/([^/]+)\/versions\/([^/]+)\/(chat|confirm|develop|metadata)$/.exec(path);
    if (versionRoute && method === "POST") {
      const projectId = id.parse(versionRoute[1]);
      const versionId = id.parse(versionRoute[2]);
      if (versionRoute[3] === "metadata") {
        const data = z
          .object({ title: str.max(120).optional(), archived: z.boolean().optional() })
          .parse(body);
        if (
          data.archived &&
          runtime
            .activity(user, projectId)
            .some(
              (task) =>
                ["running", "waiting_for_approval"].includes(task.status) &&
                runtime.get(user, task.id).versionId === versionId,
            )
        )
          throw new WorkbenchError(409, "请先停止此任务，再归档");
        json(res, 200, store.updateVersionMetadata(user, projectId, versionId, data));
        return;
      }
      if (store.version(user, projectId, versionId).archivedAt)
        throw new WorkbenchError(409, "请先恢复已归档的任务，再继续操作");
      if (versionRoute[3] === "confirm") {
        if (runtime.isBusy(projectId))
          throw new WorkbenchError(409, "请等待当前任务完成后确认文档");
        const data = z.object({ revision: z.number().int().positive() }).parse(body);
        json(res, 200, store.confirm(user, projectId, versionId, data.revision));
        return;
      }
      if (versionRoute[3] === "develop") {
        assertIdle(user, projectId);
        const data = z
          .object({
            revision: z.number().int().positive(),
            authorizeChecks: z.literal(true),
            resumesTaskId: id.optional(),
          })
          .parse(body);
        const version = store.version(user, projectId, versionId);
        if (version.confirmed?.revision !== data.revision)
          throw new WorkbenchError(409, "文档修订不匹配");
        json(
          res,
          202,
          runtime.start(user, projectId, versionId, "develop", "", data.resumesTaskId),
        );
        return;
      }
      const data = z.object({ text: str.max(100_000) }).parse(body);
      assertIdle(user, projectId);
      json(res, 202, runtime.start(user, projectId, versionId, "clarify", data.text));
      return;
    }
    const taskRoute = /^\/api\/tasks\/([^/]+)(?:\/(events|cancel|approval))?$/.exec(path);
    if (taskRoute) {
      const taskId = id.parse(taskRoute[1]);
      if (!taskRoute[2] && method === "GET") {
        json(res, 200, runtime.get(user, taskId));
        return;
      }
      if (taskRoute[2] === "cancel" && method === "POST") {
        runtime.cancel(user, taskId);
        json(res, 200, { ok: true });
        return;
      }
      if (taskRoute[2] === "approval" && method === "POST") {
        const data = z
          .object({ approvalId: z.number().int().nonnegative(), allow: z.boolean() })
          .parse(body);
        runtime.approve(user, taskId, data.approvalId, data.allow);
        json(res, 200, { ok: true });
        return;
      }
      if (taskRoute[2] === "events" && method === "GET") {
        const after = Number(req.headers["last-event-id"] ?? url.searchParams.get("after") ?? 0);
        if (!Number.isSafeInteger(after) || after < 0)
          throw new WorkbenchError(400, "无效事件序号");
        runtime.get(user, taskId);
        res.writeHead(200, {
          "content-type": "text/event-stream",
          connection: "keep-alive",
          "x-accel-buffering": "no",
        });
        connections.add(res);
        streamTaskEvents(res, {
          after,
          history: (signal) => runtime.replayEvents(user, taskId, after, signal),
          subscribe: (listener) => runtime.subscribe(user, taskId, listener),
          authenticated: () => Boolean(auth.session(token(req))),
          onClose: () => connections.delete(res),
        });
        return;
      }
    }
    throw new WorkbenchError(404, "接口不存在");
  }
  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(options.port ?? 3000, host, () => {
        if (!origin)
          origin = `http://${host.includes(":") ? `[${host}]` : host}:${(server.address() as AddressInfo).port}`;
        resolve();
      });
    });
  } catch (err) {
    unlock();
    throw err;
  }
  let closing: Promise<void> | undefined;
  return {
    url: basePath === "/" ? origin : `${origin}${basePath.slice(0, -1)}`,
    auth,
    runtime,
    previews,
    store,
    close(): Promise<void> {
      closing ??= (async () => {
        pickerAbort?.abort();
        const stopped = new Promise<void>((resolve) => server.close(() => resolve()));
        for (const res of connections) res.end();
        await Promise.all([runtime.close(), previews.close()]);
        server.closeAllConnections();
        await stopped;
        unlock();
      })();
      return closing;
    },
  };
}
