import { resolve } from "node:path";
import { executeConfiguredRollback } from "../../delivery/rollback.js";
import { approveProduction, rejectProduction } from "../../delivery/state-machine.js";
import { createDeliveryRun, listDeliveryRuns, loadDeliveryRun } from "../../delivery/store.js";
import { prepareDeliveryWorkspace } from "../../delivery/workspace.js";
import type { DashboardContext } from "../context.js";
import type { ApiResult } from "../router.js";

interface DeliveryRunnerState {
  status: "running" | "stopped" | "failed";
  startedAt: string;
  finishedAt?: string;
  error?: string;
}

const deliveryRunners = new Map<string, DeliveryRunnerState>();

function runnerKey(root: string, runId: string): string {
  return `${root}\0${runId}`;
}

function runnerState(root: string, runId: string): DeliveryRunnerState | null {
  return deliveryRunners.get(runnerKey(root, runId)) ?? null;
}

function parseBody(raw: string): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function workspaceRoot(ctx: DashboardContext): string | null {
  const cwd = ctx.getCurrentCwd?.();
  return cwd ? resolve(cwd) : null;
}

function stringField(body: Record<string, unknown>, name: string): string {
  const value = body[name];
  return typeof value === "string" ? value.trim() : "";
}

function integerField(body: Record<string, unknown>, name: string): number | undefined {
  const value = body[name];
  return typeof value === "number" && Number.isInteger(value) ? value : undefined;
}

export async function handleDelivery(
  method: string,
  rest: string[],
  rawBody: string,
  ctx: DashboardContext,
): Promise<ApiResult> {
  const root = workspaceRoot(ctx);
  if (!root) {
    return {
      status: 503,
      body: { error: "delivery requires an attached brown code workspace" },
    };
  }
  const runId = rest[0];
  const action = rest[1];
  const body = parseBody(rawBody);

  try {
    if (method === "GET" && !runId) {
      return { status: 200, body: { runs: listDeliveryRuns(root) } };
    }
    if (method === "POST" && !runId) {
      const title = stringField(body, "title");
      const requirement = stringField(body, "requirement");
      if (!title || !requirement) {
        return { status: 400, body: { error: "title and requirement are required" } };
      }
      const run = createDeliveryRun({
        id: stringField(body, "id") || undefined,
        title,
        requirement,
        workspaceRoot: root,
        maxDebugRetries: integerField(body, "maxDebugRetries"),
        maxIterations: integerField(body, "maxIterations"),
      });
      return { status: 201, body: { run } };
    }
    if (!runId) return { status: 404, body: { error: "delivery run id required" } };
    const run = loadDeliveryRun(root, runId);
    if (!run) return { status: 404, body: { error: `delivery run not found: ${runId}` } };

    if (method === "GET" && !action) {
      return { status: 200, body: { run, runner: runnerState(root, runId) } };
    }
    if (method === "GET" && action === "runner") {
      return { status: 200, body: { runner: runnerState(root, runId) } };
    }
    if (method !== "POST") return { status: 405, body: { error: "GET or POST only" } };

    if (action === "workspace") {
      prepareDeliveryWorkspace(run, {
        baseRef: stringField(body, "baseRef") || undefined,
        actor: stringField(body, "actor") || "web-user",
      });
      return { status: 200, body: { run } };
    }
    if (action === "run") {
      if (body.confirmUnattended !== true) {
        return {
          status: 400,
          body: {
            error: "explicit unattended file-edit and shell-command authorization is required",
          },
        };
      }
      const key = runnerKey(root, runId);
      if (deliveryRunners.get(key)?.status === "running") {
        return { status: 409, body: { error: `delivery runner is already active: ${runId}` } };
      }
      const state: DeliveryRunnerState = { status: "running", startedAt: new Date().toISOString() };
      deliveryRunners.set(key, state);
      const maxTurns = integerField(body, "maxTurns");
      const budgetUsd =
        typeof body.budgetUsd === "number" && Number.isFinite(body.budgetUsd)
          ? body.budgetUsd
          : undefined;
      const model = stringField(body, "model") || undefined;
      void import("../../cli/commands/delivery-run.js")
        .then(({ deliveryRunCommand }) =>
          deliveryRunCommand({
            runId,
            workspaceRoot: root,
            yolo: true,
            maxTurns,
            budgetUsd,
            model,
          }),
        )
        .then(() => {
          state.status = "stopped";
          state.finishedAt = new Date().toISOString();
        })
        .catch((error: unknown) => {
          state.status = "failed";
          state.error = error instanceof Error ? error.message : String(error);
          state.finishedAt = new Date().toISOString();
        });
      return { status: 202, body: { run, runner: state } };
    }
    if (action === "approve-production") {
      const actor = stringField(body, "actor");
      if (!actor) return { status: 400, body: { error: "human approval actor is required" } };
      approveProduction(run, actor, stringField(body, "comment") || undefined);
      return { status: 200, body: { run } };
    }
    if (action === "reject-production") {
      const actor = stringField(body, "actor");
      const comment = stringField(body, "comment");
      if (!actor || !comment) {
        return { status: 400, body: { error: "rejection actor and comment are required" } };
      }
      rejectProduction(run, actor, comment);
      return { status: 200, body: { run } };
    }
    if (action === "rollback-complete") {
      const actor = stringField(body, "actor");
      const summary = stringField(body, "summary");
      if (!actor || !summary) {
        return { status: 400, body: { error: "rollback actor and summary are required" } };
      }
      await executeConfiguredRollback(run, actor, summary);
      return { status: 200, body: { run } };
    }
    return { status: 404, body: { error: `unknown delivery action: ${action ?? ""}` } };
  } catch (error) {
    return { status: 409, body: { error: (error as Error).message } };
  }
}
