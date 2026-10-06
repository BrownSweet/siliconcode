import { appUrl } from "./lib/base-path.js";
import { render } from "preact";
import { useCallback, useEffect, useMemo, useRef, useState } from "preact/hooks";
import {
  draftScope,
  newRequirementInput,
  readComposerDraft,
  useComposerDraft,
  watchProjectActivity,
} from "./lib/project-session.js";
import { type WorkbenchEvent, assistantOutput } from "./lib/workbench-view.js";
import { ProjectTools } from "./workbench-project-tools.js";
import {
  Activity,
  Changes,
  Evidence,
  FolderPicker,
  Icon,
  Markdown,
  Modal,
  type Project,
  Status,
  type Task,
  type Version,
  activeTask,
  html,
  phaseNames,
  statusNames,
} from "./workbench-components.js";

interface Session {
  userId: string;
  username: string;
  csrf: string;
}
interface Provider {
  model?: string;
  baseUrl: string;
  apiKeySet: boolean;
  sources?: { apiKey: string; baseUrl: string; model: string };
}
const field = (form: HTMLFormElement, name: string) => String(new FormData(form).get(name) ?? "");
const tabs = { prd: "需求", sdd: "设计", checks: "验收", review: "执行结果", changes: "变更" };

export function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [setup, setSetup] = useState(false);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState(localStorage.getItem("siliconcode.project") ?? "");
  const [versions, setVersions] = useState<Version[]>([]);
  const [versionId, setVersionId] = useState("");
  const [tasks, setTasks] = useState<Task[]>([]);
  const [task, setTask] = useState<Task | null>(null);
  const [events, setEvents] = useState<WorkbenchEvent[]>([]);
  const [connected, setConnected] = useState(true);
  const [tab, setTab] = useState<keyof typeof tabs>("prd");
  const [authorizationKey, setAuthorizationKey] = useState("");
  const [provider, setProvider] = useState<Provider | null>(null);
  const [limits, setLimits] = useState<{ budgetUsd: number | null; maxTokens: number | null }>({
    budgetUsd: null,
    maxTokens: null,
  });
  const [sidebar, setSidebar] = useState(false);
  const [panel, setPanel] = useState(window.matchMedia("(min-width: 1200px)").matches);
  const [folderOpen, setFolderOpen] = useState(false);
  const [projectTools, setProjectTools] = useState(false);
  const [settings, setSettings] = useState("");
  const [theme, setTheme] = useState(
    localStorage.getItem("siliconcode.theme") === "dark" ? "dark" : "light",
  );
  const [isNew, setIsNew] = useState(false);
  const composerProject = useRef(projectId);
  const projectRequest = useRef(0);
  const loadedProjectRef = useRef("");
  const [loadedProjectId, setLoadedProjectId] = useState("");
  const [projectFilter, setProjectFilter] = useState("");
  const [taskFilter, setTaskFilter] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [taskSettings, setTaskSettings] = useState(false);
  const projectRef = useRef(projectId);
  projectRef.current = projectId;
  const versionRef = useRef(versionId);
  versionRef.current = versionId;
  const taskRef = useRef(task?.id);
  taskRef.current = task?.id;
  const messagesRef = useRef<HTMLDivElement>(null);
  const followScroll = useRef(true);
  const version = versions.find((v) => v.id === versionId);
  const draft = version?.revisions.at(-1);
  const project = projects.find((p) => p.id === projectId);
  const busy = tasks.some(activeTask);
  const composingNew = isNew || !version;
  const composer = useComposerDraft(
    draftScope(session?.userId ?? "", projectId, composingNew ? "" : versionId),
    setError,
  );
  const { text, label, parentId } = composer.value;
  const setText = (text: string) => composer.update({ text });
  const setLabel = (label: string) => composer.update({ label });
  const setParentId = (parentId: string) => composer.update({ parentId });
  const currentAuthorizationKey = `${versionId}:${draft?.revision}`;
  const authorized = authorizationKey === currentAuthorizationKey;
  const selectedTasks = tasks.filter((t) => t.versionId === versionId);
  const visibleVersions = versions.filter(
    (v) =>
      Boolean(v.archivedAt) === showArchived &&
      `${v.title ?? ""} ${v.requirement} ${v.label}`
        .toLocaleLowerCase()
        .includes(taskFilter.toLocaleLowerCase()),
  );
  const progress = useMemo(() => assistantOutput(events), [events]);
  const visibleProgress =
    task &&
    progress &&
    (task.kind === "develop" ||
      !version?.dialogue.some((d) => d.taskId === task.id && d.role === "assistant"));

  const api = useCallback(
    async (path: string, method = "GET", body?: unknown): Promise<any> => {
      const res = await fetch(appUrl(`/api${path}`), {
        method,
        headers: { "content-type": "application/json", "x-siliconcode-csrf": session?.csrf ?? "" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const result = await res.json();
      if (!res.ok) {
        if (res.status === 401) setSession(null);
        throw new Error(result.error ?? `HTTP ${res.status}`);
      }
      return result;
    },
    [session?.csrf],
  );
  const action = useCallback(async (fn: () => Promise<void>) => {
    setPending(true);
    setError("");
    setNotice("");
    try {
      await fn();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setPending(false);
    }
  }, []);
  const reloadProject = useCallback(
    async (selected = projectId) => {
      if (!selected || !projects.some((p) => p.id === selected)) return;
      const request = ++projectRequest.current;
      const [vs, ts] = await Promise.all([
        api(`/projects/${selected}/versions`),
        api(`/projects/${selected}/tasks`),
      ]);
      if (selected !== projectRef.current || request !== projectRequest.current) return;
      setVersions(vs);
      setTasks(ts);
      const firstLoad = loadedProjectRef.current !== selected;
      let remembered = "";
      if (firstLoad) {
        remembered = localStorage.getItem(`siliconcode.view.${session?.userId}.${selected}`) ?? "";
        setIsNew(remembered === "new");
        setShowArchived(Boolean(vs.find((v: Version) => v.id === remembered)?.archivedAt));
        loadedProjectRef.current = selected;
      }
      setLoadedProjectId(selected);
      setVersionId((current) =>
        vs.some((v: Version) => v.id === (firstLoad ? remembered : current))
          ? firstLoad
            ? remembered
            : current
          : (vs.filter((v: Version) => !v.archivedAt).at(-1)?.id ?? ""),
      );
    },
    [projectId, projects, api, session?.userId],
  );
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("siliconcode.theme", theme);
  }, [theme]);
  useEffect(() => {
    void (async () => {
      try {
        setSetup((await (await fetch(appUrl("/api/auth/status"))).json()).needsSetup);
        const me = await fetch(appUrl("/api/auth/me"));
        if (me.ok) setSession(await me.json());
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setLoading(false);
      }
    })();
  }, []);
  useEffect(() => {
    if (!session) return;
    void action(async () => {
      const [ps, config, settings] = await Promise.all([
        api("/projects"),
        api("/provider"),
        api("/settings"),
      ]);
      setLimits(settings);
      setProjects(ps);
      setProvider(config);
      setProjectId((current) =>
        ps.some((p: Project) => p.id === current) ? current : (ps[0]?.id ?? ""),
      );
    });
  }, [session, api, action]);
  useEffect(() => {
    setVersions([]);
    setLoadedProjectId("");
    setTaskFilter("");
    setShowArchived(false);
    setTaskSettings(false);
    setTasks([]);
    setTask(null);
    setEvents([]);
    setAuthorizationKey("");
    setIsNew(false);
    composerProject.current = projectId;
    setTab("prd");
    localStorage.setItem("siliconcode.project", projectId);
    if (session && projectId)
      return watchProjectActivity({
        load: () => api(`/projects/${projectId}/activity`),
        changed: () => reloadProject(),
        error: (err) => setError(err.message),
      });
  }, [projectId, session, api, reloadProject]);
  useEffect(() => {
    if (session && loadedProjectId === projectId) {
      try {
        localStorage.setItem(
          `siliconcode.view.${session.userId}.${projectId}`,
          composingNew ? "new" : versionId,
        );
      } catch {
        /* Draft writes show a visible storage error when needed. */
      }
    }
  }, [session, loadedProjectId, projectId, composingNew, versionId]);
  useEffect(() => {
    setTask((current) =>
      current?.versionId === versionId
        ? (tasks.find((t) => t.id === current.id) ?? current)
        : (tasks.filter((t) => t.versionId === versionId).at(-1) ?? null),
    );
  }, [versionId, tasks]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: Reset scroll-following when the selected conversation changes.
  useEffect(() => {
    followScroll.current = true;
  }, [versionId, isNew, task?.id]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: Scroll only when displayed conversation content changes.
  useEffect(() => {
    if (followScroll.current && messagesRef.current)
      messagesRef.current.scrollTop = messagesRef.current.scrollHeight;
  }, [progress, version?.dialogue.length, task?.status, isNew]);
  useEffect(() => {
    if (!task?.id || !session) return;
    const selectedId = task.id;
    let disposed = false;
    setEvents([]);
    setConnected(true);
    const source = new EventSource(appUrl(`/api/tasks/${selectedId}/events`));
    source.onopen = () => {
      if (!disposed) setConnected(true);
    };
    source.onerror = () => {
      if (!disposed) setConnected(false);
    };
    source.onmessage = (message) => {
      if (disposed || taskRef.current !== selectedId) return;
      const event = JSON.parse(message.data) as WorkbenchEvent;
      setConnected(true);
      // Argument/reasoning fragments are not display events; retain complete tool records.
      if (
        event.type !== "loop" ||
        ["tool_start", "tool", "error", "done", "assistant_final"].includes(event.data.role) ||
        (event.data.role === "assistant_delta" && event.data.content)
      )
        setEvents((items) =>
          items.some((e) => e.seq === event.seq) ? items : [...items, event].slice(-3000),
        );
      if (event.type === "state") {
        if (
          event.data.projectId !== projectRef.current ||
          event.data.versionId !== versionRef.current
        )
          return;
        setTask((current) =>
          current?.id === selectedId &&
          (!current.updatedAt || event.data.updatedAt >= current.updatedAt)
            ? event.data
            : current,
        );
        setTasks((items) =>
          items.map((t) =>
            t.id === selectedId && (!t.updatedAt || event.data.updatedAt >= t.updatedAt)
              ? event.data
              : t,
          ),
        );
        if (["completed", "failed", "interrupted"].includes(event.data.status)) {
          source.close();
          void reloadProject().catch((err) => setError(err.message));
        }
      }
      if (event.type === "requirements") void reloadProject().catch((err) => setError(err.message));
    };
    return () => {
      disposed = true;
      source.close();
    };
  }, [task?.id, session, reloadProject]);
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "o" && session) {
        e.preventDefault();
        setFolderOpen(true);
      }
      if (e.key === "Escape") setSidebar(false);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [session]);

  function newChat(upgrade = false) {
    let n = Math.max(0, ...versions.map((v) => Number.parseInt(v.label, 10) || 0)) + 1;
    while (versions.some((v) => v.label === `${n}.0`)) n++;
    const scope = draftScope(session!.userId, projectId, "");
    const saved = readComposerDraft(localStorage, scope);
    const next = saved.text
      ? saved
      : {
          label: `${n}.0`,
          parentId: upgrade && version?.confirmed ? version.id : "",
          text: "",
        };
    setError("");
    composer.replace(scope, next);
    setShowArchived(false);
    if (upgrade && saved.text)
      setNotice("已恢复未发送的草稿。可在下方选择父版本，或发送后再创建新版本。");
    composerProject.current = projectId;
    setIsNew(true);
    setSidebar(false);
  }
  async function start(kind: "chat" | "develop", content = "") {
    const pid = projectId;
    const vid = versionId;
    const previous = tasks.filter((t) => t.versionId === vid && t.kind === "develop").at(-1);
    const resumesTaskId =
      previous && ["failed", "interrupted"].includes(previous.status) ? previous.id : undefined;
    const next = await api(
      `/projects/${pid}/versions/${vid}/${kind}`,
      "POST",
      kind === "chat"
        ? { text: content }
        : { revision: draft?.revision, authorizeChecks: true, resumesTaskId },
    );
    if (projectRef.current !== pid) return;
    setTasks((items) => [...items, next]);
    if (versionRef.current === vid) {
      setTask(next);
      setText("");
      if (kind === "develop") {
        setPanel(true);
        setTab("review");
      }
    }
    await reloadProject(pid);
  }
  async function send() {
    if (!text.trim() || busy || pending) return;
    if (!composingNew) {
      await start("chat", text);
      return;
    }
    const pid = projectId;
    const content = text;
    const v = await api(
      `/projects/${pid}/versions`,
      "POST",
      newRequirementInput(
        pid,
        { projectId: composerProject.current, label, parentId, text: content },
        versions,
      ),
    );
    if (projectRef.current !== pid) return;
    setVersions((items) => [...items, v]);
    setVersionId(v.id);
    versionRef.current = v.id;
    setIsNew(false);
    setTab("prd");
    setText("");
    if (!provider?.apiKeySet) {
      setSettings("model");
      setNotice("需求已保存，配置模型后即可开始分析。");
      return;
    }
    const next = await api(`/projects/${pid}/versions/${v.id}/chat`, "POST", {
      text: "请先了解这个项目，分析本版本的需求，并提出需要澄清的问题。",
    });
    if (projectRef.current !== pid) return;
    setTasks((items) => [...items, next]);
    if (versionRef.current === v.id) setTask(next);
    await reloadProject(pid);
  }
  async function chooseProject(path: string) {
    const p = await api("/projects", "POST", { workdir: path });
    setProjects(await api("/projects"));
    setProjectId(p.id);
    setFolderOpen(false);
    setSidebar(false);
    setNotice(`已打开 ${p.name}`);
  }
  const alert = error
    ? html`<div class="alert error" role="alert">${error}<button class="icon-button" aria-label="关闭错误提示" onClick=${() => setError("")}><${Icon} name="close" size=${16} /></button></div>`
    : notice
      ? html`<div class="toast" role="status"><${Icon} name="check" size=${16} />${notice}<button class="icon-button" aria-label="关闭提示" onClick=${() => setNotice("")}><${Icon} name="close" size=${16} /></button></div>`
      : null;
  if (loading)
    return html`<main class="loading-screen"><span class="spinner" />正在打开工作台…</main>`;
  if (!session)
    return html`<main class="auth-page"><header class="auth-header"><span class="brand"><${Icon} name="brand" size=${24} />Silicon Code</span><button class="icon-button" aria-label="切换外观" onClick=${() => setTheme(theme === "light" ? "dark" : "light")}><${Icon} name=${theme === "light" ? "moon" : "sun"} /></button></header><section class="auth-card"><div class="welcome-symbol"><${Icon} name="brand" size=${34} /></div><h1>${setup ? "创建你的工作台" : "欢迎回来"}</h1><p class="auth-subtitle">从一个想法，到可以运行的代码。</p>${alert}<form onSubmit=${(
      e: SubmitEvent,
    ) => {
      e.preventDefault();
      const form = e.currentTarget as HTMLFormElement;
      void action(async () => {
        const login = { username: field(form, "username"), password: field(form, "password") };
        if (setup) {
          await api("/auth/setup", "POST", { ...login, setupToken: field(form, "token") });
          setSetup(false);
        }
        setSession(await api("/auth/login", "POST", login));
      });
    }}>
      ${setup && html`<label>首次设置凭据<input name="token" required autocomplete="off" placeholder="启动服务时显示的设置凭据" /></label>`}<label>用户名<input name="username" required autocomplete="username" placeholder="输入用户名" /></label><label>密码<input name="password" type="password" required minLength=${setup ? 12 : 1} autocomplete=${setup ? "new-password" : "current-password"} placeholder=${setup ? "至少 12 个字符" : "输入密码"} /></label><button class="primary auth-submit" disabled=${pending}>${pending ? "正在连接…" : setup ? "创建管理员账户" : "登录工作台"}<${Icon} name="chevron" size=${17} /></button></form><p class="auth-note">${setup ? "创建账户后即可连接 DeepSeek，打开本地项目。" : "登录后继续你的项目、需求和开发任务。"}</p></section><footer class="auth-footer">Silicon Code · 你的开发工作台</footer></main>`;

  return html`<div class=${`workbench ${sidebar ? "sidebar-open" : ""} ${panel && !composingNew ? "with-inspector" : ""}`}>
    ${sidebar && html`<button class="sidebar-scrim" aria-label="收起项目列表" onClick=${() => setSidebar(false)} />`}
    <aside class="sidebar"><div class="sidebar-brand"><span class="brand"><${Icon} name="brand" size=${23} />Silicon Code</span><button class="icon-button mobile-only" aria-label="收起项目列表" onClick=${() => setSidebar(false)}><${Icon} name="sidebar" /></button></div>
      <button class="nav-action new-chat" onClick=${() => (project ? newChat() : setFolderOpen(true))}><${Icon} name="edit" />新建任务<kbd>＋</kbd></button>
      <div class="sidebar-search"><${Icon} name="search" size=${16} /><input aria-label="搜索项目" placeholder="搜索项目" value=${projectFilter} onInput=${(e: any) => setProjectFilter(e.target.value)} /></div>
      <div class="section-heading"><span>项目</span><button class="icon-button" aria-label="添加项目" title="打开项目文件夹 ⌘O" onClick=${() => setFolderOpen(true)}><${Icon} name="plus" size=${16} /></button></div>
      <nav class="project-list" aria-label="项目与任务">${projects
        .filter((p) => p.name.toLowerCase().includes(projectFilter.toLowerCase()))
        .map(
          (p) =>
            html`<div class="project-group"><button class=${`project-button ${p.id === projectId ? "active" : ""}`} title=${p.workdir} aria-expanded=${p.id === projectId} onClick=${() => {
              setProjectId(p.id);
              setIsNew(false);
            }}><${Icon} name=${p.id === projectId ? "down" : "chevron"} size=${13} /><${Icon} name="folder" size=${17} /><span>${p.name}</span></button>${
              p.id === projectId &&
              html`<div class="version-list"><input aria-label="搜索当前项目任务" placeholder="搜索任务…" value=${taskFilter} onInput=${(e: any) => setTaskFilter(e.target.value)} /><button class="text-button" aria-pressed=${showArchived} onClick=${() => setShowArchived(!showArchived)}>${showArchived ? "返回未归档任务" : "查看已归档任务"}</button>${visibleVersions
                .slice()
                .reverse()
                .map(
                  (v) =>
                    html`<button class=${`version-button ${v.id === versionId && !isNew ? "selected" : ""}`} title=${v.requirement} onClick=${() => {
                      setVersionId(v.id);
                      setIsNew(false);
                      setAuthorizationKey("");
                      setSidebar(false);
                    }}><span class=${`version-dot ${v.confirmed ? "confirmed" : ""}`} /><span class="version-title">${v.title || v.requirement}</span><span class="version-label">${v.label}</span></button>`,
                )}${!versions.length && html`<p class="sidebar-hint">从你的第一个任务开始</p>`}<button class="add-version" onClick=${() => newChat()}><${Icon} name="plus" size=${14} />新任务</button></div>`
            }</div>`,
        )}${!projects.length && html`<p class="sidebar-hint">打开本地文件夹，开始协作。</p>`}</nav>
      <button class="add-project-button" onClick=${() => setFolderOpen(true)}><${Icon} name="folder" size=${17} />打开项目文件夹</button><footer class="sidebar-footer"><button class="account-button" onClick=${() => setSettings("model")}><span class="avatar">${session.username.slice(0, 1).toUpperCase()}</span><span>${session.username}<small>个人工作台</small></span><${Icon} name="settings" size=${18} /></button></footer>
    </aside>
    <main class="workspace"><header class="workspace-header"><div class="header-location"><button class="icon-button mobile-only" aria-label="展开项目列表" onClick=${() => setSidebar(true)}><${Icon} name="sidebar" /></button><${Icon} name="folder" size=${16} /><span>${project?.name || "工作台"}</span><span class="breadcrumb-divider">/</span><strong>${composingNew ? "新任务" : `版本 ${version?.label}`}</strong>${!composingNew && html`<span class="document-state">${version?.confirmed ? "已确认" : "草案"}</span>`}</div><div class="header-actions">${project && html`<button class="text-button" onClick=${() => setProjectTools(true)}>项目工具</button>`}${!composingNew && html`<button class="text-button" onClick=${() => setTaskSettings(true)}>管理任务</button><button class="text-button upgrade-button" onClick=${() => newChat(true)}><${Icon} name="branch" size=${16} />迭代新版本</button><button class=${`icon-button ${panel ? "selected" : ""}`} aria-label=${panel ? "收起文档面板" : "打开文档面板"} title="需求、设计与代码变更" onClick=${() => setPanel(!panel)}><${Icon} name="panel" /></button>`}</div></header>
    <div class="workspace-body"><section class=${`chat-pane ${composingNew ? "new-task-pane" : ""}`} aria-label="任务对话">${alert}
      <div class="messages-scroll" ref=${messagesRef} onScroll=${(e: Event) => {
        const el = e.currentTarget as HTMLDivElement;
        followScroll.current = el.scrollHeight - el.scrollTop - el.clientHeight < 100;
      }}>
      ${
        composingNew
          ? html`<div class="welcome"><div class="welcome-symbol"><${Icon} name="brand" size=${36} /></div><p class="eyebrow">${project ? `在 ${project.name} 中工作` : "欢迎使用 Silicon Code"}</p><h1>一起，把想法变成现实。</h1><p>描述你想构建、修复或改进的内容。</p>${!project && html`<button class="primary choose-folder-hero" onClick=${() => setFolderOpen(true)}><${Icon} name="folder" />打开项目文件夹</button>`}</div>`
          : html`<div class="conversation"><div class="conversation-heading"><span>任务</span>${version?.parentId && html`<span><${Icon} name="branch" size=${13} />基于 ${versions.find((v) => v.id === version.parentId)?.label}</span>`}</div><div class="user-message"><p>${version?.requirement}</p></div>${version?.dialogue.map((d) => html`<article class=${d.role === "user" ? "user-message" : "assistant-message"}>${d.role !== "user" && html`<span class="assistant-avatar"><${Icon} name="brand" size=${19} /></span>`}<div class="message-body"><${Markdown} text=${d.text} /></div></article>`)}
      ${
        draft &&
        html`<button class="document-callout" onClick=${() => {
          setTab("prd");
          setPanel(true);
        }}><span class="document-callout-icon"><${Icon} name="file" size=${21} /></span><span><strong>需求与设计已整理</strong><small>修订 ${draft.revision} · ${draft.questions.length ? `${draft.questions.length} 个问题待澄清` : version?.confirmed ? "已确认，可开始开发" : "查看文档并确认"}</small></span><${Icon} name="chevron" size=${17} /></button>`
      }
      ${
        task &&
        html`<div class="execution-divider"><span>执行记录</span><select aria-label="选择执行记录" value=${task.id} onChange=${(e: any) => setTask(tasks.find((t) => t.id === e.target.value) ?? null)}>${selectedTasks.map((t, i) => html`<option value=${t.id}>${i + 1}. ${t.kind === "clarify" ? "需求分析" : "自动开发"} · ${statusNames[t.status] || t.status}</option>`)}</select></div><div class="task-status-line"><${Status} task=${task} /><span>${phaseNames[task.phase] || task.phase}${task.attempt ? ` · 第 ${task.attempt} 轮` : ""}</span>${
          activeTask(task) &&
          html`<button class="text-button" disabled=${pending} onClick=${() =>
            void action(async () => {
              await api(`/tasks/${task.id}/cancel`, "POST", {});
            })}><${Icon} name="stop" size=${13} />停止任务</button>`
        }</div>${!connected && activeTask(task) && html`<p class="hint" role="status">连接已断开，正在重连。任务仍在后台执行。</p>`}${task.error && html`<p class="alert error">${task.error}</p>`}
      ${task.resumesTaskId && html`<p class="hint">已接续上次执行。<button class="text-button" onClick=${() => setTask(tasks.find((t) => t.id === task.resumesTaskId) ?? task)}>查看上次记录</button></p>`}
      ${
        task.approval &&
        html`<div class="approval-card"><div class="approval-heading"><${Icon} name="terminal" /><strong>允许执行这条命令？</strong></div><pre>${task.approval.payload.command || JSON.stringify(task.approval.payload)}</pre><p class="hint">${task.approval.payload.cwd || project?.workdir}</p><div class="row">${[
          true,
          false,
        ].map(
          (allow) =>
            html`<button class=${allow ? "primary" : ""} disabled=${pending} onClick=${() =>
              void action(async () => {
                await api(`/tasks/${task.id}/approval`, "POST", {
                  approvalId: task.approval!.id,
                  allow,
                });
              })}>${allow ? "仅运行这一次" : "拒绝"}</button>`,
        )}</div></div>`
      }
      ${visibleProgress && html`<article class="assistant-message"><span class="assistant-avatar"><${Icon} name="brand" size=${19} /></span><div class="message-body"><${Markdown} text=${progress} /></div></article>`}${activeTask(task) && html`<div class="thinking-line" role="status"><span class="thinking-dots">● ● ●</span>${task.approval ? "等待你的审批" : phaseNames[task.phase] || "正在处理"}</div>`}
      ${
        !activeTask(task) &&
        task.kind === "develop" &&
        html`<button class="result-card" onClick=${() => {
          setTab("review");
          setPanel(true);
        }}><span class="result-icon"><${Icon} name=${task.status === "completed" ? "check" : "terminal"} /></span><span><strong>${task.status === "completed" ? "本轮开发已完成" : "查看执行结果"}</strong><small>${task.reviews.length} 次审查 · ${task.checks.length} 项验证记录</small></span><${Icon} name="chevron" size=${17} /></button>`
      }<${Activity} events=${events} />`
      }</div>`
      }
      </div>
      <div class="composer-dock">${
        !composingNew && version?.archivedAt
          ? html`<div class="confirmed-composer"><p>此任务已归档，历史文档与执行记录保留。</p><button class="primary" onClick=${() => setTaskSettings(true)}>恢复或重命名</button></div>`
          : !composingNew && version?.confirmed
            ? html`<div class="confirmed-composer"><div class="row between"><span class="confirmed-note"><${Icon} name="check" size=${16} />需求与设计已确认</span><button class="text-button" onClick=${() => {
                setTab("checks");
                setPanel(true);
              }}>查看验收命令</button></div><label class="authorization"><input type="checkbox" checked=${authorized} disabled=${busy} onChange=${(e: any) => setAuthorizationKey(e.target.checked ? currentAuthorizationKey : "")} />允许修改此项目，并运行已确认的测试与打包命令</label><div class="row between"><span class="workdir-chip" title=${project?.workdir}><${Icon} name="folder" size=${14} />${project?.name}</span><button class="primary" disabled=${pending || busy || !authorized} onClick=${() => void action(() => start("develop"))}><${Icon} name="bolt" size=${15} />${selectedTasks.some((t) => t.kind === "develop") ? "继续开发" : "开始自动开发"}</button></div></div>`
            : html`<form class="composer" onSubmit=${(e: SubmitEvent) => {
                e.preventDefault();
                void action(send);
              }}>
      ${composingNew && project && html`<div class="composer-version"><span>版本</span><input aria-label="版本名称" value=${label} required maxLength="80" onInput=${(e: any) => setLabel(e.target.value)} /><select aria-label="基于哪个历史版本" value=${parentId} onChange=${(e: any) => setParentId(e.target.value)}><option value="">全新需求</option>${versions.filter((v) => v.confirmed).map((v) => html`<option value=${v.id}>基于 ${v.label}</option>`)}</select></div>`}<label class="sr-only" for="message-input">${composingNew ? "描述新任务" : "补充需求或回答澄清问题"}</label><textarea id="message-input" value=${text} disabled=${!project || busy} required placeholder=${!project ? "先选择一个项目文件夹" : composingNew ? "让我们来做点什么？" : "补充需求，或回答上面的问题…"} onInput=${(e: any) => setText(e.target.value)} onKeyDown=${(
        e: KeyboardEvent,
      ) => {
        if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
          e.preventDefault();
          if (text.trim() && project && !busy && !pending) void action(send);
        }
      }} /><div class="composer-toolbar"><button type="button" class="workdir-chip" onClick=${() => setFolderOpen(true)} title=${project?.workdir || "打开项目文件夹"}><${Icon} name="folder" size=${15} />${project?.name || "选择项目"}<${Icon} name="down" size=${12} /></button><div class="row"><button type="button" class="model-chip" onClick=${() => setSettings("model")}><span class=${`provider-dot ${provider?.apiKeySet ? "" : "missing"}`} />${provider?.model || "配置模型"}<${Icon} name="down" size=${12} /></button><button class="send-button" aria-label=${composingNew ? "创建任务并开始分析" : "发送并分析"} disabled=${!project || !text.trim() || !label.trim() || pending || busy}><${Icon} name="up" size=${20} /></button></div></div></form>`
      }
      ${
        composingNew &&
        project &&
        html`<div class="suggestions">${[
          {
            icon: "search",
            title: "了解项目",
            text: "请阅读这个项目，介绍架构、核心流程和运行方式。",
          },
          {
            icon: "bolt",
            title: "实现功能",
            text: "我想给这个项目添加一个新功能，请先了解现有代码，和我一起明确需求。",
          },
          {
            icon: "terminal",
            title: "排查问题",
            text: "请检查这个项目，定位当前问题，并给出可以验证的修复方案。",
          },
        ].map(
          (s) =>
            html`<button disabled=${busy} onClick=${() => {
              setText(s.text);
              document.getElementById("message-input")?.focus();
            }}><${Icon} name=${s.icon} size=${16} />${s.title}</button>`,
        )}</div>`
      }<p class="composer-footnote">${busy ? "任务执行中，可在对话中查看进度与审批命令。" : !composingNew && version?.confirmed ? "新需求可通过右上角「迭代新版本」继续。" : "先理解需求，再动手实现。⌘ / Ctrl + Enter 发送"}</p></div>
    </section>
    ${
      panel &&
      !composingNew &&
      html`<aside class="inspector" aria-label="需求与执行详情"><header class="inspector-header"><strong>任务详情</strong><span>${draft ? `修订 ${draft.revision}` : "等待生成"}</span><button class="icon-button" aria-label="关闭文档面板" onClick=${() => setPanel(false)}><${Icon} name="close" size=${17} /></button></header><nav class="inspector-tabs" aria-label="任务详情视图">${Object.entries(tabs).map(([key, name]) => html`<button aria-pressed=${tab === key} onClick=${() => setTab(key as keyof typeof tabs)}>${name}${key === "prd" && draft?.questions.length ? html`<span class="tab-indicator" />` : null}</button>`)}</nav><div class="inspector-scroll">${tab === "review" ? html`<${Evidence} task=${task} />` : tab === "changes" ? html`<${Changes} task=${task} />` : draft ? (tab === "checks" ? html`<div class="checks-document"><h2>验收标准</h2><ol class="acceptance-list">${draft.acceptance.map((a) => html`<li>${a}</li>`)}</ol><h2>验证命令</h2>${draft.checks.map((c) => html`<div class="planned-command"><div class="row between"><span>${c.kind === "test" ? "测试" : "打包"}</span><small>超时 ${c.timeoutSec} 秒</small></div><code>${c.command}</code></div>`)}</div>` : html`<${Markdown} className="document" text=${tab === "prd" ? draft.prd : draft.sdd} />`) : html`<div class="panel-empty"><${Icon} name="file" size=${28} /><h3>从对话到清晰的计划</h3><p>分析需求后，PRD、技术设计和验收标准会出现在这里。</p></div>`}${draft?.questions.length && ["prd", "sdd", "checks"].includes(tab) ? html`<div class="approval-card"><strong>待澄清的问题</strong><ol>${draft.questions.map((q) => html`<li>${q}</li>`)}</ol><p class="hint">在对话中回复后，文档会继续完善。</p></div>` : null}</div>${
        draft &&
        html`<footer class="document-footer">${
          version?.confirmed
            ? html`<span class="confirmed-note"><${Icon} name="check" size=${16} />当前文档已确认</span>`
            : html`<p class="hint">${draft.questions.length ? "回答待澄清的问题后即可确认。" : "确认后，按此版本的需求和设计进行开发。"}</p><button class="primary" disabled=${pending || busy || Boolean(version?.archivedAt) || draft.questions.length > 0 || !draft.checks.some((c) => c.kind === "test") || !draft.checks.some((c) => c.kind === "build")} onClick=${() =>
                void action(async () => {
                  await api(`/projects/${projectId}/versions/${versionId}/confirm`, "POST", {
                    revision: draft.revision,
                  });
                  await reloadProject();
                  setNotice("文档已确认，可以开始开发。");
                })}><${Icon} name="check" size=${16} />确认 PRD / SDD</button>`
        }</footer>`
      }</aside>`
    }
    </div></main>
    ${
      taskSettings &&
      version &&
      html`<${Modal} title="管理任务" onClose=${() => setTaskSettings(false)}><form onSubmit=${(
        e: SubmitEvent,
      ) => {
        e.preventDefault();
        const form = e.currentTarget as HTMLFormElement;
        void action(async () => {
          await api(`/projects/${projectId}/versions/${versionId}/metadata`, "POST", {
            title: field(form, "title"),
          });
          await reloadProject();
          setTaskSettings(false);
          setNotice("任务名称已更新，原始需求与执行记录保留。");
        });
      }}><label>任务名称<input name="title" required maxLength="120" value=${version.title || version.requirement.slice(0, 120)} /></label><button class="primary" disabled=${pending}>保存名称</button></form><p class="hint">归档只隐藏任务，不删除需求、对话、文件或执行记录；可以随时恢复。</p><button disabled=${pending || selectedTasks.some(activeTask)} onClick=${() =>
        void action(async () => {
          await api(`/projects/${projectId}/versions/${versionId}/metadata`, "POST", {
            archived: !version.archivedAt,
          });
          setShowArchived(!version.archivedAt);
          await reloadProject();
          setTaskSettings(false);
          setNotice(version.archivedAt ? "任务已恢复。" : "任务已归档，可在已归档列表中恢复。");
        })}>${version.archivedAt ? "恢复任务" : "归档任务"}</button><//>`
    }
    ${projectTools && project && html`<${ProjectTools} key=${project.id} project=${project} api=${api} onClose=${() => setProjectTools(false)} onProject=${async (created?: Project) => {
      setProjects(await api("/projects"));
      if (created) setProjectId(created.id);
    }} />`}
    ${folderOpen && html`<${FolderPicker} api=${api} initial=${project?.workdir} projects=${projects} onChoose=${chooseProject} onClose=${() => setFolderOpen(false)} />`}
    ${
      settings &&
      html`<${Modal} title="设置" className="settings-modal" onClose=${() => setSettings("")}><nav class="settings-tabs" aria-label="设置分类">${Object.entries({ model: "模型", limits: "运行限制", data: "数据", appearance: "外观", account: "账户" }).map(([key, name]) => html`<button aria-pressed=${settings === key} onClick=${() => setSettings(key)}>${name}</button>`)}</nav><div class="settings-body">${error && html`<p class="alert error" role="alert">${error}</p>`}${notice && html`<p class="hint" role="status">${notice}</p>`}${
        settings === "model"
          ? html`<h3>连接你的模型</h3><p class="muted">为需求分析与自动开发选择模型。</p><form key=${provider?.baseUrl} onSubmit=${(
              e: SubmitEvent,
            ) => {
              e.preventDefault();
              const form = e.currentTarget as HTMLFormElement;
              void action(async () => {
                const key = field(form, "key");
                const saved = await api("/provider", "PUT", {
                  baseUrl: field(form, "baseUrl"),
                  model: field(form, "model"),
                  ...(key ? { apiKey: key } : {}),
                });
                setProvider(saved);
                (form.elements.namedItem("key") as HTMLInputElement).value = "";
                setNotice(
                  Object.values(saved.sources ?? {}).includes("environment")
                    ? "配置文件已保存。环境变量仍优先，请修改服务的环境变量并重启后再使用新配置。"
                    : "模型配置已保存，下个回合生效。",
                );
              });
            }}><label>API 地址<input name="baseUrl" value=${provider?.baseUrl || "https://api.deepseek.com"} required /></label><label>模型 ID<input name="model" value=${provider?.model || "deepseek-flash"} required /></label><label>API Key<span class="field-state">${provider?.apiKeySet ? "已配置" : "未配置"}</span><input name="key" type="password" autocomplete="off" placeholder=${provider?.apiKeySet ? "留空保留已保存的 Key" : "输入 API Key"} /></label><p class="hint">Key 仅保存在服务端，不会在页面回显。</p>${provider?.sources?.apiKey === "environment" && html`<p class="hint" role="status">当前 Key 由 DEEPSEEK_API_KEY 环境变量控制；保存新 Key 不会覆盖该环境变量。</p>`}${provider?.sources?.baseUrl === "environment" && html`<p class="hint" role="status">当前 API 地址由 DEEPSEEK_BASE_URL 环境变量控制；请调整服务环境并重启以更换。</p>`}<button class="primary" disabled=${pending}>保存模型配置</button><button type="button" disabled=${pending || !provider?.apiKeySet} onClick=${() =>
              void action(async () => {
                const result = await api("/provider/probe", "POST", {});
                if (!result.ok) {
                  const errors: Record<string, string> = {
                    unauthorized: "服务商拒绝了当前生效的 Key",
                    network_error: "无法连接模型服务",
                    api_key_required: "请先保存 API Key",
                    invalid_api_key: "API Key 格式不正确",
                    invalid_url: "API 地址无效",
                    invalid_response: "模型列表返回格式无效",
                    http_error: "模型列表接口请求失败",
                  };
                  throw new Error(errors[result.code] || "连接检查失败");
                }
                setNotice(
                  result.modelListed
                    ? "连接检查通过，模型列表包含当前模型。尚未发起推理请求。"
                    : "连接成功，但列表未包含当前模型 ID；请确认名称和访问权限。未自动修改配置。",
                );
              })}>检查当前连接</button><p class="hint">检查使用已生效配置，只读取模型列表，不发送项目内容。</p></form>`
          : settings === "limits"
            ? html`<h3>每次执行的运行限制</h3><p class="muted">下一次启动的任务生效，包含该次开发、审查和修复的全部模型请求。</p><form onSubmit=${(
                e: SubmitEvent,
              ) => {
                e.preventDefault();
                const form = e.currentTarget as HTMLFormElement;
                void action(async () => {
                  setLimits(
                    await api("/settings", "PUT", {
                      budgetUsd: field(form, "budget") ? Number(field(form, "budget")) : null,
                      maxTokens: field(form, "tokens") ? Number(field(form, "tokens")) : null,
                    }),
                  );
                  setNotice("运行限制已保存，下次任务启动时生效。");
                });
              }}><label>估算费用上限（USD）<input name="budget" type="number" min="0.000001" max="100000" step="any" value=${limits.budgetUsd ?? ""} placeholder="留空不限" /></label><label>累计输入与输出 Token 上限<input name="tokens" type="number" min="1" max="1000000000" step="1" value=${limits.maxTokens ?? ""} placeholder="留空不限" /></label><p class="hint">每次模型响应后检查。单次请求可能超过剩余额度，费用仅为估算；设置上限后，用量或价格缺失会停止继续执行。</p><button class="primary" disabled=${pending}>保存运行限制</button></form>`
            : settings === "data"
              ? html`<h3>工作台备份</h3><p>导出账户登录信息、项目索引、需求、对话、执行记录和运行限制。备份含执行快照，但不包含完整项目目录和模型配置文件。</p><p class="hint">备份包含私人对话与账户密码哈希，请存放在你自己的安全位置。正在执行的任务结束后可导出。</p><a class="primary" href=${appUrl("/api/backup")} download="siliconcode-workbench.scwb.gz">下载工作台备份</a><h3>恢复到新数据目录</h3><p>恢复会校验格式、长度与哈希，只写入空目录。</p><pre> brown workbench-restore /path/backup.scwb.gz --data-dir /path/new-data</pre><p>完成后使用 brown serve --data-dir /path/new-data 启动，并用原账户密码登录。</p>`
              : settings === "appearance"
                ? html`<h3>让工作台更适合你</h3><p class="muted">外观偏好会保存在此浏览器。</p><div class="theme-options">${["light", "dark"].map((value) => html`<button aria-pressed=${theme === value} onClick=${() => setTheme(value)}><span class=${`theme-preview ${value}`}><i /><b><em /><em /><em /></b></span><span><${Icon} name=${value === "light" ? "sun" : "moon"} size=${17} />${value === "light" ? "浅色" : "深色"}${theme === value && html`<${Icon} name="check" size=${16} />`}</span></button>`)}</div>`
                : html`<div class="account-summary"><span class="avatar">${session.username.slice(0, 1).toUpperCase()}</span><div><strong>${session.username}</strong><p class="muted">个人管理员</p></div></div><h3>修改密码</h3><form onSubmit=${(
                    e: SubmitEvent,
                  ) => {
                    e.preventDefault();
                    const form = e.currentTarget as HTMLFormElement;
                    void action(async () => {
                      await api("/auth/password", "POST", {
                        oldPassword: field(form, "old"),
                        password: field(form, "new"),
                      });
                      setSettings("");
                      setSession(null);
                    });
                  }}><label>原密码<input name="old" type="password" required autocomplete="current-password" /></label><label>新密码<input name="new" type="password" required minLength="12" autocomplete="new-password" placeholder="至少 12 个字符" /></label><button disabled=${pending}>保存并重新登录</button></form><button class="text-button sign-out" disabled=${pending} onClick=${() =>
                    void action(async () => {
                      await api("/auth/logout", "POST", {});
                      setSettings("");
                      setSession(null);
                    })}><${Icon} name="logout" size=${17} />退出登录</button>`
      }</div><//>`
    }
  </div>`;
}
const root = document.getElementById("app");
if (root) render(html`<${App} />`, root);
