import htm from "htm";
import { type ComponentChildren, h } from "preact";
import { useCallback, useEffect, useMemo, useRef, useState } from "preact/hooks";
import { ExecutionResultSummary } from "./execution-result-summary.js";
import { workbenchResult } from "./lib/execution-result.js";
import {
  type WorkbenchEvent,
  diffCounts,
  renderWorkbenchMarkdown,
  visibleEvents,
} from "./lib/workbench-view.js";

export const html = htm.bind(h);
export type Api = (path: string, method?: string, body?: unknown) => Promise<any>;
export interface Project {
  id: string;
  name: string;
  workdir: string;
  workspace?: { parentProjectId: string; repositoryRoot: string; branch: string; baseCommit: string; mergedCommit?: string };
}
export interface Draft {
  revision: number;
  prd: string;
  sdd: string;
  acceptance: string[];
  questions: string[];
  checks: Array<{ kind: string; command: string; timeoutSec: number }>;
}
export interface Version {
  id: string;
  label: string;
  requirement: string;
  title?: string;
  archivedAt?: string;
  parentId?: string;
  confirmed?: { revision: number };
  revisions: Draft[];
  dialogue: Array<{ role: string; text: string; taskId?: string }>;
}
export interface Task {
  id: string;
  projectId: string;
  versionId: string;
  resumesTaskId?: string;
  kind: string;
  status: string;
  phase: string;
  updatedAt: string;
  error?: string;
  attempt: number;
  verifiedFingerprint?: string;
  limits?: { budgetUsd: number | null; maxTokens: number | null };
  usage?: {
    inputTokens: number;
    outputTokens: number;
    cachedTokens: number;
    reportedRequests: number;
    unreportedRequests: number;
    estimatedCostUsd: number | null;
    models: string[];
  };
  approval?: { id: number; payload: { command?: string; cwd?: string; timeoutSec?: number } };
  reviews: Array<{ attempt: number; summary: string; findings: string[]; fingerprint?: string }>;
  checks: Array<{
    attempt: number;
    command: string;
    kind: string;
    exitCode: number | null;
    timedOut: boolean;
    output: string;
    fingerprint?: string;
  }>;
  baseline?: { status: string; diff: string };
  changes?: { status: string; diff: string };
  changesError?: string;
}
export const statusNames: Record<string, string> = {
  running: "进行中",
  waiting_for_approval: "等待审批",
  completed: "已完成",
  failed: "执行失败",
  interrupted: "已停止",
};
export const phaseNames: Record<string, string> = {
  clarify: "需求分析",
  develop: "编写代码",
  development: "编写代码",
  review: "独立审查",
  validation: "测试与打包",
  completed: "已完成",
};
export const activeTask = (task?: Task | null) =>
  Boolean(task && ["running", "waiting_for_approval"].includes(task.status));
