import { randomUUID } from "node:crypto";
import { appendFileSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import { open } from "node:fs/promises";
import { isAbsolute, join, relative } from "node:path";
import { createInterface } from "node:readline";
import { z } from "zod";
import { DeepSeekClient } from "../client.js";
import { loadActiveModelProvider } from "../config.js";
import { PauseGate, type PauseRequest } from "../core/pause-gate.js";
import { CacheFirstLoop } from "../loop.js";
import { ImmutablePrefix } from "../memory/runtime.js";
import { FLASH_MODEL_ID } from "../models.js";
import { providerClientOptions } from "../provider-client-options.js";
import { ToolRegistry } from "../tools.js";
import { registerFilesystemTools } from "../tools/filesystem.js";
import { registerShellTools, runCommand } from "../tools/shell.js";
import type { ChatMessage, JSONSchema } from "../types.js";
import { type WorkbenchPhase, workbenchPrompt } from "./prompt.js";
import { WorkbenchError, type WorkbenchStore, atomicJson, draftSchema, readJson } from "./store.js";
import { type TaskLimits, type TaskUsage, addTaskUsage, taskLimitReason } from "./usage.js";
import {
  type WorkspaceSnapshot,
  captureWorkspace,
  workspaceDiff,
  workspaceFingerprint,
} from "./verification.js";

export type TaskStatus =
  | "running"
  | "waiting_for_approval"
  | "completed"
  | "failed"
  | "interrupted";
export interface WorkbenchTask {
  id: string;
  ownerId: string;
  projectId: string;
  versionId: string;
  resumesTaskId?: string;
  kind: "clarify" | "develop";
  status: TaskStatus;
  phase: string;
  createdAt: string;
  updatedAt: string;
  error?: string;
  attempt: number;
  limits?: TaskLimits;
  usage?: TaskUsage;
  approval?: PauseRequest;
  beforeFingerprint?: string;
  verifiedFingerprint?: string;
  baseline?: { diff: string; status: string };
  changes?: { diff: string; status: string };
  changesError?: string;
  checks: Array<{
    attempt: number;
    fingerprint: string;
    command: string;
    kind: string;
    exitCode: number | null;
    timedOut: boolean;
    output: string;
  }>;
  reviews: Array<{ attempt: number; fingerprint: string; summary: string; findings: string[] }>;
}
export interface TaskEvent {
  seq: number;
  at: string;
  type: string;
  data: unknown;
}
interface ActiveTask {
  task: WorkbenchTask;
  cancel: AbortController;
  gate: PauseGate;
  loop?: CacheFirstLoop;
  done?: Promise<void>;
}
const reviewSchema = z.object({
  summary: z.string().trim().min(1),
  findings: z.array(z.string().trim().min(1)).max(100),
});
export interface RuntimeOptions {
  configPath: string;
  /** Injection uses the real loop and tools with a fixture provider. */
  client?: () => DeepSeekClient;
  maxRepairAttempts?: number;
}

export class WorkbenchRuntime {
  private active = new Map<string, ActiveTask>();
  private tasks = new Map<string, WorkbenchTask>();
  private listeners = new Map<string, Set<(event: TaskEvent) => void>>();
  private sequences = new Map<string, number>();
  private taskDir: string;
  constructor(
    readonly store: WorkbenchStore,
    private options: RuntimeOptions,
  ) {
    this.taskDir = join(store.dataDir, "tasks");
    mkdirSync(this.taskDir, { recursive: true, mode: 0o700 });
    for (const file of readdirSync(this.taskDir).filter((f) => /^[a-f0-9-]{36}\.json$/.test(f))) {
      const task = readJson<WorkbenchTask | null>(join(this.taskDir, file), null);
      if (!task) continue;
      this.tasks.set(task.id, task);
      if (task.status === "running" || task.status === "waiting_for_approval") {
        task.status = "interrupted";
        task.error = "服务已重启。已保留执行记录；请核对文件和命令结果后再继续，不会自动重放工具。";
        task.approval = undefined;
        this.save(task);
      }
    }
  }
  list(ownerId: string, projectId: string): WorkbenchTask[] {
    this.store.project(ownerId, projectId);
    return structuredClone(
      [...this.tasks.values()]
        .filter((t) => t.ownerId === ownerId && t.projectId === projectId)
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id)),
    );
  }
  get(ownerId: string, id: string): WorkbenchTask {
    const task = this.tasks.get(id);
    if (!task || task.ownerId !== ownerId) throw new WorkbenchError(404, "任务不存在");
    return structuredClone(task);
  }
  activity(ownerId: string, projectId: string) {
    this.store.project(ownerId, projectId);
    return [...this.tasks.values()]
      .filter((task) => task.ownerId === ownerId && task.projectId === projectId)
      .map((task) => ({
        id: task.id,
        status: task.status,
        updatedAt: task.updatedAt,
        approvalId: task.approval?.id,
      }));
  }
  isBusy(projectId: string): boolean {
    return [...this.active.values()].some((a) => a.task.projectId === projectId);
  }
  events(ownerId: string, id: string, after = 0): TaskEvent[] {
    this.get(ownerId, id);
    let raw: string;
    try {
      raw = readFileSync(join(this.taskDir, `${id}.jsonl`), "utf8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw err;
    }
    const out: TaskEvent[] = [];
    for (const line of raw.split("\n")) {
      if (!line) continue;
      try {
        const e = JSON.parse(line) as TaskEvent;
        if (e.seq > after) out.push(e);
      } catch {
        /* A crash can leave the final JSONL record incomplete. */
      }
    }
    return out;
  }
  async *replayEvents(ownerId: string, id: string, after: number, signal: AbortSignal) {
    this.get(ownerId, id);
    const file = await open(join(this.taskDir, `${id}.jsonl`), "r");
    try {
      const { size } = await file.stat();
      if (!size) return;
      const stream = file.createReadStream({ start: 0, end: size - 1, signal, autoClose: false });
      const lines = createInterface({ input: stream, crlfDelay: Number.POSITIVE_INFINITY });
      try {
        for await (const line of lines) {
          signal.throwIfAborted();
          let event: TaskEvent;
          try {
            event = JSON.parse(line) as TaskEvent;
          } catch {
            continue; // An interrupted final JSONL record is not a complete event.
          }
          if (Number.isSafeInteger(event.seq) && event.seq > after) yield event;
        }
      } finally {
        lines.close();
        stream.destroy();
      }
    } finally {
      await file.close();
    }
  }
  subscribe(ownerId: string, id: string, listener: (event: TaskEvent) => void): () => void {
    this.get(ownerId, id);
    const set = this.listeners.get(id) ?? new Set();
    this.listeners.set(id, set);
    set.add(listener);
    return () => {
      set.delete(listener);
      if (!set.size) this.listeners.delete(id);
    };
  }
  start(
    ownerId: string,
    projectId: string,
    versionId: string,
    kind: "clarify" | "develop",
    text = "",
    resumesTaskId?: string,
  ): WorkbenchTask {
    const project = this.store.project(ownerId, projectId);
    const version = this.store.version(ownerId, projectId, versionId);
    if (version.archivedAt) throw new WorkbenchError(409, "请先恢复已归档的任务，再继续执行");
    if (this.isBusy(projectId))
      throw new WorkbenchError(409, "该项目已有任务运行，请等待完成或先停止");
    const overlaps = (left: string, right: string): boolean => {
      const rel = relative(left, right);
      return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
    };
    for (const active of this.active.values()) {
      const other = this.store.project(active.task.ownerId, active.task.projectId);
      if (overlaps(project.workdir, other.workdir) || overlaps(other.workdir, project.workdir)) {
        throw new WorkbenchError(409, "该目录与正在运行的项目重叠，请等待任务完成");
      }
    }
    if (kind === "clarify" && version.confirmed)
      throw new WorkbenchError(409, "已确认版本请通过下一版本继续迭代");
    if (kind === "develop" && !version.confirmed)
      throw new WorkbenchError(409, "请先确认 PRD/SDD 当前修订");
    if (resumesTaskId) {
      const prior = this.get(ownerId, resumesTaskId);
      if (
        kind !== "develop" ||
        prior.kind !== "develop" ||
        prior.projectId !== projectId ||
        prior.versionId !== versionId ||
        !["failed", "interrupted"].includes(prior.status)
      ) {
        throw new WorkbenchError(409, "只能继续同一项目、同一需求版本中失败或中断的开发任务");
      }
    }
    const at = new Date().toISOString();
    const task: WorkbenchTask = {
      id: randomUUID(),
      ownerId,
      projectId,
      versionId,
      resumesTaskId,
      kind,
      status: "running",
      phase: kind,
      createdAt: at,
      updatedAt: at,
      attempt: 0,
      limits: this.store.settings(),
      checks: [],
      reviews: [],
    };
    const active: ActiveTask = { task, cancel: new AbortController(), gate: new PauseGate() };
    active.gate.on((request) => {
      if (request.kind === "path_access") {
        active.gate.resolve(request.id, { type: "deny" });
        return;
      }
      // Every task owns its gate. Only one outstanding request is surfaced;
      // completion selects the next queued request below.
      if (!task.approval) task.approval = request;
      task.status = "waiting_for_approval";
      this.save(task);
    });
    this.tasks.set(task.id, task);
    this.active.set(task.id, active);
    this.save(task);
    active.done = this.execute(active, text)
      .catch(async (err) => {
        task.status = active.cancel.signal.aborted ? "interrupted" : "failed";
        task.error = (err as Error).message;
        // A failed model turn or a cancelled command may already have changed files.
        // Capture those effects without rerunning a tool or replacing the original error.
        if (task.kind === "develop" && task.beforeFingerprint) {
          try {
            const baseline = readJson<WorkspaceSnapshot | null>(
              join(this.taskDir, `${task.id}.baseline.json`),
              null,
            );
            if (!baseline) throw new Error("开发前快照不可用");
            const current = this.store.project(task.ownerId, task.projectId);
            task.changes = workspaceDiff(baseline, await captureWorkspace(current.workdir));
          } catch (snapshotError) {
            task.changesError = `未能更新失败后的文件差异：${(snapshotError as Error).message}。已有差异可能不是最终状态，请检查当前工作目录。`;
          }
        }
      })
      .finally(() => {
        active.gate.cancelAll();
        task.approval = undefined;
        this.active.delete(task.id);
        this.save(task);
      });
    return structuredClone(task);
  }
  approve(ownerId: string, id: string, approvalId: number, allow: boolean): void {
    this.get(ownerId, id);
    const active = this.active.get(id);
    if (!active || active.task.approval?.id !== approvalId)
      throw new WorkbenchError(409, "审批已失效，请刷新");
    this.emit(active.task, "approval", { approvalId, allow, actorId: ownerId });
    active.gate.resolve(approvalId, { type: allow ? "run_once" : "deny" });
    active.task.approval = active.gate.current ?? undefined;
    active.task.status = active.task.approval ? "waiting_for_approval" : "running";
    this.save(active.task);
  }
  cancel(ownerId: string, id: string): void {
    this.get(ownerId, id);
    const active = this.active.get(id);
    if (!active) return;
    active.cancel.abort(new DOMException("用户停止任务", "AbortError"));
    active.loop?.abort();
    active.gate.cancelAll();
  }
  async wait(ownerId: string, id: string): Promise<WorkbenchTask> {
    this.get(ownerId, id);
    await this.active.get(id)?.done;
    return this.get(ownerId, id);
  }
  async close(): Promise<void> {
    const running = [...this.active.values()];
    for (const active of running) this.cancel(active.task.ownerId, active.task.id);
    await Promise.allSettled(running.map((a) => a.done));
  }
  private async execute(active: ActiveTask, input: string): Promise<void> {
    const t = active.task;
    const version = this.store.version(t.ownerId, t.projectId, t.versionId);
    const project = this.store.project(t.ownerId, t.projectId);
    const parent = version.parentId
      ? this.store.version(t.ownerId, t.projectId, version.parentId)
      : undefined;
    const context = JSON.stringify({
      requirement: version.requirement,
      previousVersion: parent?.revisions.at(-1),
      currentDraft: version.revisions.at(-1),
      previousAttempt: t.resumesTaskId ? this.resumeContext(t.ownerId, t.resumesTaskId) : undefined,
    });
    if (t.kind === "clarify") {
      this.store.recordDialogue(t.ownerId, t.projectId, t.versionId, {
        role: "user",
        text: input || version.requirement,
        taskId: t.id,
      });
      await this.phase(
        active,
        "clarify",
        `${context}\n用户输入：${input || version.requirement}`,
        version.messages,
      );
      t.status = "completed";
      return;
    }
    const baseline = await captureWorkspace(project.workdir);
    atomicJson(join(this.taskDir, `${t.id}.baseline.json`), baseline);
    t.baseline = {
      status: `开发前快照：${Object.keys(baseline.files).length} 个文件；${baseline.head === null ? "普通目录" : baseline.head === "unborn" ? "尚无提交的 Git 项目" : `Git ${baseline.head}`}`,
      diff: "包含任务开始时已有的文件修改。本轮差异以此快照为准。",
    };
    t.beforeFingerprint = baseline.fingerprint;
    this.save(t);
    const draft = version.revisions.at(-1)!;
    let feedback = "";
    for (let attempt = 1; attempt <= (this.options.maxRepairAttempts ?? 3); attempt++) {
      t.attempt = attempt;
      await this.phase(
        active,
        "development",
        `实现已确认的需求和设计。保留已有未提交修改。不要提交、推送、发布或部署。检查当前代码后执行，必要命令需要用户审批。若 previousAttempt 存在，先核对失败原因和已有文件。tool_start / check_start 只表示开始请求，没有完成结果的副作用状态未知，必须核实；不要盲目重放历史命令。历史证据不代表本轮通过，修改后必须重新审查和验证。\n${context}\n本轮修复依据：${feedback}`,
      );
      active.cancel.signal.throwIfAborted();
      const current = await captureWorkspace(project.workdir);
      const fingerprint = current.fingerprint;
      t.changes = workspaceDiff(baseline, current);
      await this.phase(
        active,
        "review",
        `独立审查当前工作区实现是否满足 PRD/SDD 和验收项，关注真实错误、回归与缺失测试。基线中已有的修改须区分。必须调用 record_review 输出结论；没有发现问题时 findings 为空数组。\n${context}\n开发前基线：${JSON.stringify(t.baseline)}\n当前变更：${JSON.stringify(t.changes)}`,
        [],
        fingerprint,
      );
      if ((await workspaceFingerprint(project.workdir)) !== fingerprint)
        throw new Error("审查期间代码发生变化，本轮证据无效，请重新运行");
      const review = t.reviews.find((r) => r.attempt === attempt);
      if (!review) throw new Error("模型未提交结构化审查结果，不能判定完成");
      t.phase = "validation";
      this.save(t);
      for (const check of draft.checks) {
        active.cancel.signal.throwIfAborted();
        this.emit(t, "check_start", { command: check.command, kind: check.kind, attempt });
        const result = await runCommand(check.command, {
          cwd: project.workdir,
          timeoutSec: check.timeoutSec,
          signal: active.cancel.signal,
          maxOutputChars: 64_000,
        });
        t.checks.push({
          ...result,
          command: check.command,
          kind: check.kind,
          fingerprint,
          attempt,
        });
        this.emit(t, "check_result", t.checks.at(-1));
        this.save(t);
      }
      active.cancel.signal.throwIfAborted();
      if ((await workspaceFingerprint(project.workdir)) !== fingerprint) {
        throw new Error(
          "测试/打包修改了项目源文件或新增了非忽略文件，旧审查结果失效。请检查生成文件及 .gitignore 后重新运行",
        );
      }
      const checks = t.checks.filter((c) => c.attempt === attempt);
      if (review.findings.length === 0 && checks.every((c) => c.exitCode === 0 && !c.timedOut)) {
        t.verifiedFingerprint = fingerprint;
        t.status = "completed";
        t.phase = "completed";
        return;
      }
      feedback = JSON.stringify({ review, checks });
    }
    throw new Error("已达到自动修复上限；审查或验证仍未通过，请查看证据后继续");
  }

  private resumeContext(ownerId: string, taskId: string): unknown {
    const previous = this.get(ownerId, taskId);
    const receipts = this.events(ownerId, taskId)
      .filter((event) => {
        const data = event.data as { role?: string } | null;
        return (
          (event.type === "loop" && (data?.role === "tool_start" || data?.role === "tool")) ||
          event.type === "check_start" ||
          event.type === "check_result"
        );
      })
      .slice(-30)
      .map((event) => ({
        seq: event.seq,
        at: event.at,
        type: event.type,
        data: JSON.stringify(event.data).slice(0, 4000),
      }));
    return {
      id: previous.id,
      status: previous.status,
      phase: previous.phase,
      error: previous.error,
      reviews: previous.reviews,
      checks: previous.checks.map((check) => ({ ...check, output: check.output.slice(-4000) })),
      recentToolReceipts: receipts,
    };
  }

  private async phase(
    active: ActiveTask,
    phase: WorkbenchPhase,
    prompt: string,
    history: ChatMessage[] = [],
    fingerprint = "",
  ): Promise<void> {
    const task = active.task;
    const project = this.store.project(task.ownerId, task.projectId);
    active.cancel.signal.throwIfAborted();
    task.phase = phase;
    this.save(task);
    const tools = new ToolRegistry();
    registerFilesystemTools(tools, { rootDir: project.workdir, restrictToRoot: true });
    if (phase !== "development") {
      for (const spec of tools.specs())
        if (!tools.get(spec.function.name)?.readOnly) tools.unregister(spec.function.name);
    } else {
      registerShellTools(tools, { rootDir: project.workdir, requireApprovalForBuiltin: true });
      // Background commands would outlive the verification snapshot; keep them out of this workflow.
      for (const name of ["run_background", "job_output", "wait_for_job", "stop_job", "list_jobs"])
        tools.unregister(name);
    }
    // Keep file tools confined to the selected project. Path approvals never widen the scope.
    if (phase === "clarify") {
      tools.register({
        name: "record_requirements",
        readOnly: true,
        description:
          "保存 PRD/SDD 草案。先研究当前项目；模糊需求用 questions 明确待回答问题，禁止假定用户已确认。checks 必填，命令尚未确定时传 []，不要编造 echo/true 占位命令。验证命令不展开 *.tgz 等文件通配符。每轮可更新草案，但只有用户可确认。",
        parameters: z.toJSONSchema(draftSchema) as JSONSchema,
        fn: (draft: unknown) => {
          const current = this.store.version(task.ownerId, task.projectId, task.versionId);
          const updated = this.store.recordDraft(
            task.ownerId,
            task.projectId,
            task.versionId,
            current.revisions.length,
            draft,
          );
          this.emit(task, "requirements", updated.revisions.at(-1));
          return { revision: updated.revisions.length, confirmed: false };
        },
      });
    }
    if (phase === "review") {
      tools.register({
        name: "record_review",
        readOnly: true,
        description:
          "提交独立审查结果。每个问题包含文件、行号、触发条件和影响；没有问题时 findings 为空数组。",
        parameters: z.toJSONSchema(reviewSchema) as JSONSchema,
        fn: (raw: unknown) => {
          const review = reviewSchema.parse(raw);
          task.reviews = task.reviews.filter((r) => r.attempt !== task.attempt);
          task.reviews.push({ ...review, fingerprint, attempt: task.attempt });
          this.save(task);
          return { recorded: true };
        },
      });
    }
    const provider = loadActiveModelProvider(this.options.configPath);
    const client = this.options.client?.() ?? new DeepSeekClient(providerClientOptions(provider));
    const model = provider.model || FLASH_MODEL_ID;
    const system = workbenchPrompt(
      project.workdir,
      phase,
      tools.specs().map((spec) => spec.function.name),
    );
    const loop = new CacheFirstLoop({
      client,
      model,
      autoEscalate: false,
      tools,
      confirmationGate: active.gate,
      hookCwd: project.workdir,
      prefix: new ImmutablePrefix({ system, toolSpecs: tools.specs() }),
    });
    loop.log.extend(history);
    active.loop = loop;
    let completed = false;
    let assistantText = "";
    try {
      for await (const event of loop.step(prompt)) {
        active.cancel.signal.throwIfAborted();
        this.emit(task, "loop", event);
        if (event.stats) {
          task.usage = addTaskUsage(task.usage, event.stats, this.options.configPath);
          this.save(task);
          const reason = taskLimitReason(
            task.usage,
            task.limits ?? { budgetUsd: null, maxTokens: null },
          );
          if (reason) {
            active.cancel.abort();
            loop.abort();
            throw new Error(reason);
          }
        }
        if (event.forcedSummary)
          throw new Error("模型触发了执行上限，任务尚未完成，请检查记录后继续");
        if (event.role === "assistant_delta") assistantText += event.content;
        if (event.role === "error") throw new Error(event.error || "模型执行失败");
        if (event.role === "done") completed = true;
        if (event.role === "tool" || event.role === "assistant_final")
          this.saveHistory(task, phase, loop.log.toMessages());
      }
      active.cancel.signal.throwIfAborted();
      if (!completed) throw new Error("模型回合未正常结束，保留已有输出，请检查后继续");
    } finally {
      active.loop = undefined;
      this.saveHistory(task, phase, loop.log.toMessages());
      if (phase === "clarify" && assistantText)
        this.store.recordDialogue(task.ownerId, task.projectId, task.versionId, {
          role: "assistant",
          text: assistantText,
          taskId: task.id,
        });
    }
  }
  private saveHistory(task: WorkbenchTask, phase: WorkbenchPhase, messages: ChatMessage[]): void {
    atomicJson(join(this.taskDir, `${task.id}.${phase}.messages.json`), messages);
    if (phase === "clarify")
      this.store.recordMessages(task.ownerId, task.projectId, task.versionId, messages);
  }
  private save(task: WorkbenchTask): void {
    task.updatedAt = new Date().toISOString();
    atomicJson(join(this.taskDir, `${task.id}.json`), task);
    this.emit(task, "state", task);
  }
  private emit(task: WorkbenchTask, type: string, data: unknown): void {
    const seq =
      (this.sequences.get(task.id) ?? this.events(task.ownerId, task.id).at(-1)?.seq ?? 0) + 1;
    this.sequences.set(task.id, seq);
    const event = { seq, at: new Date().toISOString(), type, data: structuredClone(data) };
    appendFileSync(join(this.taskDir, `${task.id}.jsonl`), `${JSON.stringify(event)}\n`, {
      mode: 0o600,
    });
    const listeners = this.listeners.get(task.id);
    for (const listener of listeners ?? []) {
      try {
        listener(event);
      } catch {
        listeners?.delete(listener);
      }
    }
  }
}
