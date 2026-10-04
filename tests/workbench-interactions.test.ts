// @vitest-environment happy-dom
// Mount the actual app with deterministic HTTP/SSE fixtures; never access a running service.
import { h, render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Task, Version } from "../dashboard/src/workbench-components.js";
import { App } from "../dashboard/src/workbench.js";

const projects = [
  { id: "a", name: "Project A", workdir: "/fixture/a" },
  { id: "b", name: "Project B", workdir: "/fixture/b" },
];
let versions: Record<string, Version[]>;
let tasks: Record<string, Task[]>;
let requests: Array<{ path: string; method: string; body: Record<string, unknown> }>;
let container: HTMLDivElement;
let preview: {
  status: string;
  output: string;
  command: string;
  url: string;
  exitCode: number | null;
} | null;
class Events {
  static instances: Events[] = [];
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((message: { data: string }) => void) | null = null;
  closed = false;
  constructor(readonly url: string) {
    Events.instances.push(this);
  }
  close() {
    this.closed = true;
  }
}
function version(id: string, label: string, confirmed = false): Version {
  return {
    id,
    label,
    requirement: `Requirement ${id}`,
    confirmed: confirmed ? { revision: 1 } : undefined,
    revisions: [
      { revision: 1, prd: "PRD", sdd: "SDD", questions: [], acceptance: ["works"], checks: [] },
    ],
    dialogue: [],
  };
}
async function settle(ms = 50) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
  for (let i = 0; i < 5; i++)
    await act(async () => {
      await Promise.resolve();
    });
}
async function mount() {
  await act(() => {
    render(h(App, {}), container);
  });
  await settle();
}
async function click(text: string) {
  const button = [...container.querySelectorAll<HTMLButtonElement>("button")].find(
    (b) => b.textContent?.trim() === text,
  );
  expect(button, `Missing button ${text}`).toBeDefined();
  await act(() => {
    button!.click();
  });
  await settle();
}
async function input(selector: string, text: string) {
  const field = container.querySelector<HTMLInputElement>(selector)!;
  expect(field).toBeTruthy();
  await act(() => {
    field.value = text;
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await settle();
}
beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  Events.instances = [];
  container = document.createElement("div");
  document.body.append(container);
  localStorage.setItem("siliconcode.project", "a");
  localStorage.setItem("siliconcode.view.user.a", "va");
  versions = { a: [version("va", "1.0", true), version("vb", "2.0")], b: [] };
  tasks = { a: [], b: [] };
  preview = null;
  requests = [];
  vi.stubGlobal("EventSource", Events);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (path: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      const body = JSON.parse(String(init?.body ?? "{}"));
      requests.push({ path, method, body });
      const json = (value: unknown) => new Response(JSON.stringify(value), { status: 200 });
      if (path === "/api/auth/status") return json({ needsSetup: false });
      if (path === "/api/auth/me")
        return json({ userId: "user", username: "fixture", csrf: "fixture" });
      if (path === "/api/projects") return json(projects);
      if (path === "/api/provider")
        return json({
          model: "fixture-model",
          baseUrl: "https://fixture.invalid",
          apiKeySet: true,
        });
      if (path === "/api/settings") return json({ maxTokens: null, budgetUsd: null });
      if (path === "/api/projects/a/preview") {
        if (method === "POST") {
          preview = {
            status: "running",
            output: "fixture server ready",
            command: body.command,
            url: body.url,
            exitCode: null,
          };
          return json(preview);
        }
        return json({ process: preview, localAccess: true });
      }
      if (path === "/api/projects/a/preview-stop") {
        if (preview) preview.status = "exited";
        return json(preview);
      }
      const route =
        /^\/api\/projects\/([ab])\/(activity|tasks|versions)(?:\/([^/]+)\/(chat|metadata))?$/.exec(
          path,
        );
      if (route) {
        const project = route[1]!;
        if (route[2] === "activity")
          return json(
            tasks[project]!.map(({ id, status, updatedAt }) => ({ id, status, updatedAt })),
          );
        if (route[2] === "tasks") return json(tasks[project]);
        if (route[4] === "metadata") {
          const v = versions[project]!.find((v) => v.id === route[3])!;
          if (body.title) v.title = body.title;
          if (body.archived !== undefined)
            v.archivedAt = body.archived ? "fixture-date" : undefined;
          return json(v);
        }
        if (route[4] === "chat") {
          const task: Task = {
            id: "new-task",
            projectId: project,
            versionId: route[3]!,
            kind: "clarify",
            phase: "clarify",
            status: "completed",
            attempt: 0,
            updatedAt: "1",
            checks: [],
            reviews: [],
          };
          tasks[project]!.push(task);
          return json(task);
        }
        if (method === "POST") {
          const v = version(`new-${project}`, body.label);
          v.requirement = body.requirement;
          versions[project]!.push(v);
          return json(v);
        }
        return json(versions[project]);
      }
      throw new Error(`Unexpected fixture request ${method} ${path}`);
    }),
  );
});
afterEach(async () => {
  await act(() => {
    render(null, container);
  });
  container.remove();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("mounted workbench interactions", () => {
  it("requires command approval before starting a preview and displays logs and stop controls", async () => {
    await mount();
    await click("项目工具");
    await click("预览与日志");
    await input('dialog input[placeholder^="例如 npm"]', "npm run dev -- --host 127.0.0.1");
    const start = [...container.querySelectorAll<HTMLButtonElement>("button")].find(
      (b) => b.textContent === "启动预览",
    )!;
    expect(start.disabled).toBe(true);
    await act(() => {
      container.querySelector<HTMLInputElement>('dialog input[type="checkbox"]')!.click();
    });
    await settle();
    expect(start.disabled).toBe(false);
    await act(() => {
      container
        .querySelector("dialog form")!
        .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    await settle();
    expect(requests.find((r) => r.path.endsWith("/preview") && r.method === "POST")?.body).toEqual({
      authorize: true,
      command: "npm run dev -- --host 127.0.0.1",
      url: "http://127.0.0.1:5173/",
    });
    expect(container.querySelector('[aria-label="预览进程日志"]')?.textContent).toContain(
      "fixture server ready",
    );
    expect(container.querySelector<HTMLAnchorElement>('dialog a[target="_blank"]')?.href).toBe(
      "http://127.0.0.1:5173/",
    );
    await click("停止预览");
    expect(container.querySelector('dialog a[target="_blank"]')).toBeNull();
    expect(container.textContent).toContain("已退出");
  });
  it("preserves an upgrade draft across projects and remounts, and sends a new project without a foreign parent", async () => {
    await mount();
    await click("迭代新版本");
    await input("#message-input", "Draft for A");
    expect(
      container.querySelector<HTMLSelectElement>('select[aria-label="基于哪个历史版本"]')?.value,
    ).toBe("va");
    await click("Project B");
    await input("#message-input", "New requirement for B");
    expect(
      container.querySelector<HTMLSelectElement>('select[aria-label="基于哪个历史版本"]')?.value,
    ).toBe("");
    await act(() => {
      container
        .querySelector<HTMLFormElement>("form.composer")!
        .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    await settle();
    const created = requests.find(
      (r) => r.path === "/api/projects/b/versions" && r.method === "POST",
    )!;
    expect(created.body.requirement).toBe("New requirement for B");
    expect(created.body.parentId).toBeUndefined();
    await click("Project A");
    expect(container.querySelector<HTMLTextAreaElement>("#message-input")?.value).toBe(
      "Draft for A",
    );
    await act(() => {
      render(null, container);
    });
    await mount();
    expect(container.querySelector<HTMLTextAreaElement>("#message-input")?.value).toBe(
      "Draft for A",
    );
  });

  it("recovers project readiness while viewing another version without an SSE subscription to the running task", async () => {
    tasks.a = [
      {
        id: "running-b",
        projectId: "a",
        versionId: "vb",
        kind: "develop",
        status: "running",
        phase: "development",
        attempt: 1,
        updatedAt: "1",
        checks: [],
        reviews: [],
      },
    ];
    await mount();
    await click("迭代新版本");
    expect(Events.instances.some((e) => e.url.includes("running-b") && !e.closed)).toBe(false);
    expect(container.querySelector<HTMLTextAreaElement>("#message-input")?.disabled).toBe(true);
    tasks.a[0]!.status = "waiting_for_approval";
    tasks.a[0]!.updatedAt = "2";
    await settle(1600);
    expect(container.querySelector<HTMLTextAreaElement>("#message-input")?.disabled).toBe(true);
    tasks.a[0]!.status = "completed";
    tasks.a[0]!.updatedAt = "3";
    await settle(1600);
    expect(container.querySelector<HTMLTextAreaElement>("#message-input")?.disabled).toBe(false);
    await input("#message-input", "Ready again");
    expect(
      container.querySelector<HTMLButtonElement>('[aria-label="创建任务并开始分析"]')?.disabled,
    ).toBe(false);
  });

  it("renames, searches, archives and restores a task through its actual controls", async () => {
    await mount();
    await click("管理任务");
    await input('input[name="title"]', "Renamed task");
    await act(() => {
      container
        .querySelector<HTMLDialogElement>("dialog")!
        .querySelector("form")!
        .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    await settle();
    await input('input[aria-label="搜索当前项目任务"]', "Renamed");
    expect(container.querySelectorAll(".version-button")).toHaveLength(1);
    expect(container.querySelector(".version-title")?.textContent).toBe("Renamed task");
    await click("管理任务");
    await click("归档任务");
    expect(container.textContent).toContain("返回未归档任务");
    await click("管理任务");
    await click("恢复任务");
    expect(container.textContent).toContain("查看已归档任务");
    expect(versions.a[0]!.archivedAt).toBeUndefined();
  });
});
