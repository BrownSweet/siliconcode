/** Durable autonomous-delivery workflow contracts. */

export const DELIVERY_STAGE_ORDER = [
  "intake",
  "acceptance",
  "workspace",
  "development",
  "validation",
  "audit",
  "acceptance_gate",
  "staging_deploy",
  "staging_verify",
  "production_approval",
  "canary_deploy",
  "observation",
  "iteration_review",
] as const;

export type DeliveryStage = (typeof DELIVERY_STAGE_ORDER)[number];

export type DeliveryRunStatus =
  | "active"
  | "awaiting_production_approval"
  | "rolling_back"
  | "rolled_back"
  | "failed"
  | "completed";

export type DeliveryStageStatus =
  | "pending"
  | "active"
  | "passed"
  | "failed"
  | "awaiting_approval"
  | "rolled_back";

export type DeliveryEvidenceKind =
  | "requirement"
  | "document"
  | "changes"
  | "test"
  | "audit"
  | "acceptance"
  | "deployment"
  | "health"
  | "regression"
  | "approval"
  | "observation"
  | "rollback"
  | "summary";

export interface DeliveryEvidence {
  id: string;
  iteration: number;
  stage: DeliveryStage | "rollback";
  kind: DeliveryEvidenceKind;
  outcome: "passed" | "failed" | "info";
  summary: string;
  actor: string;
  createdAt: string;
  metadata?: Record<string, unknown>;
}

export type DeliveryArtifactKind = "prd" | "sdd" | "acceptance" | "iteration_summary";

export interface DeliveryArtifact {
  kind: DeliveryArtifactKind;
  iteration: number;
  path: string;
  sha256: string;
  updatedAt: string;
}

export interface DeliveryAcceptanceCriterion {
  id: string;
  description: string;
  verification: string;
  status: "pending" | "passed" | "failed";
  evidence?: string;
}

export interface DeliveryStageRecord {
  stage: DeliveryStage;
  status: DeliveryStageStatus;
  attempts: number;
  maxAttempts: number;
  startedAt?: string;
  completedAt?: string;
  lastError?: string;
  evidenceIds: string[];
}

export interface DeliveryWorkspace {
  kind: "git-worktree";
  repositoryRoot: string;
  path: string;
  branch: string;
  baseRef: string;
  createdAt: string;
}

export interface DeliveryProductionApproval {
  status: "pending" | "approved" | "rejected";
  actor?: string;
  comment?: string;
  decidedAt?: string;
}

export interface DeliveryPolicy {
  maxDebugRetries: number;
  maxIterations: number;
  requireIndependentAudit: true;
  requireHumanProductionApproval: true;
  autoRollbackOnCanaryFailure: true;
}

export interface DeliveryRun {
  version: 1;
  id: string;
  title: string;
  requirement: string;
  workspaceRoot: string;
  status: DeliveryRunStatus;
  currentStage: DeliveryStage;
  iteration: number;
  policy: DeliveryPolicy;
  stages: Record<DeliveryStage, DeliveryStageRecord>;
  artifacts: DeliveryArtifact[];
  acceptanceCriteria: DeliveryAcceptanceCriterion[];
  evidence: DeliveryEvidence[];
  workspace?: DeliveryWorkspace;
  productionApproval: DeliveryProductionApproval;
  newIssues: string[];
  createdAt: string;
  updatedAt: string;
}

export interface DeliveryEvent {
  id: string;
  runId: string;
  type:
    | "run_created"
    | "artifact_recorded"
    | "evidence_recorded"
    | "stage_completed"
    | "stage_failed"
    | "retry_scheduled"
    | "workspace_created"
    | "production_approved"
    | "production_rejected"
    | "rollback_requested"
    | "rollback_completed"
    | "iteration_started"
    | "run_completed";
  actor: string;
  createdAt: string;
  payload: Record<string, unknown>;
}

export interface CreateDeliveryRunInput {
  id?: string;
  title: string;
  requirement: string;
  workspaceRoot: string;
  maxDebugRetries?: number;
  maxIterations?: number;
}
