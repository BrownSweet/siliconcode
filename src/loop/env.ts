export function parsePositiveIntEnv(raw: string | undefined): number | undefined {
  if (!raw) return undefined;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

export function resolveStormThresholdEnv(env: NodeJS.ProcessEnv = process.env): number | undefined {
  return parsePositiveIntEnv(env.SILICONCODE_STORM_THRESHOLD ?? env.REASONIX_STORM_THRESHOLD);
}

export function resolveStormWindowEnv(env: NodeJS.ProcessEnv = process.env): number | undefined {
  return parsePositiveIntEnv(env.SILICONCODE_STORM_WINDOW ?? env.REASONIX_STORM_WINDOW);
}

export function resolveToolDispatchSerial(env: NodeJS.ProcessEnv = process.env): boolean {
  return (
    (env.SILICONCODE_TOOL_DISPATCH ?? env.REASONIX_TOOL_DISPATCH ?? "auto").toLowerCase() ===
    "serial"
  );
}

export function resolveParallelMaxEnv(env: NodeJS.ProcessEnv = process.env): number {
  const parsed = Number.parseInt(
    env.SILICONCODE_PARALLEL_MAX ?? env.REASONIX_PARALLEL_MAX ?? "",
    10,
  );
  return Number.isFinite(parsed) && parsed >= 1 ? Math.min(parsed, 16) : 3;
}
