import { resolve } from "node:path";
import { codeSystemPrompt } from "../../code/prompt.js";
import { buildCodeToolset } from "../../code/setup.js";
import {
  loadApiKey,
  loadMaxOutputTokens,
  loadModel,
  loadPreset,
  loadProviderUserId,
  loadThinkingMode,
} from "../../config.js";
import {
  requireUnattendedDeliveryAuthorization,
  restrictPreWorkspaceTools,
} from "../../delivery/authorization.js";
import { deliveryConfigPath, loadDeliveryConfig } from "../../delivery/config.js";
import { acquireDeliveryRunLock } from "../../delivery/lock.js";
import { loadDeliveryRun } from "../../delivery/store.js";
import type { DeliveryRun } from "../../delivery/types.js";
import { loadDotenv } from "../../env.js";
import { CacheFirstLoop, DeepSeekClient, ImmutablePrefix } from "../../index.js";
import { migrateRetiredModel } from "../../models.js";
import { activeProviderClientOptions } from "../../provider-client-options.js";
import { SkillStore } from "../../skills.js";
import { appendUsage } from "../../telemetry/usage.js";
import { resolvePreset } from "../ui/presets.js";

export interface DeliveryRunCommandOptions {
  runId: string;
  workspaceRoot?: string;
  yolo?: boolean;
  maxTurns?: number;
  budgetUsd?: number;
  model?: string;
}

function requireRun(workspaceRoot: string, runId: string): DeliveryRun {
  const run = loadDeliveryRun(workspaceRoot, runId);
  if (!run) throw new Error(`delivery run not found: ${runId}`);
  return run;
}

function fingerprint(run: DeliveryRun): string {
  return JSON.stringify({
    status: run.status,
    currentStage: run.currentStage,
    iteration: run.iteration,
    evidence: run.evidence.length,
    artifacts: run.artifacts.length,
    acceptance: run.acceptanceCriteria.map((entry) => [entry.id, entry.status]),
  });
}

function stopReason(run: DeliveryRun): string | null {
  if (run.status === "completed") return "delivery completed";
  if (run.status === "failed") return "delivery failed; inspect the recorded stage error";
  if (run.status === "rolled_back") return "delivery rolled back safely";
  if (run.currentStage === "workspace") {
    return `human workspace gate: run brown delivery workspace ${run.id}`;
  }
  if (run.currentStage === "production_approval") {
    return `human production gate: run brown delivery approve-production ${run.id} --actor <name>`;
  }
  return null;
}

function resolveMaxTurns(value: number | undefined): number {
  if (!Number.isInteger(value)) return 20;
  return Math.max(1, Math.min(100, value as number));
}

export async function deliveryRunCommand(opts: DeliveryRunCommandOptions): Promise<void> {
  requireUnattendedDeliveryAuthorization(opts.yolo);
  const workspaceRoot = resolve(opts.workspaceRoot ?? process.cwd());
  let run = requireRun(workspaceRoot, opts.runId);
  const initialStop = stopReason(run);
  if (initialStop) {
    process.stdout.write(`${initialStop}\n`);
    return;
  }
  loadDotenv();
  const apiKey = loadApiKey();
  if (!apiKey) throw new Error("DeepSeek API key not configured; run brown setup first");
  process.env.DEEPSEEK_API_KEY = apiKey;
  const lock = acquireDeliveryRunLock(workspaceRoot, run.id);
  let toolset: Awaited<ReturnType<typeof buildCodeToolset>> | undefined;
  try {
    const agentRoot = run.workspace?.path ?? workspaceRoot;
    const deliveryConfig = loadDeliveryConfig(workspaceRoot);
    const modelSelection = migrateRetiredModel(
      opts.model ?? loadModel() ?? resolvePreset(loadPreset()).model,
    );
    toolset = await buildCodeToolset({
      rootDir: agentRoot,
      deliveryWorkspaceRoot: workspaceRoot,
      allowAll: true,
    });
    if (!run.workspace) restrictPreWorkspaceTools(toolset.tools);
    const deliverySkill = new SkillStore({ projectRoot: agentRoot }).read("delivery-orchestrator");
    const system = [
      codeSystemPrompt(agentRoot, {
        hasSemanticSearch: toolset.semantic.enabled,
        modelId: modelSelection.model,
      }),
      deliverySkill?.body ?? "",
      `\n# Active delivery\nRun id: ${run.id}\nState workspace: ${workspaceRoot}\nAgent workspace: ${agentRoot}`,
      deliveryConfig
        ? `# Validated delivery automation config\n${JSON.stringify(deliveryConfig, null, 2)}`
        : `# Delivery automation config\nMissing at ${deliveryConfigPath(workspaceRoot)}. Stop before validation/deployment and ask the user to run brown delivery init-config and replace every placeholder.`,
    ]
      .filter(Boolean)
      .join("\n\n");
    const client = new DeepSeekClient(activeProviderClientOptions());
    const loop = new CacheFirstLoop({
      client,
      prefix: new ImmutablePrefix({ system, toolSpecs: toolset.tools.specs() }),
      tools: toolset.tools,
      model: modelSelection.model,
      budgetUsd: opts.budgetUsd,
      thinkingMode: modelSelection.thinking ?? loadThinkingMode(),
      maxOutputTokens: loadMaxOutputTokens(),
      userId: loadProviderUserId(),
    });
    const maxTurns = resolveMaxTurns(opts.maxTurns);
    let noProgressTurns = 0;

    for (let turn = 1; turn <= maxTurns; turn++) {
      const before = fingerprint(run);
      const prompt = [
        `Continue delivery run ${run.id}.`,
        `Authoritative state: status=${run.status}, stage=${run.currentStage}, iteration=${run.iteration}.`,
        "Use delivery_status, perform the real work for the current stage, record observed evidence, and advance only when its gate is satisfied.",
        "Stop at a human gate or a genuine missing project configuration; never invent deployment commands or results.",
      ].join(" ");
      process.stdout.write(
        `\n[delivery ${run.id}] turn ${turn}/${maxTurns} · ${run.currentStage} · iteration ${run.iteration}\n`,
      );
      for await (const event of loop.step(prompt)) {
        if (event.role === "assistant_delta" && event.content) process.stdout.write(event.content);
        if (event.role === "tool") {
          process.stdout.write(`\n[tool ${event.toolName}] ${event.content}\n`);
        }
        if (event.role === "error") process.stderr.write(`\n[error] ${event.error}\n`);
        if (event.role === "assistant_final" && event.stats?.usage) {
          appendUsage({ session: null, model: event.stats.model, usage: event.stats.usage });
        }
      }
      run = requireRun(workspaceRoot, run.id);
      const reason = stopReason(run);
      if (reason) {
        process.stdout.write(`\n[delivery ${run.id}] ${reason}\n`);
        return;
      }
      if (fingerprint(run) === before) noProgressTurns += 1;
      else noProgressTurns = 0;
      if (noProgressTurns >= 2) {
        process.stdout.write(
          `\n[delivery ${run.id}] stopped after 2 turns without persisted progress at ${run.currentStage}; inspect the last agent output and project configuration.\n`,
        );
        return;
      }
    }
    process.stdout.write(
      `\n[delivery ${run.id}] stopped at maxTurns=${maxTurns}; state remains resumable at ${run.currentStage}.\n`,
    );
  } finally {
    await toolset?.jobs.shutdown();
    lock.release();
  }
}
