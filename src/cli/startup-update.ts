import { spawn } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ReasonixConfig } from "../config.js";
import { t } from "../i18n/index.js";
import {
  type InstallSource,
  VERSION,
  compareVersions,
  detectInstallSource,
  detectNpmInstallPrefix,
  getLatestVersion,
} from "../version.js";
import { planUpdate } from "./commands/update.js";

const PACKAGE_MANAGER_SOURCES = new Set<InstallSource>(["npm", "bun", "pnpm", "yarn"]);

export interface StartupUpdateCheckGate {
  config: Pick<ReasonixConfig, "updateCheck">;
  env: Partial<Record<"SILICONCODE_NO_UPDATE_CHECK" | "CI", string>>;
  installSource: InstallSource;
  stdoutIsTTY: boolean;
}

export interface StartupUpdateHintOptions extends StartupUpdateCheckGate {
  current?: string;
  fetchLatest?: () => Promise<string | null>;
}

export interface CreateStartupUpdateCheckOptions {
  current?: string;
  env?: NodeJS.ProcessEnv;
  fetchLatest?: () => Promise<string | null>;
  installSource?: InstallSource;
  stdoutIsTTY?: boolean;
}

function envFlagEnabled(value: string | undefined): boolean {
  if (value === undefined) return false;
  const normalized = value.trim().toLowerCase();
  return normalized !== "" && normalized !== "0" && normalized !== "false";
}

export function shouldRunStartupUpdateCheck(input: StartupUpdateCheckGate): boolean {
  if (input.config.updateCheck === false) return false;
  if (!input.stdoutIsTTY) return false;
  if (envFlagEnabled(input.env.SILICONCODE_NO_UPDATE_CHECK)) return false;
  if (envFlagEnabled(input.env.CI)) return false;
  return PACKAGE_MANAGER_SOURCES.has(input.installSource);
}

export async function getStartupUpdateHint(opts: StartupUpdateHintOptions): Promise<string | null> {
  if (!shouldRunStartupUpdateCheck(opts)) return null;

  const current = opts.current ?? VERSION;
  const latest = await (opts.fetchLatest ?? (() => getLatestVersion()))();
  if (!latest) return null;
  if (compareVersions(current, latest) >= 0) return null;

  return t("startup.updateAvailable", { current, latest });
}

/** Auto-update is on by default; `config.autoUpdate: false` or SILICONCODE_DISABLE_AUTOUPDATE (REASONIX_ fallback) opts out. */
export function isAutoUpdateEnabled(
  config: Pick<ReasonixConfig, "autoUpdate">,
  env: NodeJS.ProcessEnv,
): boolean {
  if (config.autoUpdate === false) return false;
  return !envFlagEnabled(env.SILICONCODE_DISABLE_AUTOUPDATE ?? env.REASONIX_DISABLE_AUTOUPDATE);
}

// A background install that hangs (registry stall, prompt) must not dangle the promise forever.
const INSTALL_TIMEOUT_MS = 5 * 60 * 1000;
// Skip re-spawning an install for the same version within this window — dedupes a quit-mid-install
// relaunch (the running process keeps the old version until restart) so two installs can't race.
const ATTEMPT_TTL_MS = 10 * 60 * 1000;

function attemptMarkerPath(): string {
  return join(homedir(), ".siliconcode", "update-attempt.json");
}

function recentlyAttemptedDefault(version: string, now: number): boolean {
  try {
    const raw = JSON.parse(readFileSync(attemptMarkerPath(), "utf8")) as {
      version?: string;
      ts?: number;
    };
    return raw.version === version && typeof raw.ts === "number" && now - raw.ts < ATTEMPT_TTL_MS;
  } catch {
    return false; // missing/malformed marker → no recent attempt
  }
}

function markAttemptDefault(version: string, now: number): void {
  try {
    writeFileSync(attemptMarkerPath(), JSON.stringify({ version, ts: now }));
  } catch {
    /* best-effort — a failed write just means we may re-attempt sooner */
  }
}

