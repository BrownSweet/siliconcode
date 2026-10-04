import { useEffect, useState } from "preact/hooks";
import { type Api, Modal, type Project, html } from "./workbench-components.js";

interface WorkspaceReview {
  tree: string;
  targetHead: string;
  targetPath: string;
  targetBranch: string;
  mergeable: boolean;
  reason: string;
  diff: string;
}
interface Preview {
  process: null | {
    command: string;
    url: string;
    status: string;
    output: string;
    exitCode: number | null;
    spawnError?: string;
  };
  localAccess: boolean;
}

export function ProjectTools({
  project,
  api,
  onProject,
  onClose,
}: {
  project: Project;
  api: Api;
  onProject: (project?: Project) => Promise<void>;
  onClose: () => void;
}) {
  const [tab, setTab] = useState("workspace");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [review, setReview] = useState<WorkspaceReview | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [command, setCommand] = useState("");
  const [url, setUrl] = useState("http://127.0.0.1:5173/");
  const [approved, setApproved] = useState(false);
  const [mergeApproved, setMergeApproved] = useState(false);
  const prefix = `/projects/${project.id}`;
  async function action(fn: () => Promise<void>) {
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
  }
  useEffect(() => {
    if (tab !== "preview") return;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const next = await api(`${prefix}/preview`);
        if (!disposed) setPreview(next);
      } catch (err) {
        if (!disposed) setError((err as Error).message);
      } finally {
        if (!disposed) timer = setTimeout(poll, 1500);
      }
    }
    void poll();
    return () => {
      disposed = true;
      clearTimeout(timer);
    };
  }, [api, prefix, tab]);
  const running = preview?.process && preview.process.status !== "exited";
  return html`<${Modal} title="项目工具" onClose=${onClose} className="project-tools-modal">
    <nav class="settings-tabs" aria-label="项目工具分类">
      <button aria-pressed=${tab === "workspace"} onClick=${() => setTab("workspace")}>隔离工作区</button>
      <button aria-pressed=${tab === "preview"} onClick=${() => setTab("preview")}>预览与日志</button>
    </nav><div class="settings-body">
    <p class="hint">${project.workdir}</p>
    ${error && html`<p class="alert error" role="alert">${error}</p>`}
    ${notice && html`<p role="status">${notice}</p>`}
    ${
      tab === "workspace"
        ? project.workspace
          ? html`
      <p>当前为独立工作区：<code>${project.workspace.branch}</code></p>
      <p>合并前请停止相关任务与预览。原项目必须没有未提交修改，且仍在创建工作区时的提交。</p>
      <button disabled=${pending} onClick=${() =>
        void action(async () => {
          setReview(null);
          setMergeApproved(false);
          setReview(await api(`${prefix}/workspace-review`));
        })}>查看当前全部差异</button>
      ${
        review &&
        html`<p>${review.reason}</p><p>合并到：${review.targetPath}（${review.targetBranch}）</p>
        <pre class="project-tool-output" tabindex="0" aria-label="工作区差异">${review.diff || "没有变更"}</pre>
        <label class="authorization"><input type="checkbox" checked=${mergeApproved} disabled=${pending || !review.mergeable}
          onChange=${(e: Event) => setMergeApproved((e.target as HTMLInputElement).checked)} />
          已检查全部差异，允许将这些文件变更保存为一个 Git 提交并快进合并到原项目</label>
        <button class="primary" disabled=${pending || !review.mergeable || !mergeApproved} onClick=${() =>
          void action(async () => {
            const result = await api(`${prefix}/workspace-merge`, "POST", {
              authorize: true,
              tree: review.tree,
              targetHead: review.targetHead,
            });
            setReview(null);
            setMergeApproved(false);
            setNotice(`已合并：${result.commit}。隔离目录和结果分支保留。`);
            await onProject();
          })}>合并已审阅的变更</button>`
      }
      `
          : html`<h3>在独立目录中开发</h3>
        <p>从此 Git 仓库当前提交创建独立分支，并添加为新项目。原目录的未提交修改、忽略文件和依赖不会复制；新项目需单独准备依赖、需求与验证。</p>
        <p class="hint">普通目录无需创建工作区，可以继续直接开发。隔离工作区仅支持已有提交的 Git 仓库根目录。</p>
        <button class="primary" disabled=${pending} onClick=${() =>
          void action(async () => {
            const created = await api(`${prefix}/workspace`, "POST", { authorize: true });
            await onProject(created);
            onClose();
          })}>创建并打开隔离工作区</button>`
        : html`<h3>启动项目预览</h3><p>填写项目已有的启动命令和本机地址。点击启动会在当前目录执行该命令，请将服务绑定到 127.0.0.1。开发任务与预览不能同时运行。</p>
        <form onSubmit=${(e: SubmitEvent) => {
          e.preventDefault();
          void action(async () => {
            await api(`${prefix}/preview`, "POST", { authorize: true, command, url });
            setPreview(await api(`${prefix}/preview`));
            setApproved(false);
          });
        }}>
          <label>启动命令<input value=${command} required maxLength="4000" disabled=${pending || Boolean(running)} placeholder="例如 npm run dev -- --host 127.0.0.1" onInput=${(
            e: Event,
          ) => {
            setCommand((e.target as HTMLInputElement).value);
            setApproved(false);
          }} /></label>
          <label>预览地址<input value=${url} type="url" required disabled=${pending || Boolean(running)} onInput=${(
            e: Event,
          ) => {
            setUrl((e.target as HTMLInputElement).value);
            setApproved(false);
          }} /></label>
          <label class="authorization"><input type="checkbox" checked=${approved} disabled=${pending || Boolean(running)} onChange=${(e: Event) => setApproved((e.target as HTMLInputElement).checked)} />允许执行以上命令并保持后台运行，直到停止预览或关闭服务</label>
          <button class="primary" disabled=${pending || Boolean(running) || !approved}>启动预览</button>
        </form>
        ${
          preview?.process &&
          html`<p>进程：${preview.process.status === "running" ? "运行中" : preview.process.status === "starting" ? "启动中" : `已退出，退出码 ${preview.process.exitCode ?? "未知"}`}</p><code>${preview.process.command}</code>
          ${preview.process.spawnError && html`<p class="alert error">${preview.process.spawnError}</p>`}
          <div class="row"><button disabled=${pending || !running} onClick=${() =>
            void action(async () => {
              await api(`${prefix}/preview-stop`, "POST", {});
              setPreview(await api(`${prefix}/preview`));
            })}>停止预览</button>
          ${running && preview.localAccess && html`<a href=${preview.process.url} target="_blank" rel="noopener noreferrer">打开预览</a>`}</div>
          <p class="hint">地址由你填写；进程运行不代表网页已就绪，请检查日志。${!preview.localAccess ? "远程连接请通过已配置的安全转发访问服务端预览。" : ""}日志只保留最近约 64 KiB，重启服务后清空。</p>
          <pre class="project-tool-output" tabindex="0" aria-label="预览进程日志">${preview.process.output || "暂无输出"}</pre>`
        }
      `
    }
    </div><//>`;
}
