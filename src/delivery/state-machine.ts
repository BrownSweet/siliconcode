import { randomUUID } from "node:crypto";
import { type DeliveryAutomationConfig, loadDeliveryConfig } from "./config.js";
import { appendDeliveryEvent, saveDeliveryRun, writeDeliveryArtifact } from "./store.js";
import {
  DELIVERY_STAGE_ORDER,
  type DeliveryAcceptanceCriterion,
  type DeliveryEvidence,
  type DeliveryEvidenceKind,
  type DeliveryRun,
  type DeliveryStage,
  type DeliveryWorkspace,
} from "./types.js";

export interface RecordEvidenceInput {
  stage?: DeliveryStage | "rollback";
  kind: DeliveryEvidenceKind;
  outcome: "passed" | "failed" | "info";
  summary: string;
  actor: string;
  metadata?: Record<string, unknown>;
}

export class DeliveryTransitionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DeliveryTransitionError";
  }
}

function evidenceFor(run: DeliveryRun, stage: DeliveryStage): DeliveryEvidence[] {
  const activeIds = new Set(run.stages[stage].evidenceIds);
  return run.evidence.filter(
    (entry) =>
      entry.iteration === run.iteration && entry.stage === stage && activeIds.has(entry.id),
  );
}

function passedEvidence(
  run: DeliveryRun,
  stage: DeliveryStage,
  kind: DeliveryEvidenceKind,
): DeliveryEvidence[] {
  return evidenceFor(run, stage).filter(
    (entry) => entry.kind === kind && entry.outcome === "passed",
  );
}

function requireArtifact(run: DeliveryRun, kind: "prd" | "sdd" | "acceptance"): void {
  if (!run.artifacts.some((artifact) => artifact.kind === kind)) {
    throw new DeliveryTransitionError(
      `${run.currentStage}: missing ${kind.toUpperCase()} artifact`,
    );
  }
}

function requirePassedEvidence(
  run: DeliveryRun,
  stage: DeliveryStage,
  kind: DeliveryEvidenceKind,
  message: string,
): DeliveryEvidence[] {
  const matches = passedEvidence(run, stage, kind);
  if (matches.length === 0) throw new DeliveryTransitionError(message);
  return matches;
}

