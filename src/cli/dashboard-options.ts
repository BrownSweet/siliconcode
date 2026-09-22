import { readConfig } from "../config.js";

export function resolveDashboardHostEnv(env: NodeJS.ProcessEnv = process.env): string | undefined {
  return env.SILICONCODE_DASHBOARD_HOST ?? env.REASONIX_DASHBOARD_HOST;
}

export function resolveDashboardTokenEnv(env: NodeJS.ProcessEnv = process.env): string | undefined {
  return env.SILICONCODE_DASHBOARD_TOKEN ?? env.REASONIX_DASHBOARD_TOKEN;
}

/** Resolution order: flag -> env -> config.dashboard.host -> undefined. */
export function resolveDashboardHost(
  flagValue: string | undefined,
  noConfig: boolean,
): string | undefined {
  const fromFlag = flagValue?.trim();
  if (fromFlag) return fromFlag;
  const fromEnv = resolveDashboardHostEnv()?.trim();
  if (fromEnv) return fromEnv;
  if (noConfig) return undefined;
  const fromCfg = readConfig().dashboard?.host;
  return typeof fromCfg === "string" && fromCfg.trim() ? fromCfg.trim() : undefined;
}

/** Resolution order: env -> config.dashboard.token -> undefined. */
export function resolveDashboardToken(noConfig: boolean): string | undefined {
  const fromEnv = resolveDashboardTokenEnv()?.trim();
  const fromCfg = noConfig ? undefined : readConfig().dashboard?.token?.trim();
  const candidate = fromEnv || fromCfg;
  if (!candidate) return undefined;
  if (candidate.length < 16) {
    process.stderr.write(
      `▲ ignoring dashboard token (${candidate.length} chars; min 16) — using ephemeral per-boot token instead\n`,
    );
    return undefined;
  }
  return candidate;
}
