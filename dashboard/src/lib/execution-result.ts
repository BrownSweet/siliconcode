import type { Task } from "../workbench-components.js";

export type ResultState =
  | "passed"
  | "failed"
  | "pending"
  | "unverified"
  | "waiting"
  | "running"
  | "interrupted"
  | "rolled_back";
type Label = { zh: string; en: string };
export interface ExecutionResult {
  scope: Label;
  status: ResultState;
  note: Label;
  rows: Array<{ label: Label; status: ResultState; detail?: string }>;
}
function state(value: string): ResultState {
  return (
    (
      {
        completed: "passed",
        active: "running",
        awaiting_production_approval: "waiting",
        waiting_for_approval: "waiting",
        awaiting_approval: "waiting",
      } as Record<string, ResultState>
    )[value] ??
    (["passed", "failed", "pending", "running", "interrupted", "rolled_back"].includes(value)
      ? (value as ResultState)
      : "unverified")
  );
}

export function workbenchResult(task: Task): ExecutionResult {
  const checks = task.checks.filter((entry) => entry.attempt === task.attempt);
  const review = task.reviews.find((entry) => entry.attempt === task.attempt);
  const fingerprint = task.verifiedFingerprint;
  const validReview = Boolean(
    fingerprint && review?.fingerprint === fingerprint && !review.findings.length,
  );
  const validChecks = Boolean(
    fingerprint &&
      checks.some((c) => c.kind === "test") &&
      checks.some((c) => c.kind === "build") &&
      checks.every((c) => c.fingerprint === fingerprint && c.exitCode === 0 && !c.timedOut),
  );
  const verified = validReview && validChecks;
  return {
    scope: {
      zh: task.kind === "clarify" ? "需求分析" : "本地开发",
      en: task.kind === "clarify" ? "Requirements" : "Local development",
    },
    status:
      task.status === "completed" && task.kind === "develop" && !verified
        ? "unverified"
        : state(task.status),
    note: {
      zh: "结果对应本次任务记录的文件快照；后续文件修改需重新验证。此流程未执行部署。",
      en: "Evidence applies to the recorded task snapshot; later edits need validation. This workflow does not deploy.",
    },
    rows: [
      {
        label: { zh: "独立审查", en: "Independent review" },
        status: review?.findings.length
          ? "failed"
          : validReview
            ? "passed"
            : review
              ? "unverified"
              : "pending",
      },
      {
        label: { zh: "测试与打包", en: "Tests and build" },
        status: checks.some((c) => c.timedOut || c.exitCode !== 0)
          ? "failed"
          : validChecks
            ? "passed"
            : checks.length
              ? "unverified"
              : "pending",
        detail: `${checks.filter((c) => !c.timedOut && c.exitCode === 0).length} / ${checks.length}`,
      },
    ],
  };
}

export interface DeliveryResultSource {
  status: string;
  iteration: number;
  stages: Record<string, { status: string; evidenceIds?: string[] }>;
  evidence?: Array<{ id: string; iteration: number; stage: string; kind: string; outcome: string }>;
}
export function deliveryResult(run: DeliveryResultSource): ExecutionResult {
  const stageResult = (stage: string): ResultState => {
    const record = run.stages[stage];
    if (!record) return "pending";
    if (record.status !== "passed") return state(record.status);
    return run.evidence?.some(
      (e) =>
        e.iteration === run.iteration &&
        e.stage === stage &&
        e.outcome === "passed" &&
        record.evidenceIds?.includes(e.id),
    )
      ? "passed"
      : "unverified";
  };
  const rows = [
    { label: { zh: "测试与打包", en: "Tests and build" }, status: stageResult("validation") },
    { label: { zh: "独立审查", en: "Independent review" }, status: stageResult("audit") },
    { label: { zh: "验收", en: "Acceptance" }, status: stageResult("acceptance_gate") },
    {
      label: { zh: "预发布验证", en: "Staging verification" },
      status: stageResult("staging_verify"),
    },
    {
      label: { zh: "生产审批", en: "Production approval" },
      status: stageResult("production_approval"),
    },
    { label: { zh: "金丝雀部署", en: "Canary deployment" }, status: stageResult("canary_deploy") },
    { label: { zh: "观察期", en: "Observation" }, status: stageResult("observation") },
  ];
  return {
    scope: { zh: "交付流程", en: "Delivery workflow" },
    status:
      run.status === "completed" && rows.some((r) => r.status !== "passed")
        ? "unverified"
        : state(run.status),
    note: {
      zh: "展示当前迭代记录的阶段证据；审批、部署和健康状态分别核对，不表示此刻线上健康。",
      en: "Recorded evidence for this iteration. Approval, deployment and health are distinct; this is not a live health check.",
    },
    rows,
  };
}