const paths: Record<string, string> = {
  brand: "M8 5 2 12l6 7M16 5l6 7-6 7M14 4l-4 16",
  folder: "M3 7V5a1 1 0 0 1 1-1h5l2 3h9a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V7Z",
  plus: "M12 5v14M5 12h14",
  chevron: "m9 5 7 7-7 7",
  down: "m6 9 6 6 6-6",
  back: "m14 5-7 7 7 7",
  up: "m5 12 7-7 7 7M12 5v15",
  close: "m6 6 12 12M6 18 18 6",
  check: "m5 12 4 4L19 6",
  search: "M10 17a7 7 0 1 0 0-14 7 7 0 0 0 0 14ZM15 15l6 6",
  panel: "M3 4h18v16H3ZM15 4v16",
  sidebar: "M3 4h18v16H3ZM9 4v16",
  edit: "m4 16-1 5 5-1L21 7l-4-4L4 16Zm11-11 4 4",
  file: "M14 3H5v18h14V8l-5-5ZM14 3v5h5M8 12h8M8 16h6",
  terminal: "m5 7 5 5-5 5M12 17h7",
  stop: "M6 6h12v12H6Z",
  clock: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18ZM12 7v5l3 2",
  refresh: "M20 7a9 9 0 1 0 0 10M20 3v5h-5",
  settings:
    "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8ZM9 3h6l1 3 3 1 2 5-2 5-3 1-1 3H9l-1-3-3-1-2-5 2-5 3-1 1-3Z",
  sun: "M12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10ZM12 1v2M12 21v2M1 12h2M21 12h2M4 4l2 2M18 18l2 2M4 20l2-2M18 6l2-2",
  moon: "M20 14A9 9 0 0 1 10 3a9 9 0 1 0 10 11Z",
  monitor: "M3 4h18v13H3ZM12 17v4M8 21h8",
  logout: "M10 4H4v16h6M9 12h12m-4-4 4 4-4 4",
  home: "m3 10 9-7 9 7M5 9v12h14V9M9 21v-7h6v7",
  copy: "M8 8h13v13H8ZM16 5V2H2v14h3",
  bolt: "m13 2-9 12h7l-1 8 10-13h-8l1-7Z",
  branch:
    "M6 3v13a3 3 0 1 0 3 3 3 3 0 0 0-3-3M6 6a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM18 3a3 3 0 1 0 0 6 3 3 0 0 0 0-6ZM18 9c0 5-5 5-12 5",
};
export function Icon({ name, size = 18 }: { name: string; size?: number }) {
  return html`<svg width=${size} height=${size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d=${paths[name] || paths.file} /></svg>`;
}
export function Markdown({ text, className = "" }: { text: string; className?: string }) {
  const content = useMemo(() => renderWorkbenchMarkdown(text), [text]);
  return html`<div class=${`markdown ${className}`} dangerouslySetInnerHTML=${{ __html: content }} />`;
}
export function Status({ task }: { task: Task }) {
  return html`<span class=${`status-badge ${task.status}`}><span class="status-dot" />${statusNames[task.status] || task.status}</span>`;
}
export function Modal({
  title,
  onClose,
  children,
  className = "",
}: { title: string; onClose: () => void; children?: ComponentChildren; className?: string }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    ref.current?.showModal();
    return () => {
      ref.current?.close();
      previous?.focus();
    };
  }, []);
  return html`<dialog ref=${ref} class=${`modal ${className}`} aria-label=${title} onCancel=${(
    event: Event,
  ) => {
    event.preventDefault();
    onClose();
  }} onClick=${(event: MouseEvent) => {
    if (event.target === ref.current) onClose();
  }}>
    <header class="modal-heading"><h2>${title}</h2><button type="button" class="icon-button" aria-label="关闭窗口" onClick=${onClose}><${Icon} name="close" /></button></header>${children}</dialog>`;
}