// Background install that never writes to the TUI's stdio (inherited output would corrupt the Ink
// render), is detached + unref'd so it finishes if the user quits, and self-kills after a timeout.
function spawnBackgroundInstall(argv: string[]): Promise<number> {
  return new Promise((resolve) => {
    // argv is built by planUpdate from literal strings — no user input flows in.
    const child = spawn(argv[0]!, argv.slice(1), {
      stdio: "ignore",
      shell: process.platform === "win32",
      detached: true,
    });
    let settled = false;
    const finish = (code: number) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(code);
    };
    const timer = setTimeout(() => {
      try {
        child.kill();
      } catch {
        /* already gone */
      }
      finish(1);
    }, INSTALL_TIMEOUT_MS);
    timer.unref?.();
    child.once("error", () => finish(1));
    child.once("exit", (code) => finish(code ?? 1));
    child.unref();
  });
}

export interface RunStartupUpdateOptions extends StartupUpdateHintOptions {
  /** When true and the install source supports it, install the new version in the background. */
  autoUpdate: boolean;
  /** Test seam: pin the npm prefix instead of detecting it. */
  npmPrefix?: string | null;
  /** Test seam: override the background installer; resolves to an exit code. */
  spawnInstall?: (argv: string[]) => Promise<number>;
  /** Test seam: current epoch ms (drives the attempt-marker TTL). */
  now?: number;
  /** Test seam: has an install for this version been kicked off recently? Defaults to the on-disk marker. */
  recentlyAttempted?: (version: string) => boolean;
  /** Test seam: record that an install for this version was kicked off. Defaults to the on-disk marker. */
  markAttempt?: (version: string) => void;
  /** Receives each user-facing notice (installing → installed/failed, or the passive hint). */
  notify: (message: string) => void;
}

// Claude-style startup update: auto-install a newer version in the background and prompt restart;
// fall back to a passive hint when auto-update is off. No-op when the gate fails or nothing is newer.
export async function runStartupUpdate(opts: RunStartupUpdateOptions): Promise<void> {
  if (!shouldRunStartupUpdateCheck(opts)) return;
  const current = opts.current ?? VERSION;
  const latest = await (opts.fetchLatest ?? (() => getLatestVersion()))();
  if (!latest) return;
  if (compareVersions(current, latest) >= 0) return;

  if (opts.autoUpdate) {
    const now = opts.now ?? Date.now();
    const recentlyAttempted =
      opts.recentlyAttempted ?? ((v: string) => recentlyAttemptedDefault(v, now));
    // Another launch already kicked this install off (or it's mid-flight) — stay silent, don't race a second.
    if (recentlyAttempted(latest)) return;

    const npmPrefix =
      opts.npmPrefix ?? (opts.installSource === "npm" ? detectNpmInstallPrefix() : null);
    const plan = planUpdate({ current, latest, installSource: opts.installSource, npmPrefix });
    if (plan.action === "run-install" && plan.command) {
      (opts.markAttempt ?? ((v: string) => markAttemptDefault(v, now)))(latest);
      opts.notify(t("startup.updateInstalling", { current, latest }));
      const spawnInstall = opts.spawnInstall ?? spawnBackgroundInstall;
      let code = 1;
      try {
        code = await spawnInstall(plan.command);
      } catch {
        code = 1;
      }
      opts.notify(
        code === 0
          ? t("startup.updateInstalled", { latest })
          : t("startup.updateFailed", { latest }),
      );
      return;
    }
  }

  // Auto-update disabled (or no installable plan): fall back to the passive hint.
  opts.notify(t("startup.updateAvailable", { current, latest }));
}

export function createStartupUpdateCheck(
  config: ReasonixConfig,
  opts: CreateStartupUpdateCheckOptions = {},
): ((notify: (message: string) => void) => Promise<void>) | undefined {
  const env = opts.env ?? process.env;
  const installSource = opts.installSource ?? detectInstallSource();
  const stdoutIsTTY = opts.stdoutIsTTY ?? process.stdout.isTTY === true;
  const gate = { config, env, installSource, stdoutIsTTY };
  if (!shouldRunStartupUpdateCheck(gate)) return undefined;
  const autoUpdate = isAutoUpdateEnabled(config, env);

  return (notify) =>
    runStartupUpdate({
      ...gate,
      current: opts.current,
      fetchLatest: opts.fetchLatest,
      autoUpdate,
      notify,
    });
}
