import { createHash, randomUUID } from "node:crypto";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { basename, resolve } from "node:path";
import {
  deliveryArtifactPath,
  deliveryArtifactsDir,
  deliveryEventsPath,
  deliveryRunDir,
  deliveryRunPath,
  deliveryRunsRoot,
  validateDeliveryRunId,
} from "./paths.js";
import {
  type CreateDeliveryRunInput,
  DELIVERY_STAGE_ORDER,
  type DeliveryArtifact,
  type DeliveryArtifactKind,
  type DeliveryEvent,
  type DeliveryRun,
  type DeliveryStage,
  type DeliveryStageRecord,
} from "./types.js";

const ARTIFACT_FILENAMES: Record<DeliveryArtifactKind, string> = {
  prd: "PRD.md",
  sdd: "SDD.md",
  acceptance: "ACCEPTANCE.md",
  iteration_summary: "ITERATION-SUMMARY.md",
};

function artifactFilename(run: DeliveryRun, kind: DeliveryArtifactKind): string {
  return kind === "iteration_summary"
    ? `ITERATION-${run.iteration}-SUMMARY.md`
    : ARTIFACT_FILENAMES[kind];
}

function clampInteger(
  value: number | undefined,
  fallback: number,
  min: number,
  max: number,
): number {
  if (!Number.isInteger(value)) return fallback;
  return Math.max(min, Math.min(max, value as number));
}

function slug(value: string): string {
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return normalized || `delivery-${Date.now().toString(36)}`;
}

function uniqueRunId(workspaceRoot: string, preferred: string): string {
  let candidate = preferred;
  let suffix = 2;
  while (existsSync(deliveryRunDir(workspaceRoot, candidate))) {
    const tail = `-${suffix++}`;
    candidate = `${preferred.slice(0, 64 - tail.length)}${tail}`;
  }
  return candidate;
}

function stageRecord(stage: DeliveryStage, maxDebugRetries: number): DeliveryStageRecord {
  const retryable =
    stage === "development" ||
    stage === "validation" ||
    stage === "audit" ||
    stage === "acceptance_gate";
  return {
    stage,
    status: stage === "intake" ? "active" : "pending",
    attempts: 0,
    maxAttempts: retryable ? maxDebugRetries + 1 : 1,
    startedAt: stage === "intake" ? new Date().toISOString() : undefined,
    evidenceIds: [],
  };
}

function atomicWriteJson(path: string, value: unknown): void {
  const temp = `${path}.${process.pid}.${randomUUID()}.tmp`;
  writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  renameSync(temp, path);
}

export function createDeliveryRun(input: CreateDeliveryRunInput): DeliveryRun {
  const workspaceRoot = resolve(input.workspaceRoot);
  const title = input.title.trim();
  const requirement = input.requirement.trim();
  if (!title) throw new Error("delivery title is required");
  if (!requirement) throw new Error("delivery requirement is required");
  const requested = input.id?.trim() || slug(title);
  const idError = validateDeliveryRunId(requested);
  if (idError) throw new Error(idError);
  const id = uniqueRunId(workspaceRoot, requested);
  const maxDebugRetries = clampInteger(input.maxDebugRetries, 3, 0, 10);
  const maxIterations = clampInteger(input.maxIterations, 10, 1, 100);
  const now = new Date().toISOString();
  const stages = Object.fromEntries(
    DELIVERY_STAGE_ORDER.map((stage) => [stage, stageRecord(stage, maxDebugRetries)]),
  ) as Record<DeliveryStage, DeliveryStageRecord>;
  const run: DeliveryRun = {
    version: 1,
    id,
    title,
    requirement,
    workspaceRoot,
    status: "active",
    currentStage: "intake",
    iteration: 1,
    policy: {
      maxDebugRetries,
      maxIterations,
      requireIndependentAudit: true,
      requireHumanProductionApproval: true,
      autoRollbackOnCanaryFailure: true,
    },
    stages,
    artifacts: [],
    acceptanceCriteria: [],
    evidence: [],
    productionApproval: { status: "pending" },
    newIssues: [],
    createdAt: now,
    updatedAt: now,
  };
  mkdirSync(deliveryArtifactsDir(workspaceRoot, id), { recursive: true });
  saveDeliveryRun(run);
  appendDeliveryEvent(run, {
    type: "run_created",
    actor: "user",
    payload: { title, requirementLength: requirement.length },
  });
  return run;
}

export function loadDeliveryRun(workspaceRoot: string, runId: string): DeliveryRun | null {
  try {
    const raw = readFileSync(deliveryRunPath(resolve(workspaceRoot), runId), "utf8");
    const run = JSON.parse(raw) as DeliveryRun;
    return run.version === 1 ? run : null;
  } catch {
    return null;
  }
}

export function saveDeliveryRun(run: DeliveryRun): void {
  run.updatedAt = new Date().toISOString();
  const dir = deliveryRunDir(run.workspaceRoot, run.id);
  mkdirSync(dir, { recursive: true });
  atomicWriteJson(deliveryRunPath(run.workspaceRoot, run.id), run);
}

export function listDeliveryRuns(workspaceRoot: string): DeliveryRun[] {
  const root = deliveryRunsRoot(resolve(workspaceRoot));
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !validateDeliveryRunId(entry.name))
    .map((entry) => loadDeliveryRun(workspaceRoot, entry.name))
    .filter((run): run is DeliveryRun => run !== null)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function appendDeliveryEvent(
  run: DeliveryRun,
  input: Pick<DeliveryEvent, "type" | "actor" | "payload">,
): DeliveryEvent {
  const event: DeliveryEvent = {
    id: `evt-${randomUUID()}`,
    runId: run.id,
    type: input.type,
    actor: input.actor,
    createdAt: new Date().toISOString(),
    payload: input.payload,
  };
  mkdirSync(deliveryRunDir(run.workspaceRoot, run.id), { recursive: true });
  appendFileSync(
    deliveryEventsPath(run.workspaceRoot, run.id),
    `${JSON.stringify(event)}\n`,
    "utf8",
  );
  return event;
}

export function writeDeliveryArtifact(
  run: DeliveryRun,
  kind: DeliveryArtifactKind,
  content: string,
  actor = "prd-agent",
): DeliveryArtifact {
  const trimmed = content.trim();
  if (!trimmed) throw new Error(`${kind} artifact cannot be empty`);
  const filename = artifactFilename(run, kind);
  const path = deliveryArtifactPath(run.workspaceRoot, run.id, filename);
  mkdirSync(deliveryArtifactsDir(run.workspaceRoot, run.id), { recursive: true });
  writeFileSync(path, `${trimmed}\n`, "utf8");
  const artifact: DeliveryArtifact = {
    kind,
    iteration: run.iteration,
    path,
    sha256: createHash("sha256").update(`${trimmed}\n`).digest("hex"),
    updatedAt: new Date().toISOString(),
  };
  run.artifacts = [
    ...run.artifacts.filter(
      (entry) =>
        entry.kind !== kind || (kind === "iteration_summary" && entry.iteration !== run.iteration),
    ),
    artifact,
  ];
  saveDeliveryRun(run);
  appendDeliveryEvent(run, {
    type: "artifact_recorded",
    actor,
    payload: { kind, filename: basename(path), sha256: artifact.sha256 },
  });
  return artifact;
}