interface DirectoryListing {
  path: string;
  name: string;
  parent: string | null;
  home: string;
  nativePicker: boolean;
  selectable: boolean;
  reason: string;
  truncated: boolean;
  directories: Array<{ name: string; path: string }>;
}
export function FolderPicker({
  api,
  initial,
  projects,
  onChoose,
  onClose,
}: {
  api: Api;
  initial?: string;
  projects: Project[];
  onChoose: (path: string) => Promise<void>;
  onClose: () => void;
}) {
  const [listing, setListing] = useState<DirectoryListing | null>(null);
  const [path, setPath] = useState(initial || "");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<{ name: string; path: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [nativeBusy, setNativeBusy] = useState(false);
  const [error, setError] = useState("");
  const request = useRef(0);
  const load = useCallback(
    async (next?: string) => {
      const current = ++request.current;
      setBusy(true);
      setError("");
      setSelected(null);
      setListing(null);
      try {
        const value = await api(`/directories${next ? `?path=${encodeURIComponent(next)}` : ""}`);
        if (request.current !== current) return;
        setListing(value);
        setPath(value.path);
        setQuery("");
      } catch (err) {
        if (request.current === current) setError((err as Error).message);
      } finally {
        if (request.current === current) setBusy(false);
      }
    },
    [api],
  );
  useEffect(() => {
    void load(initial);
    return () => {
      request.current++;
    };
  }, [initial, load]);
  async function choose(value: string) {
    setBusy(true);
    setError("");
    try {
      await onChoose(value);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return html`<${Modal} title="打开项目文件夹" className="folder-modal" onClose=${() => {
    if (!nativeBusy) onClose();
  }}>
    <div class="folder-toolbar"><button class="icon-button" aria-label="上一级目录" disabled=${busy || !listing?.parent} onClick=${() => void load(listing!.parent!)}><${Icon} name="up" /></button><form onSubmit=${(
      e: SubmitEvent,
    ) => {
      e.preventDefault();
      void load(path);
    }}><label class="sr-only" for="folder-path">文件夹路径</label><input id="folder-path" value=${path} onInput=${(e: any) => setPath(e.target.value)} placeholder="前往文件夹…" /><button class="icon-button" aria-label="前往目录" disabled=${busy}><${Icon} name="chevron" /></button></form></div>
    <div class="folder-browser"><nav class="folder-places" aria-label="常用位置"><span class="section-label">位置</span><button disabled=${busy} onClick=${() => void load()}><${Icon} name="home" />个人目录</button>${projects.slice(0, 6).map((p) => html`<button title=${p.workdir} disabled=${busy} onClick=${() => void load(p.workdir)}><${Icon} name="folder" /><span>${p.name}</span></button>`)}</nav>
    <section class="folder-content"><div class="folder-search"><${Icon} name="search" /><input aria-label="筛选文件夹" placeholder="筛选文件夹" value=${query} onInput=${(e: any) => setQuery(e.target.value)} /></div>
    ${error && html`<p role="alert" class="alert error">${error}</p>`}<div class="folder-list" aria-label="文件夹列表" aria-busy=${busy}>
    ${busy ? html`<div class="empty-inline"><span class="spinner" />正在读取文件夹…</div>` : listing?.directories.filter((entry) => entry.name.toLocaleLowerCase().includes(query.toLocaleLowerCase())).map((entry) => html`<div class=${`folder-row ${selected?.path === entry.path ? "selected" : ""}`}><button class="folder-entry" aria-pressed=${selected?.path === entry.path} onClick=${() => setSelected(entry)} onDblClick=${() => void load(entry.path)}><${Icon} name="folder" size=${20} /><span>${entry.name}</span></button><button class="icon-button" aria-label=${`打开 ${entry.name}`} onClick=${() => void load(entry.path)}><${Icon} name="chevron" size=${15} /></button></div>`)}
    ${!busy && listing && !listing.directories.some((entry) => entry.name.toLocaleLowerCase().includes(query.toLocaleLowerCase())) && html`<div class="empty-inline">${query ? "没有匹配的文件夹" : "此文件夹中没有子目录"}</div>`}</div>
    ${listing?.truncated && html`<p class="hint">仅显示前 1,000 个目录，可输入完整路径直接前往。</p>`}</section></div>
    <footer class="folder-footer"><div class="folder-selection"><strong>${selected?.name || listing?.name || "选择文件夹"}</strong><span>${selected?.path || listing?.path || "选择项目所在的文件夹"}</span></div>
    ${!selected && listing && !listing.selectable && html`<p class="hint">请选择具体的项目文件夹，不能使用整个个人目录或系统目录。</p>`}
    <div class="row between"><div>${
      listing?.nativePicker &&
      html`<button class="text-button" disabled=${busy || nativeBusy} onClick=${async () => {
        setNativeBusy(true);
        setError("");
        try {
          const result = await api("/directories/choose", "POST", {});
          if (result.path) await choose(result.path);
        } catch (err) {
          setError((err as Error).message);
        } finally {
          setNativeBusy(false);
        }
      }}><${Icon} name="monitor" />${nativeBusy ? "请在系统窗口中选择…" : "系统选择器…"}</button>`
    }</div><div class="row"><button onClick=${onClose} disabled=${nativeBusy}>取消</button><button class="primary" disabled=${busy || nativeBusy || (!selected && !listing?.selectable)} onClick=${() => void choose(selected?.path || listing!.path)}>打开此项目</button></div></div><p class="micro-hint">单击选择，双击进入文件夹。选择运行工作台的电脑上的目录。</p></footer>
  <//>`;
}

export function Evidence({ task }: { task: Task | null }) {
  if (!task)
    return html`<div class="panel-empty"><${Icon} name="check" size=${28} /><h3>每一步，都有依据</h3><p>开始开发后，在这里查看独立审查、测试和打包结果。</p></div>`;
  const latest = task.reviews.at(-1);
  const checks = task.checks.filter((check) => check.attempt === task.attempt);
  const passes = checks.filter((check) => check.exitCode === 0 && !check.timedOut).length;
  return html`<div class="evidence-content"><${ExecutionResultSummary} result=${workbenchResult(task)} /><div class="evidence-summary"><${Status} task=${task} /><span>${task.attempt ? `第 ${task.attempt} 轮` : "需求分析"}</span></div>${task.error && html`<p class="alert error">${task.error}</p>`}
    <h3 class="section-title">本次执行用量</h3><div class="usage-summary"><p>${task.usage?.reportedRequests ? `输入 ${task.usage.inputTokens.toLocaleString()} / 输出 ${task.usage.outputTokens.toLocaleString()} Token，缓存命中 ${task.usage.cachedTokens.toLocaleString()}` : "尚未收到用量回执"}</p><p>${task.usage?.estimatedCostUsd != null ? `估算费用 $${task.usage.estimatedCostUsd.toFixed(6)} USD` : "费用未知（用量或价格信息不足）"}</p>${task.usage?.unreportedRequests ? html`<p class="hint">${task.usage.unreportedRequests} 次响应未返回完整用量，以上 Token 为已知部分。</p>` : null}<p class="hint">${task.usage?.models.join(" / ") || "等待模型响应"}${task.limits?.maxTokens ? ` · Token 上限 ${task.limits.maxTokens}` : ""}${task.limits?.budgetUsd ? ` · 费用上限 $${task.limits.budgetUsd}` : ""}</p></div>
    <h3 class="section-title">独立代码审查</h3>${latest ? html`<div class=${`review-verdict ${latest.findings.length ? "needs-work" : "passed"}`}><${Icon} name=${latest.findings.length ? "search" : "check"} /><strong>${latest.findings.length ? `发现 ${latest.findings.length} 个问题` : "审查无发现"}</strong><span>第 ${latest.attempt} 轮</span></div>${latest.findings.map((finding, i) => html`<div class="finding"><span>${i + 1}</span><${Markdown} text=${finding} /></div>`)}<details class="disclosure"><summary>审查说明</summary><${Markdown} text=${latest.summary} /></details>` : html`<p class="muted">${task.kind === "clarify" ? "确认文档并开始开发后执行。" : "等待独立审查结果。"}</p>`}
    <h3 class="section-title row between">测试与打包<span class="muted">${passes} / ${checks.length} 通过</span></h3>${checks.length ? checks.map((check) => html`<details class="check-result"><summary><span class=${`check-icon ${check.exitCode === 0 && !check.timedOut ? "passed" : "failed"}`}><${Icon} name=${check.exitCode === 0 ? "check" : "close"} size=${16} /></span><code>${check.command}</code><span class="check-code">${check.timedOut ? "超时" : `退出 ${check.exitCode ?? "—"}`}</span></summary><pre class="terminal-output">${check.output || "无输出"}</pre></details>`) : html`<p class="muted">服务执行命令后显示实际输出和退出码。</p>`}
    ${task.reviews.length > 1 && html`<details class="disclosure"><summary>查看之前 ${task.reviews.length - 1} 轮审查</summary>${task.reviews.slice(0, -1).map((review) => html`<h4>第 ${review.attempt} 轮</h4><${Markdown} text=${review.summary} />`)}</details>`}
  </div>`;
}
export function Changes({ task }: { task: Task | null }) {
  if (!task?.changes)
    return html`<div class="panel-empty"><${Icon} name="file" size=${28} /><h3>代码变更</h3><p>${task?.changesError || "编辑开始后，查看本次任务新增和修改的内容。"}</p></div>`;
  const counts = diffCounts(task.changes.diff);
  return html`<div class="changes-content"><div class="row between"><span>相对于任务开始时</span><span class="diff-stats"><b>+${counts.added}</b><i>−${counts.removed}</i></span></div>${task.changesError && html`<p class="alert error">${task.changesError}</p>`}<pre class="change-status">${task.changes.status}</pre><pre class="diff-view">${task.changes.diff.split("\n").map((line) => html`<span class=${line.startsWith("+") ? "diff-add" : line.startsWith("-") ? "diff-remove" : line.startsWith("@@") ? "diff-hunk" : ""}>${line || " "}${"\n"}</span>`)}</pre><details class="disclosure"><summary>任务开始时的工作区</summary><pre>${task.baseline?.status}\n${task.baseline?.diff}</pre></details></div>`;
}
export function Activity({ events }: { events: WorkbenchEvent[] }) {
  const visible = visibleEvents(events).slice(-60);
  return html`<details class="activity"><summary><${Icon} name="terminal" size=${15} />工具与运行记录<span>${visible.length ? `最近 ${visible.length} 条` : "等待执行"}</span></summary><div class="activity-list">${visible.map(
    (event) => {
      const data = event.data;
      let args: any = {};
      try {
        args = JSON.parse(data.toolArgs || "{}");
      } catch {
        /* partial arguments */
      }
      const label =
        data.toolName || { done: "回合结束", error: "执行错误" }[data.role as string] || event.type;
      return html`<details><summary><span class="activity-dot" /><strong>${label}</strong><span>${args.command || args.path || (data.elapsedMs !== undefined ? `${data.elapsedMs} ms` : "")}</span></summary><pre>${data.content || JSON.stringify(data, null, 2)}</pre></details>`;
    },
  )}</div></details>`;
}
