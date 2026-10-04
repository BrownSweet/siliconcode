import { randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, isAbsolute, join } from "node:path";
import { z } from "zod";
import type { ChatMessage } from "../types.js";
import { projectDirectoryAccess } from "./directory-policy.js";

export class WorkbenchError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export function atomicJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temp = `${path}.${randomUUID()}.tmp`;
  writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  renameSync(temp, path);
}

export function readJson<T>(path: string, fallback: T): T {
  if (!existsSync(path)) return fallback;
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

const text = z.string().trim().min(1).max(100_000);
export const draftSchema = z.object({
  prd: text,
  sdd: text,
  acceptance: z.array(z.string().trim().min(1).max(4000)).min(1).max(100),
  questions: z.array(z.string().trim().min(1).max(4000)).max(20),
  checks: z
    .array(
      z.object({
        kind: z.enum(["test", "build"]),
        command: z.string().trim().min(1).max(4000),
        timeoutSec: z.number().int().min(1).max(600),
      }),
    )
    .max(20)
    .describe(
      "必填数组。命令尚未确定时传 []，不得使用 echo/true 占位。确认前需包含真实 test 和 build 命令。执行器不展开 *.tgz 等文件通配符，请用明确文件名或项目脚本。",
    ),
});
export const workbenchSettingsSchema = z.object({
  budgetUsd: z.number().positive().max(100_000).nullable().default(null),
  maxTokens: z.number().int().positive().max(1_000_000_000).nullable().default(null),
});
export type RequirementDraft = z.infer<typeof draftSchema>;
export interface RequirementRevision extends RequirementDraft {
  revision: number;
  createdAt: string;
}
export interface Project {
  id: string;
  ownerId: string;
  name: string;
  workdir: string;
  createdAt: string;
  workspace?: {
    parentProjectId: string;
    repositoryRoot: string;
    branch: string;
    parentBranch: string;
    baseCommit: string;
    mergedCommit?: string;
  };
}
export interface RequirementVersion {
  id: string;
  projectId: string;
  label: string;
  parentId?: string;
  requirement: string;
  title?: string;
  archivedAt?: string;
  createdAt: string;
  revisions: RequirementRevision[];
  confirmed?: { revision: number; at: string; actorId: string };
  messages: ChatMessage[];
  dialogue: Array<{ role: "user" | "assistant"; text: string; taskId: string }>;
}

/** One server owns this store. Changes are atomic and synchronous between awaits. */
export class WorkbenchStore {
  private projects: Project[];
  private versions: RequirementVersion[];
  constructor(readonly dataDir: string) {
    mkdirSync(dataDir, { recursive: true, mode: 0o700 });
    const formatPath = join(dataDir, "format.json");
    const format = readJson(formatPath, { schemaVersion: 1 });
    if (format.schemaVersion !== 1)
      throw new Error("不支持此工作台数据版本，请使用匹配版本恢复备份");
    this.projects = readJson(join(dataDir, "projects.json"), []);
    this.versions = readJson(join(dataDir, "requirements.json"), []);
    if (!Array.isArray(this.projects) || !Array.isArray(this.versions))
      throw new Error("工作台项目或需求记录格式无效，请从备份恢复");
    if (!existsSync(join(dataDir, "projects.json"))) atomicJson(join(dataDir, "projects.json"), []);
    if (!existsSync(join(dataDir, "requirements.json")))
      atomicJson(join(dataDir, "requirements.json"), []);
    if (!existsSync(formatPath)) atomicJson(formatPath, { schemaVersion: 1 });
  }

  listProjects(ownerId: string): Project[] {
    return structuredClone(this.projects.filter((p) => p.ownerId === ownerId));
  }
  settings() {
    return workbenchSettingsSchema.parse(readJson(join(this.dataDir, "settings.json"), {}));
  }
  saveSettings(value: unknown) {
    const settings = workbenchSettingsSchema.parse(value);
    atomicJson(join(this.dataDir, "settings.json"), settings);
    return settings;
  }

  project(ownerId: string, id: string): Project {
    const p = this.projects.find((p) => p.id === id && p.ownerId === ownerId);
    if (!p) throw new WorkbenchError(404, "项目不存在");
    // Reject a replaced/symlinked workdir, including after a server restart.
    if (
      !existsSync(p.workdir) ||
      realpathSync(p.workdir) !== p.workdir ||
      !statSync(p.workdir).isDirectory()
    ) {
      throw new WorkbenchError(409, "项目目录已移动或被替换，请重新添加项目");
    }
    return structuredClone(p);
  }

  validateProjectDirectory(workdir: string): string {
    if (!isAbsolute(workdir)) throw new WorkbenchError(400, "workdir 必须是服务端的绝对路径");
    let root: string;
    try {
      root = realpathSync(workdir);
      if (!statSync(root).isDirectory()) throw new Error("not directory");
    } catch {
      throw new WorkbenchError(400, "workdir 必须是已存在的目录");
    }
    const access = projectDirectoryAccess(root, this.dataDir);
    if (!access.selectable) {
      throw new WorkbenchError(400, access.reason);
    }
    return root;
  }

  addProject(ownerId: string, workdir: string, name?: string): Project {
    const root = this.validateProjectDirectory(workdir);
    const existing = this.projects.find((p) => p.ownerId === ownerId && p.workdir === root);
    if (existing) return structuredClone(existing);
    const p: Project = {
      id: randomUUID(),
      ownerId,
      workdir: root,
      name: name?.trim().slice(0, 120) || basename(root),
      createdAt: new Date().toISOString(),
    };
    this.projects.push(p);
    atomicJson(join(this.dataDir, "projects.json"), this.projects);
    return structuredClone(p);
  }

  setWorkspace(ownerId: string, projectId: string, workspace: NonNullable<Project["workspace"]>) {
    this.project(ownerId, projectId);
    const project = this.projects.find((p) => p.id === projectId)!;
    project.workspace = structuredClone(workspace);
    atomicJson(join(this.dataDir, "projects.json"), this.projects);
    return structuredClone(project);
  }

  listVersions(ownerId: string, projectId: string): RequirementVersion[] {
    this.project(ownerId, projectId);
    return structuredClone(this.versions.filter((v) => v.projectId === projectId));
  }

  version(ownerId: string, projectId: string, id: string): RequirementVersion {
    this.project(ownerId, projectId);
    const version = this.versions.find((v) => v.id === id && v.projectId === projectId);
    if (!version) throw new WorkbenchError(404, "需求版本不存在");
    return structuredClone(version);
  }

  createVersion(
    ownerId: string,
    projectId: string,
    input: { label: string; requirement: string; parentId?: string },
  ): RequirementVersion {
    this.project(ownerId, projectId);
    const label = z.string().trim().min(1).max(80).parse(input.label);
    const requirement = text.parse(input.requirement);
    if (this.versions.some((v) => v.projectId === projectId && v.label === label)) {
      throw new WorkbenchError(409, "该版本名称已存在");
    }
    if (input.parentId && !this.version(ownerId, projectId, input.parentId).confirmed) {
      throw new WorkbenchError(409, "升级必须基于已确认的需求版本");
    }
    const version: RequirementVersion = {
      id: randomUUID(),
      projectId,
      label,
      requirement,
      parentId: input.parentId,
      createdAt: new Date().toISOString(),
      revisions: [],
      messages: [],
      dialogue: [],
    };
    this.versions.push(version);
    this.save();
    return structuredClone(version);
  }

  updateVersionMetadata(
    ownerId: string,
    projectId: string,
    id: string,
    input: { title?: string; archived?: boolean },
  ): RequirementVersion {
    const version = this.version(ownerId, projectId, id);
    if (input.title !== undefined)
      version.title = z.string().trim().min(1).max(120).parse(input.title);
    if (input.archived !== undefined)
      version.archivedAt = input.archived ? new Date().toISOString() : undefined;
    this.replace(version);
    return structuredClone(version);
  }

  recordDraft(
    ownerId: string,
    projectId: string,
    id: string,
    expectedRevision: number,
    draft: unknown,
  ): RequirementVersion {
    const v = this.version(ownerId, projectId, id);
    if (v.confirmed) throw new WorkbenchError(409, "已确认文档不可修改，请创建下一版本");
    if (v.revisions.length !== expectedRevision)
      throw new WorkbenchError(409, "草案已更新，请刷新后重试");
    v.revisions.push({
      ...draftSchema.parse(draft),
      revision: expectedRevision + 1,
      createdAt: new Date().toISOString(),
    });
    this.replace(v);
    return v;
  }

  confirm(ownerId: string, projectId: string, id: string, revision: number): RequirementVersion {
    const v = this.version(ownerId, projectId, id);
    const draft = v.revisions.at(-1);
    if (!draft || revision !== draft.revision || v.confirmed)
      throw new WorkbenchError(409, "只能确认当前未确认的草案");
    if (draft.questions.length) throw new WorkbenchError(409, "还有待澄清问题，请先继续对话");
    if (
      !draft.checks.some((c) => c.kind === "test") ||
      !draft.checks.some((c) => c.kind === "build")
    ) {
      throw new WorkbenchError(409, "请先确定测试和打包命令");
    }
    v.confirmed = { revision, at: new Date().toISOString(), actorId: ownerId };
    this.replace(v);
    return v;
  }

  recordMessages(ownerId: string, projectId: string, id: string, messages: ChatMessage[]): void {
    const v = this.version(ownerId, projectId, id);
    v.messages = structuredClone(messages);
    this.replace(v);
  }

  recordDialogue(
    ownerId: string,
    projectId: string,
    id: string,
    entry: RequirementVersion["dialogue"][number],
  ): void {
    const v = this.version(ownerId, projectId, id);
    v.dialogue = [...(v.dialogue ?? []), entry];
    this.replace(v);
  }

  private replace(v: RequirementVersion): void {
    this.versions = this.versions.map((old) => (old.id === v.id ? v : old));
    this.save();
  }
  private save(): void {
    atomicJson(join(this.dataDir, "requirements.json"), this.versions);
  }
}
