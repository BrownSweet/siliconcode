import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ToolRegistry } from "../../src/tools.js";
import { registerFilesystemTools } from "../../src/tools/filesystem.js";

export type HarnessTranscriptKind = "inspect" | "test-failed" | "patch" | "test-passed" | "summary";

export interface HarnessTranscriptEntry {
  kind: HarnessTranscriptKind;
  detail: string;
}

export interface HarnessCommandResult {
  exitCode: number;
  output: string;
}

export interface CodexParityHarnessResult {
  root: string;
  transcript: HarnessTranscriptEntry[];
  firstTest: HarnessCommandResult;
  secondTest: HarnessCommandResult;
  patchOutput: string;
  changedFiles: string[];
  summary: string;
}

export async function runCodexParityHarness(): Promise<CodexParityHarnessResult> {
  const root = await mkdtemp(join(tmpdir(), "carbon-codex-parity-"));
  const transcript: HarnessTranscriptEntry[] = [];

  try {
    await writeFixture(root);

    const tools = new ToolRegistry();
    registerFilesystemTools(tools, { rootDir: root });

    const inspected = await tools.dispatch("read_file", JSON.stringify({ path: "src/pricing.js" }));
    transcript.push({ kind: "inspect", detail: inspected });

    const firstTest = await runCommand(root, "npm", ["test", "--silent"]);
    transcript.push({ kind: "test-failed", detail: firstTest.output });

    const patchOutput = await tools.dispatch(
      "apply_patch",
      JSON.stringify({
        patch: [
          "diff --git a/src/pricing.js b/src/pricing.js",
          "--- a/src/pricing.js",
          "+++ b/src/pricing.js",
          "@@ -1,3 +1,3 @@",
          " export function netPrice(price, discount) {",
          "-  return price + discount;",
          "+  return price - discount;",
          " }",
          "",
        ].join("\n"),
      }),
    );
    transcript.push({ kind: "patch", detail: patchOutput });

    const secondTest = await runCommand(root, "npm", ["test", "--silent"]);
    transcript.push({ kind: "test-passed", detail: secondTest.output });

    const summary = "已修复折扣计算，并通过 npm test。";
    transcript.push({ kind: "summary", detail: summary });

    const fixed = await fs.readFile(join(root, "src", "pricing.js"), "utf8");
    if (!fixed.includes("return price - discount;")) {
      throw new Error(`fixture was not fixed; root=${root}`);
    }

    await rm(root, { recursive: true, force: true });
    return {
      root,
      transcript,
      firstTest,
      secondTest,
      patchOutput,
      changedFiles: ["src/pricing.js"],
      summary,
    };
  } catch (err) {
    throw new Error(
      `Codex parity harness failed; temp project preserved at ${root}: ${(err as Error).message}`,
    );
  }
}

async function writeFixture(root: string): Promise<void> {
  await fs.mkdir(join(root, "src"), { recursive: true });
  await fs.mkdir(join(root, "test"), { recursive: true });
  await fs.writeFile(
    join(root, "package.json"),
    `${JSON.stringify(
      {
        type: "module",
        scripts: {
          test: "node --test",
        },
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  await fs.writeFile(
    join(root, "src", "pricing.js"),
    ["export function netPrice(price, discount) {", "  return price + discount;", "}", ""].join(
      "\n",
    ),
    "utf8",
  );
  await fs.writeFile(
    join(root, "test", "pricing.test.js"),
    [
      'import test from "node:test";',
      'import assert from "node:assert/strict";',
      'import { netPrice } from "../src/pricing.js";',
      "",
      'test("discount is subtracted", () => {',
      "  assert.equal(netPrice(100, 15), 85);",
      "});",
      "",
    ].join("\n"),
    "utf8",
  );
}

function runCommand(
  cwd: string,
  command: string,
  args: readonly string[],
): Promise<HarnessCommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, [...args], {
      cwd,
      env: { ...process.env, CI: "1" },
      shell: process.platform === "win32",
      stdio: ["ignore", "pipe", "pipe"],
    });
    const chunks: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => chunks.push(chunk));
    child.on("error", reject);
    child.on("close", (code) => {
      resolve({
        exitCode: code ?? 1,
        output: Buffer.concat(chunks).toString("utf8"),
      });
    });
  });
}
