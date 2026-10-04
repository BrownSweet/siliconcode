import { JobRegistry, type JobStartResult } from "../tools/jobs.js";
import { WorkbenchError, type WorkbenchStore } from "./store.js";

export function previewUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new WorkbenchError(400, "请输入有效的本机预览 URL");
  }
  if (
    !["http:", "https:"].includes(url.protocol) ||
    !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
    url.username ||
    url.password
  ) {
    throw new WorkbenchError(400, "预览地址只支持 localhost、127.0.0.1 或 ::1 的 HTTP(S) URL");
  }
  return url.href;
}

interface PreviewProcess {
  jobs: JobRegistry;
  started: Promise<JobStartResult>;
  url: string;
  command: string;
  jobId?: number;
}

/** One explicitly approved preview per project. Process ownership never comes from a client PID. */
export class WorkbenchPreviews {
  private readonly processes = new Map<string, PreviewProcess>();
  private closing = false;
  constructor(private readonly store: WorkbenchStore) {}

  isBusy(projectId: string): boolean {
    const process = this.processes.get(projectId);
    return Boolean(
      process && (process.jobId === undefined || process.jobs.read(process.jobId)?.running),
    );
  }

  get(owner: string, projectId: string) {
    this.store.project(owner, projectId);
    const process = this.processes.get(projectId);
    if (!process) return null;
    const job = process.jobId === undefined ? null : process.jobs.read(process.jobId);
    return {
      command: process.command,
      url: process.url,
      status: !job ? "starting" : job.running ? "running" : "exited",
      output: job?.output ?? "",
      exitCode: job?.exitCode ?? null,
      spawnError: job?.spawnError,
      pid: job?.pid ?? null,
    };
  }

  async start(owner: string, projectId: string, command: string, address: string) {
    const project = this.store.project(owner, projectId);
    if (this.closing) throw new WorkbenchError(409, "服务正在退出");
    if (this.isBusy(projectId)) throw new WorkbenchError(409, "请先停止当前预览");
    const url = previewUrl(address);
    const jobs = new JobRegistry();
    const process: PreviewProcess = {
      jobs,
      url,
      command,
      started: jobs.start(command, { cwd: project.workdir, waitSec: 0.5 }),
    };
    this.processes.set(projectId, process);
    try {
      process.jobId = (await process.started).jobId;
    } catch (err) {
      this.processes.delete(projectId);
      throw err;
    }
    return this.get(owner, projectId);
  }

  async stop(owner: string, projectId: string) {
    this.store.project(owner, projectId);
    const process = this.processes.get(projectId);
    if (process) await process.jobs.stop((await process.started).jobId);
    return this.get(owner, projectId);
  }

  async close() {
    this.closing = true;
    await Promise.all(
      [...this.processes.values()].map(async (process) => {
        try {
          await process.jobs.stop((await process.started).jobId);
        } catch {
          /* failed startup has no child */
        }
      }),
    );
  }
}
