import { afterEach, describe, expect, it } from "vitest";
import {
  getStartupUpdateHint,
  isAutoUpdateEnabled,
  runStartupUpdate,
  shouldRunStartupUpdateCheck,
} from "../src/cli/startup-update.js";
import { setLanguageRuntime } from "../src/i18n/index.js";

describe("startup update check", () => {
  afterEach(() => {
    setLanguageRuntime("EN");
  });

  it("runs only for interactive package-manager installs", () => {
    expect(
      shouldRunStartupUpdateCheck({
        config: {},
        env: {},
        installSource: "npm",
        stdoutIsTTY: true,
      }),
    ).toBe(true);

    expect(
      shouldRunStartupUpdateCheck({
        config: {},
        env: {},
        installSource: "unknown",
        stdoutIsTTY: true,
      }),
    ).toBe(false);

    expect(
      shouldRunStartupUpdateCheck({
        config: {},
        env: {},
        installSource: "npx",
        stdoutIsTTY: true,
      }),
    ).toBe(false);
  });

  it("respects config, env, CI, and non-TTY opt-outs", () => {
    expect(
      shouldRunStartupUpdateCheck({
        config: { updateCheck: false },
        env: {},
        installSource: "npm",
        stdoutIsTTY: true,
      }),
    ).toBe(false);

    expect(
      shouldRunStartupUpdateCheck({
        config: {},
        env: { SILICONCODE_NO_UPDATE_CHECK: "1" },
        installSource: "npm",
        stdoutIsTTY: true,
      }),
    ).toBe(false);

    expect(
      shouldRunStartupUpdateCheck({
        config: {},
        env: { CI: "true" },
        installSource: "npm",
        stdoutIsTTY: true,
      }),
    ).toBe(false);

    expect(
      shouldRunStartupUpdateCheck({
        config: {},
        env: {},
        installSource: "npm",
        stdoutIsTTY: false,
      }),
    ).toBe(false);
  });

  it("returns a compact Chinese update hint when npm latest is newer", async () => {
    setLanguageRuntime("zh-CN");

    const hint = await getStartupUpdateHint({
      config: {},
      current: "0.1.1",
      env: {},
      fetchLatest: async () => "0.1.2",
      installSource: "npm",
      stdoutIsTTY: true,
    });

    expect(hint).toContain("有新版本：0.1.1 → 0.1.2");
    expect(hint).toContain("brown update");
  });

  it("stays quiet when latest is missing or not newer", async () => {
    const common = {
      config: {},
      current: "0.1.1",
      env: {},
      installSource: "npm" as const,
      stdoutIsTTY: true,
    };

    await expect(
      getStartupUpdateHint({ ...common, fetchLatest: async () => null }),
    ).resolves.toBeNull();
    await expect(
      getStartupUpdateHint({ ...common, fetchLatest: async () => "0.1.1" }),
    ).resolves.toBeNull();
    await expect(
      getStartupUpdateHint({ ...common, fetchLatest: async () => "0.1.0" }),
    ).resolves.toBeNull();
  });

  it("isAutoUpdateEnabled defaults on and opts out via config or env (REASONIX fallback)", () => {
    expect(isAutoUpdateEnabled({}, {})).toBe(true);
    expect(isAutoUpdateEnabled({ autoUpdate: false }, {})).toBe(false);
    expect(isAutoUpdateEnabled({}, { SILICONCODE_DISABLE_AUTOUPDATE: "1" })).toBe(false);
    expect(isAutoUpdateEnabled({}, { REASONIX_DISABLE_AUTOUPDATE: "1" })).toBe(false);
    expect(isAutoUpdateEnabled({}, { SILICONCODE_DISABLE_AUTOUPDATE: "0" })).toBe(true);
  });

  const commonNpm = {
    config: {},
    current: "0.1.1",
    env: {},
    installSource: "npm" as const,
    stdoutIsTTY: true,
  };

  it("auto-installs in the background and tells the user to restart", async () => {
    setLanguageRuntime("zh-CN");
    const msgs: string[] = [];
    let ranArgv: string[] | null = null;
    await runStartupUpdate({
      ...commonNpm,
      autoUpdate: true,
      npmPrefix: null,
      fetchLatest: async () => "0.1.2",
      recentlyAttempted: () => false,
      markAttempt: () => {},
      spawnInstall: async (argv) => {
        ranArgv = argv;
        return 0;
      },
      notify: (m) => msgs.push(m),
    });
    expect(ranArgv).toEqual(["npm", "install", "-g", "@brownsweet/siliconcode@latest"]);
    expect(msgs[0]).toContain("正在后台更新 0.1.1 → 0.1.2");
    expect(msgs[1]).toContain("已更新至 0.1.2");
    expect(msgs[1]).toContain("重启");
  });

  it("falls back to a retry hint when the background install fails", async () => {
    const msgs: string[] = [];
    await runStartupUpdate({
      ...commonNpm,
      autoUpdate: true,
      npmPrefix: null,
      fetchLatest: async () => "0.1.2",
      recentlyAttempted: () => false,
      markAttempt: () => {},
      spawnInstall: async () => 1,
      notify: (m) => msgs.push(m),
    });
    expect(msgs[1]).toContain("brown update");
  });

  it("does not re-install when an attempt for the same version is recent", async () => {
    const msgs: string[] = [];
    let spawned = false;
    await runStartupUpdate({
      ...commonNpm,
      autoUpdate: true,
      npmPrefix: null,
      fetchLatest: async () => "0.1.2",
      recentlyAttempted: (v) => v === "0.1.2",
      markAttempt: () => {},
      spawnInstall: async () => {
        spawned = true;
        return 0;
      },
      notify: (m) => msgs.push(m),
    });
    expect(spawned).toBe(false);
    expect(msgs).toHaveLength(0);
  });

  it("only notifies (no install) when auto-update is disabled", async () => {
    const msgs: string[] = [];
    let spawned = false;
    await runStartupUpdate({
      ...commonNpm,
      autoUpdate: false,
      fetchLatest: async () => "0.1.2",
      spawnInstall: async () => {
        spawned = true;
        return 0;
      },
      notify: (m) => msgs.push(m),
    });
    expect(spawned).toBe(false);
    expect(msgs).toHaveLength(1);
    expect(msgs[0]).toContain("Update available");
  });

  it("does nothing when not newer or the gate fails", async () => {
    const msgs: string[] = [];
    await runStartupUpdate({
      ...commonNpm,
      autoUpdate: true,
      fetchLatest: async () => "0.1.1",
      notify: (m) => msgs.push(m),
    });
    await runStartupUpdate({
      ...commonNpm,
      stdoutIsTTY: false,
      autoUpdate: true,
      fetchLatest: async () => "0.1.2",
      notify: (m) => msgs.push(m),
    });
    expect(msgs).toHaveLength(0);
  });
});
