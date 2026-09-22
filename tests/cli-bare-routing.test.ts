/** Bare `brown` routing — defaults to code mode in the current directory; explicit `chat` stays chat. */

import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HEAP_REEXEC_ENV } from "../src/cli/heap-limit.js";
import { writeConfig } from "../src/config.js";

const codeCommand = vi.fn(async () => {});
const chatCommand = vi.fn(async () => {});
const setupCommand = vi.fn(async () => {});

vi.mock("../src/cli/commands/code.js", () => ({ codeCommand }));
vi.mock("../src/cli/commands/chat.js", () => ({ chatCommand }));
vi.mock("../src/cli/commands/setup.js", () => ({ setupCommand }));

async function importCli(argv: string[]) {
  vi.resetModules();
  process.argv = ["node", "src/cli/index.ts", ...argv];
  await import("../src/cli/index.ts");
}

describe("bare CLI routing", () => {
  let home: string;
  let cwd: string;
  const origHome = process.env.HOME;
  const origUserProfile = process.env.USERPROFILE;
  const origHeapReexec = process.env[HEAP_REEXEC_ENV];
  const origArgv = process.argv;
  const origCwd = process.cwd();
  let stderr: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "siliconcode-cli-home-"));
    // macOS's tmpdir is /var/folders/... but realpath is /private/var/folders/...;
    // process.chdir followed by process.cwd() returns the resolved form, so
    // normalise here too or the toHaveBeenCalledWith({ dir: cwd, ... }) assertions
    // compare mismatched paths.
    cwd = realpathSync(mkdtempSync(join(tmpdir(), "siliconcode-cli-cwd-")));
    process.env.HOME = home;
    process.env.USERPROFILE = home;
    process.env[HEAP_REEXEC_ENV] = "1";
    process.chdir(cwd);
    codeCommand.mockClear();
    chatCommand.mockClear();
    setupCommand.mockClear();
    stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  });

  afterEach(() => {
    stderr.mockRestore();
    process.chdir(origCwd);
    process.argv = origArgv;
    rmSync(home, { recursive: true, force: true });
    rmSync(cwd, { recursive: true, force: true });
    if (origHome === undefined) {
      // biome-ignore lint/performance/noDelete: env restoration needs absence, not "undefined"
      delete process.env.HOME;
    } else {
      process.env.HOME = origHome;
    }
    if (origUserProfile === undefined) {
      // biome-ignore lint/performance/noDelete: env restoration needs absence, not "undefined"
      delete process.env.USERPROFILE;
    } else {
      process.env.USERPROFILE = origUserProfile;
    }
    if (origHeapReexec === undefined) {
      delete process.env[HEAP_REEXEC_ENV];
    } else {
      process.env[HEAP_REEXEC_ENV] = origHeapReexec;
    }
  });

  it("routes bare brown to code mode rooted at cwd", async () => {
    writeConfig({ setupCompleted: true }, join(home, ".siliconcode", "config.json"));
    mkdirSync(join(cwd, ".git"));

    await importCli([]);

    await vi.waitFor(() =>
      expect(codeCommand).toHaveBeenCalledWith({ dir: cwd, forceResume: false, forceNew: true }),
    );
    expect(chatCommand).not.toHaveBeenCalled();
  });

  it("routes bare brown in a non-project directory to code mode too", async () => {
    writeConfig({ setupCompleted: true }, join(home, ".siliconcode", "config.json"));

    await importCli([]);

    await vi.waitFor(() =>
      expect(codeCommand).toHaveBeenCalledWith({ dir: cwd, forceResume: false, forceNew: true }),
    );
    expect(chatCommand).not.toHaveBeenCalled();
    expect(stderr.mock.calls.map((call) => String(call[0])).join("")).not.toContain(
      "chat mode (no filesystem tools)",
    );
  });

  it("forwards -c to code mode as forceResume", async () => {
    writeConfig({ setupCompleted: true }, join(home, ".siliconcode", "config.json"));

    await importCli(["-c"]);

    await vi.waitFor(() =>
      expect(codeCommand).toHaveBeenCalledWith({ dir: cwd, forceResume: true, forceNew: false }),
    );
  });

  it("defaults bare brown to a FRESH session (Claude-parity: no auto-resume)", async () => {
    writeConfig({ setupCompleted: true }, join(home, ".siliconcode", "config.json"));

    await importCli([]);

    await vi.waitFor(() => expect(codeCommand).toHaveBeenCalled());
    const arg = codeCommand.mock.calls[0]?.[0] as { forceNew?: boolean; forceResume?: boolean };
    expect(arg.forceNew).toBe(true);
    expect(arg.forceResume).toBe(false);
  });

  it("`code` subcommand defaults to fresh; -r opts into resume", async () => {
    writeConfig({ setupCompleted: true }, join(home, ".siliconcode", "config.json"));

    await importCli(["code"]);
    await vi.waitFor(() => expect(codeCommand).toHaveBeenCalled());
    expect(codeCommand).toHaveBeenCalledWith(
      expect.objectContaining({ forceNew: true, forceResume: false }),
    );

    codeCommand.mockClear();
    await importCli(["code", "-r"]);
    await vi.waitFor(() => expect(codeCommand).toHaveBeenCalled());
    expect(codeCommand).toHaveBeenCalledWith(
      expect.objectContaining({ forceNew: false, forceResume: true }),
    );
  });

  it("keeps explicit brown chat in chat mode even inside a project", async () => {
    writeConfig({ setupCompleted: true }, join(home, ".siliconcode", "config.json"));
    writeFileSync(join(cwd, "package.json"), "{}\n", "utf8");

    await importCli(["chat"]);

    await vi.waitFor(() => expect(chatCommand).toHaveBeenCalled());
    expect(codeCommand).not.toHaveBeenCalled();
  });

  it("keeps first-run bare brown on the setup wizard", async () => {
    writeConfig({ setupCompleted: false }, join(home, ".siliconcode", "config.json"));
    mkdirSync(join(cwd, ".git"));

    await importCli([]);

    await vi.waitFor(() => expect(setupCommand).toHaveBeenCalledWith({ forceKeyStep: true }));
    expect(codeCommand).not.toHaveBeenCalled();
    expect(chatCommand).not.toHaveBeenCalled();
  });
});
