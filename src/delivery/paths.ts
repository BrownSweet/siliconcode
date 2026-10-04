import { join } from "node:path";

const SAFE_RUN_ID = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;

export function validateDeliveryRunId(id: string): string | null {
  if (!SAFE_RUN_ID.test(id)) {
    return "delivery run id must be 1-64 lowercase letters, digits, or interior hyphens";
  }
  return null;
}

export function deliveryRoot(workspaceRoot: string): string {
  return join(workspaceRoot, ".siliconcode", "delivery");
}

export function deliveryRunsRoot(workspaceRoot: string): string {
  return join(deliveryRoot(workspaceRoot), "runs");
}

export function deliveryRunDir(workspaceRoot: string, runId: string): string {
  const error = validateDeliveryRunId(runId);
  if (error) throw new Error(error);
  return join(deliveryRunsRoot(workspaceRoot), runId);
}

export function deliveryRunPath(workspaceRoot: string, runId: string): string {
  return join(deliveryRunDir(workspaceRoot, runId), "run.json");
}

export function deliveryEventsPath(workspaceRoot: string, runId: string): string {
  return join(deliveryRunDir(workspaceRoot, runId), "events.jsonl");
}

export function deliveryArtifactsDir(workspaceRoot: string, runId: string): string {
  return join(deliveryRunDir(workspaceRoot, runId), "artifacts");
}

export function deliveryArtifactPath(
  workspaceRoot: string,
  runId: string,
  filename: string,
): string {
  if (!/^[A-Z0-9][A-Z0-9._-]*\.md$/i.test(filename)) {
    throw new Error("delivery artifact filename must be a plain .md filename");
  }
  return join(deliveryArtifactsDir(workspaceRoot, runId), filename);
}