function requireAutomationConfig(run: DeliveryRun): DeliveryAutomationConfig {
  try {
    const config = loadDeliveryConfig(run.workspaceRoot);
    if (!config) {
      throw new Error("run brown delivery init-config and replace every placeholder");
    }
    return config;
  } catch (error) {
    throw new DeliveryTransitionError(
      `${run.currentStage}: valid delivery automation config required: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function requirePassedCommands(
  run: DeliveryRun,
  stage: DeliveryStage,
  kind: DeliveryEvidenceKind,
  expected: readonly string[],
): DeliveryEvidence[] {
  const evidence = requirePassedEvidence(
    run,
    stage,
    kind,
    `${stage}: passing ${kind} command evidence is required`,
  );
  const passed = new Set(
    evidence
      .filter((entry) => entry.metadata?.exitCode === 0)
      .map((entry) => entry.metadata?.command)
      .filter((entry): entry is string => typeof entry === "string"),
  );
  const missing = expected.filter((command) => !passed.has(command));
  if (missing.length > 0) {
    throw new DeliveryTransitionError(
      `${stage}: missing successful configured command evidence: ${missing.join(", ")}`,
    );
  }
  return evidence;
}

function auditDimension(entry: DeliveryEvidence): string | undefined {
  const raw = entry.metadata?.dimension;
  return typeof raw === "string" ? raw : undefined;
}

function validateStageEvidence(run: DeliveryRun, stage: DeliveryStage): void {
  switch (stage) {
    case "intake":
      requireArtifact(run, "prd");
      requireArtifact(run, "sdd");
      return;
    case "acceptance":
      requireArtifact(run, "acceptance");
      if (run.acceptanceCriteria.length === 0) {
        throw new DeliveryTransitionError(
          "acceptance: at least one verifiable criterion is required",
        );
      }
      return;
    case "workspace":
      if (!run.workspace || run.workspace.kind !== "git-worktree") {
        throw new DeliveryTransitionError("workspace: an isolated git worktree is required");
      }
      return;
    case "development":
      requirePassedEvidence(
        run,
        stage,
        "changes",
        "development: record passed changes evidence before advancing",
      );
      return;
    case "validation": {
      const config = requireAutomationConfig(run);
      requirePassedCommands(run, stage, "test", config.validationCommands);
      return;
    }
    case "audit": {
      const audit = requirePassedEvidence(
        run,
        stage,
        "audit",
        "audit: independent audit evidence is required",
      );
      const required = new Set(["code", "security", "dependencies", "configuration"]);
      for (const entry of audit) {
        const dimension = auditDimension(entry);
        if (dimension) required.delete(dimension);
      }
      if (required.size > 0) {
        throw new DeliveryTransitionError(
          `audit: missing passing dimensions: ${[...required].join(", ")}`,
        );
      }
      if (audit.some((entry) => entry.metadata?.independent !== true)) {
        throw new DeliveryTransitionError("audit: every audit dimension must be independent=true");
      }
      const expectedActors: Record<string, string> = {
        code: "reviewer-code",
        security: "reviewer-security",
        dependencies: "reviewer-dependencies",
        configuration: "reviewer-configuration",
      };
      const expectedSkills: Record<string, string> = {
        code: "review",
        security: "security-review",
        dependencies: "dependency-review",
        configuration: "configuration-review",
      };
      for (const entry of audit) {
        const dimension = auditDimension(entry);
        if (dimension && expectedActors[dimension] && entry.actor !== expectedActors[dimension]) {
          throw new DeliveryTransitionError(
            `audit: ${dimension} evidence must be recorded by ${expectedActors[dimension]}`,
          );
        }
        if (
          dimension &&
          expectedSkills[dimension] &&
          entry.metadata?.skill !== expectedSkills[dimension]
        ) {
          throw new DeliveryTransitionError(
            `audit: ${dimension} evidence must come from the ${expectedSkills[dimension]} skill`,
          );
        }
      }
      const changeActors = new Set(
        passedEvidence(run, "development", "changes").map((entry) => entry.actor),
      );
      if (audit.some((entry) => changeActors.has(entry.actor))) {
        throw new DeliveryTransitionError(
          "audit: the development actor cannot approve its own audit",
        );
      }
      return;
    }
    case "acceptance_gate":
      if (run.acceptanceCriteria.some((criterion) => criterion.status !== "passed")) {
        throw new DeliveryTransitionError(
          "acceptance_gate: every acceptance criterion must have passing evidence",
        );
      }
      requirePassedEvidence(
        run,
        stage,
        "acceptance",
        "acceptance_gate: record a passing acceptance result",
      );
      return;
    case "staging_deploy": {
      const config = requireAutomationConfig(run);
      const evidence = requirePassedCommands(run, stage, "deployment", [
        config.staging.deployCommand,
      ]);
      if (!evidence.some((entry) => entry.metadata?.environment === "staging")) {
        throw new DeliveryTransitionError("staging_deploy: environment must be staging");
      }
      return;
    }
    case "staging_verify": {
      const config = requireAutomationConfig(run);
      requirePassedCommands(run, stage, "health", config.staging.healthCheckCommands);
      requirePassedCommands(run, stage, "regression", config.staging.regressionCommands);
      return;
    }
    case "production_approval":
      throw new DeliveryTransitionError(
        "production_approval: only an explicit human approval command or Web action can advance this gate",
      );
    case "canary_deploy": {
      const config = requireAutomationConfig(run);
      const expectedCommand = config.production.canaryDeployCommand.replaceAll(
        "{percent}",
        String(config.production.canaryPercent),
      );
      const evidence = requirePassedCommands(run, stage, "deployment", [expectedCommand]);
      if (
        !evidence.some((entry) => {
          return (
            entry.metadata?.environment === "production" &&
            entry.metadata?.canaryPercent === config.production.canaryPercent
          );
        })
      ) {
        throw new DeliveryTransitionError(
          "canary_deploy: production evidence with canaryPercent between 1 and 99 is required",
        );
      }
      return;
    }
    case "observation": {
      const config = requireAutomationConfig(run);
      const evidence = requirePassedCommands(
        run,
        stage,
        "observation",
        config.production.observationCommands,
      );
      if (
        !evidence.some(
          (entry) =>
            typeof entry.metadata?.windowSeconds === "number" &&
            entry.metadata.windowSeconds >= config.production.observationWindowSeconds,
        )
      ) {
        throw new DeliveryTransitionError(
          `observation: evidence must cover at least ${config.production.observationWindowSeconds} seconds`,
        );
      }
      return;
    }
    case "iteration_review":
      requirePassedEvidence(
        run,
        stage,
        "summary",
        "iteration_review: record results and new issues before finishing the iteration",
      );
      if (
        !run.artifacts.some(
          (artifact) =>
            artifact.kind === "iteration_summary" && artifact.iteration === run.iteration,
        )
      ) {
        throw new DeliveryTransitionError("iteration_review: missing iteration summary artifact");
      }
  }
}

function activate(run: DeliveryRun, stage: DeliveryStage): void {
  const record = run.stages[stage];
  record.status = stage === "production_approval" ? "awaiting_approval" : "active";
  record.startedAt = new Date().toISOString();
  record.completedAt = undefined;
  record.lastError = undefined;
  run.currentStage = stage;
  run.status = stage === "production_approval" ? "awaiting_production_approval" : "active";
}

function nextStage(stage: DeliveryStage): DeliveryStage | null {
  const index = DELIVERY_STAGE_ORDER.indexOf(stage);
  return index < 0 || index === DELIVERY_STAGE_ORDER.length - 1
    ? null
    : (DELIVERY_STAGE_ORDER[index + 1] ?? null);
}

export function recordDeliveryEvidence(
  run: DeliveryRun,
  input: RecordEvidenceInput,
): DeliveryEvidence {
  const summary = input.summary.trim();
  const actor = input.actor.trim();
  if (!summary) throw new DeliveryTransitionError("evidence summary is required");
  if (!actor) throw new DeliveryTransitionError("evidence actor is required");
  const stage = input.stage ?? run.currentStage;
  if (stage !== "rollback" && stage !== run.currentStage) {
    throw new DeliveryTransitionError(
      `cannot record evidence for ${stage}; current stage is ${run.currentStage}`,
    );
  }
  const evidence: DeliveryEvidence = {
    id: `evidence-${randomUUID()}`,
    iteration: run.iteration,
    stage,
    kind: input.kind,
    outcome: input.outcome,
    summary,
    actor,
    createdAt: new Date().toISOString(),
    metadata: input.metadata,
  };
  run.evidence.push(evidence);
  if (stage !== "rollback") run.stages[stage].evidenceIds.push(evidence.id);
  saveDeliveryRun(run);
  appendDeliveryEvent(run, {
    type: "evidence_recorded",
    actor,
    payload: { evidenceId: evidence.id, stage, kind: input.kind, outcome: input.outcome },
  });
  return evidence;
}

export function recordDeliveryDocuments(
  run: DeliveryRun,
  input: {
    prd: string;
    sdd: string;
    acceptance: string;
    criteria: Array<Pick<DeliveryAcceptanceCriterion, "id" | "description" | "verification">>;
    actor?: string;
  },
): void {
  if (run.currentStage !== "intake" && run.currentStage !== "acceptance") {
    throw new DeliveryTransitionError(
      `documents can only be recorded during intake/acceptance; current stage is ${run.currentStage}`,
    );
  }
  const ids = new Set<string>();
  const criteria = input.criteria.map((criterion) => {
    const id = criterion.id.trim();
    const description = criterion.description.trim();
    const verification = criterion.verification.trim();
    if (!id || !description || !verification) {
      throw new DeliveryTransitionError(
        "every acceptance criterion needs id, description, and verification",
      );
    }
    if (ids.has(id)) throw new DeliveryTransitionError(`duplicate acceptance criterion: ${id}`);
    ids.add(id);
    return { id, description, verification, status: "pending" as const };
  });
  if (criteria.length === 0) {
    throw new DeliveryTransitionError("at least one acceptance criterion is required");
  }
  const actor = input.actor?.trim() || "prd-agent";
  writeDeliveryArtifact(run, "prd", input.prd, actor);
  writeDeliveryArtifact(run, "sdd", input.sdd, actor);
  writeDeliveryArtifact(run, "acceptance", input.acceptance, actor);
  run.acceptanceCriteria = criteria;
  saveDeliveryRun(run);
}

export function setDeliveryWorkspace(
  run: DeliveryRun,
  workspace: DeliveryWorkspace,
  actor = "user",
): void {
  if (run.currentStage !== "workspace") {
    throw new DeliveryTransitionError(
      `workspace can only be attached during workspace stage; current stage is ${run.currentStage}`,
    );
  }
  run.workspace = workspace;
  saveDeliveryRun(run);
  appendDeliveryEvent(run, {
    type: "workspace_created",
    actor,
    payload: { path: workspace.path, branch: workspace.branch, baseRef: workspace.baseRef },
  });
}

export function updateAcceptanceCriterion(
  run: DeliveryRun,
  criterionId: string,
  status: "passed" | "failed",
  evidence: string,
): void {
  if (run.currentStage !== "acceptance_gate") {
    throw new DeliveryTransitionError("acceptance results can only be set at acceptance_gate");
  }
  const criterion = run.acceptanceCriteria.find((entry) => entry.id === criterionId);
  if (!criterion) throw new DeliveryTransitionError(`unknown acceptance criterion: ${criterionId}`);
  if (!evidence.trim()) throw new DeliveryTransitionError("acceptance evidence is required");
  criterion.status = status;
  criterion.evidence = evidence.trim();
  saveDeliveryRun(run);
}

export function completeDeliveryStage(run: DeliveryRun, actor: string): void {
  if (run.status === "completed" || run.status === "rolled_back") {
    throw new DeliveryTransitionError(`run is terminal: ${run.status}`);
  }
  const stage = run.currentStage;
  validateStageEvidence(run, stage);
  const record = run.stages[stage];
  record.status = "passed";
  record.completedAt = new Date().toISOString();
  record.lastError = undefined;
  appendDeliveryEvent(run, {
    type: "stage_completed",
    actor,
    payload: { stage, iteration: run.iteration },
  });
  const next = nextStage(stage);
  if (!next) {
    run.status = "completed";
    saveDeliveryRun(run);
    appendDeliveryEvent(run, {
      type: "run_completed",
      actor,
      payload: { iteration: run.iteration },
    });
    return;
  }
  activate(run, next);
  saveDeliveryRun(run);
}

export function failDeliveryStage(run: DeliveryRun, error: string, actor: string): void {
  const stage = run.currentStage;
  const record = run.stages[stage];
  record.attempts += 1;
  record.status = "failed";
  record.lastError = error.trim() || "stage failed";
  appendDeliveryEvent(run, {
    type: "stage_failed",
    actor,
    payload: { stage, error: record.lastError, attempt: record.attempts },
  });

  if (
    (stage === "validation" || stage === "audit" || stage === "acceptance_gate") &&
    record.attempts < record.maxAttempts
  ) {
    for (const resetStage of DELIVERY_STAGE_ORDER.slice(
      DELIVERY_STAGE_ORDER.indexOf("development"),
    )) {
      if (resetStage === "production_approval") {
        run.stages[resetStage].status = "pending";
      } else if (resetStage !== stage) {
        run.stages[resetStage].status = "pending";
      }
      run.stages[resetStage].completedAt = undefined;
      run.stages[resetStage].evidenceIds = [];
    }
    for (const criterion of run.acceptanceCriteria) {
      criterion.status = "pending";
      criterion.evidence = undefined;
    }
    run.productionApproval = { status: "pending" };
    activate(run, "development");
    appendDeliveryEvent(run, {
      type: "retry_scheduled",
      actor,
      payload: { failedStage: stage, nextStage: "development", attempt: record.attempts + 1 },
    });
  } else if (stage === "canary_deploy" || stage === "observation") {
    run.status = "rolling_back";
    appendDeliveryEvent(run, {
      type: "rollback_requested",
      actor,
      payload: { failedStage: stage, reason: record.lastError },
    });
  } else {
    run.status = "failed";
  }
  saveDeliveryRun(run);
}

export function approveProduction(run: DeliveryRun, actor: string, comment?: string): void {
  if (run.currentStage !== "production_approval") {
    throw new DeliveryTransitionError(`production approval is unavailable at ${run.currentStage}`);
  }
  if (!actor.trim()) throw new DeliveryTransitionError("approval actor is required");
  const now = new Date().toISOString();
  run.productionApproval = {
    status: "approved",
    actor: actor.trim(),
    comment: comment?.trim() || undefined,
    decidedAt: now,
  };
  const record = run.stages.production_approval;
  record.status = "passed";
  record.completedAt = now;
  const evidence = recordDeliveryEvidence(run, {
    stage: "production_approval",
    kind: "approval",
    outcome: "passed",
    summary: comment?.trim() || "Human approved production deployment",
    actor: actor.trim(),
    metadata: { human: true },
  });
  void evidence;
  activate(run, "canary_deploy");
  saveDeliveryRun(run);
  appendDeliveryEvent(run, {
    type: "production_approved",
    actor: actor.trim(),
    payload: { comment: comment?.trim() || "" },
  });
}

export function rejectProduction(run: DeliveryRun, actor: string, comment: string): void {
  if (run.currentStage !== "production_approval") {
    throw new DeliveryTransitionError(`production approval is unavailable at ${run.currentStage}`);
  }
  if (!actor.trim() || !comment.trim()) {
    throw new DeliveryTransitionError("rejection actor and comment are required");
  }
  run.productionApproval = {
    status: "rejected",
    actor: actor.trim(),
    comment: comment.trim(),
    decidedAt: new Date().toISOString(),
  };
  run.stages.production_approval.status = "failed";
  run.status = "failed";
  saveDeliveryRun(run);
  appendDeliveryEvent(run, {
    type: "production_rejected",
    actor: actor.trim(),
    payload: { comment: comment.trim() },
  });
}

export function completeRollback(run: DeliveryRun, actor: string, summary: string): void {
  if (run.status !== "rolling_back") {
    throw new DeliveryTransitionError(`rollback is unavailable while run is ${run.status}`);
  }
  const config = requireAutomationConfig(run);
  const passedRollbackEvidence = run.evidence.filter(
    (entry) =>
      entry.iteration === run.iteration &&
      entry.stage === "rollback" &&
      entry.outcome === "passed" &&
      entry.metadata?.exitCode === 0,
  );
  const rollbackCommands = new Set(
    passedRollbackEvidence
      .filter((entry) => entry.kind === "rollback")
      .map((entry) => entry.metadata?.command),
  );
  if (!rollbackCommands.has(config.production.rollbackCommand)) {
    throw new DeliveryTransitionError("rollback: configured rollback command has not passed");
  }
  const healthCommands = new Set(
    passedRollbackEvidence
      .filter((entry) => entry.kind === "health")
      .map((entry) => entry.metadata?.command),
  );
  const missingHealth = config.production.postRollbackHealthCheckCommands.filter(
    (command) => !healthCommands.has(command),
  );
  if (missingHealth.length > 0) {
    throw new DeliveryTransitionError(
      `rollback: missing passing post-rollback health commands: ${missingHealth.join(", ")}`,
    );
  }
  recordDeliveryEvidence(run, {
    stage: "rollback",
    kind: "rollback",
    outcome: "passed",
    summary: summary.trim() || "Configured rollback and post-rollback health checks passed",
    actor,
  });
  run.status = "rolled_back";
  run.stages[run.currentStage].status = "rolled_back";
  saveDeliveryRun(run);
  appendDeliveryEvent(run, {
    type: "rollback_completed",
    actor,
    payload: { stage: run.currentStage, summary },
  });
}

export function finishDeliveryIteration(
  run: DeliveryRun,
  input: { summary: string; newIssues: string[]; actor: string },
): void {
  if (run.currentStage !== "iteration_review") {
    throw new DeliveryTransitionError(`iteration review is unavailable at ${run.currentStage}`);
  }
  const newIssues = input.newIssues.map((issue) => issue.trim()).filter(Boolean);
  writeDeliveryArtifact(run, "iteration_summary", input.summary, input.actor);
  run.newIssues = newIssues;
  recordDeliveryEvidence(run, {
    kind: "summary",
    outcome: "passed",
    summary: `Iteration ${run.iteration} recorded with ${newIssues.length} new issue(s)`,
    actor: input.actor,
    metadata: { newIssues },
  });
  validateStageEvidence(run, "iteration_review");
  run.stages.iteration_review.status = "passed";
  run.stages.iteration_review.completedAt = new Date().toISOString();
  if (newIssues.length === 0) {
    run.status = "completed";
    saveDeliveryRun(run);
    appendDeliveryEvent(run, {
      type: "run_completed",
      actor: input.actor,
      payload: { iteration: run.iteration },
    });
    return;
  }
  if (run.iteration >= run.policy.maxIterations) {
    run.status = "failed";
    saveDeliveryRun(run);
    return;
  }
  run.iteration += 1;
  run.productionApproval = { status: "pending" };
  for (const criterion of run.acceptanceCriteria) {
    criterion.status = "pending";
    criterion.evidence = undefined;
  }
  for (const stage of DELIVERY_STAGE_ORDER.slice(DELIVERY_STAGE_ORDER.indexOf("development"))) {
    const record = run.stages[stage];
    record.status = "pending";
    record.startedAt = undefined;
    record.completedAt = undefined;
    record.lastError = undefined;
    record.evidenceIds = [];
    record.attempts = 0;
  }
  activate(run, "development");
  saveDeliveryRun(run);
  appendDeliveryEvent(run, {
    type: "iteration_started",
    actor: input.actor,
    payload: { iteration: run.iteration, issues: newIssues },
  });
}
