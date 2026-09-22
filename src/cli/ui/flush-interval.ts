export function resolveFlushIntervalMs(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.SILICONCODE_FLUSH_MS ?? env.REASONIX_FLUSH_MS;
  if (!raw) return 50;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 16 || parsed > 1000) return 50;
  return Math.round(parsed);
}
