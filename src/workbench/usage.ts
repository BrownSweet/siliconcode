import { type TurnStats, costUsd, pricingFor } from "../telemetry/stats.js";

export interface TaskUsage {
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  reportedRequests: number;
  unreportedRequests: number;
  estimatedCostUsd: number | null;
  models: string[];
}
export interface TaskLimits {
  budgetUsd: number | null;
  maxTokens: number | null;
}
export function addTaskUsage(
  previous: TaskUsage | undefined,
  stats: TurnStats,
  configPath: string,
): TaskUsage {
  const current: TaskUsage = previous ?? {
    inputTokens: 0,
    outputTokens: 0,
    cachedTokens: 0,
    reportedRequests: 0,
    unreportedRequests: 0,
    estimatedCostUsd: 0,
    models: [],
  };
  const u = stats.usage;
  const reported = u.promptTokens + u.completionTokens > 0;
  const estimated =
    reported && pricingFor(stats.model, configPath) ? costUsd(stats.model, u, configPath) : null;
  return {
    inputTokens: current.inputTokens + u.promptTokens,
    outputTokens: current.outputTokens + u.completionTokens,
    cachedTokens: current.cachedTokens + u.promptCacheHitTokens,
    reportedRequests: current.reportedRequests + Number(reported),
    unreportedRequests: current.unreportedRequests + Number(!reported),
    estimatedCostUsd:
      current.estimatedCostUsd === null || estimated === null
        ? null
        : current.estimatedCostUsd + estimated,
    models: [...new Set([...current.models, stats.model])],
  };
}
export function taskLimitReason(usage: TaskUsage, limits: TaskLimits): string | undefined {
  if (limits.maxTokens !== null && usage.unreportedRequests)
    return "模型未返回完整 Token 用量，无法核验任务上限，已停止继续执行。";
  if (limits.budgetUsd !== null && usage.estimatedCostUsd === null)
    return "模型用量或价格信息缺失，无法核验费用上限，已停止继续执行。";
  if (limits.maxTokens !== null && usage.inputTokens + usage.outputTokens >= limits.maxTokens)
    return "本次执行已达到 Token 上限，已保留记录并停止后续工具和模型请求。";
  if (
    limits.budgetUsd !== null &&
    usage.estimatedCostUsd !== null &&
    usage.estimatedCostUsd >= limits.budgetUsd
  )
    return "本次执行已达到估算费用上限，已保留记录并停止后续工具和模型请求。";
}
