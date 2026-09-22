/** Throwaway visual preview of the restyled TUI surfaces. Run: npx tsx scripts/ui-preview.tsx */
import { render } from "ink-testing-library";
import React from "react";
import stripAnsi from "strip-ansi";
import type { SplitDiffRow } from "../src/code/diff-preview.js";
import { BootSplash } from "../src/cli/ui/BootSplash.js";
import { PromptInput } from "../src/cli/ui/PromptInput.js";
import { ShellConfirm } from "../src/cli/ui/ShellConfirm.js";
import { SplitDiff } from "../src/cli/ui/SplitDiff.js";
import { WelcomeBanner } from "../src/cli/ui/WelcomeBanner.js";
import { StreamingCard } from "../src/cli/ui/cards/StreamingCard.js";
import { ToolCard } from "../src/cli/ui/cards/ToolCard.js";
import { StatusRow } from "../src/cli/ui/layout/StatusRow.js";
import { ThinkingRow } from "../src/cli/ui/layout/LiveRows.js";
import { AgentStoreProvider } from "../src/cli/ui/state/provider.js";
import { setLanguageRuntime } from "../src/i18n/index.js";

setLanguageRuntime("zh-CN");

const ORANGE = "217;119;87"; // #d97757 brand
const AMBER = "234;179;8"; // #eab308 warn (github-dark)
const GREEN = "34;197;94"; // #22c55e ok

function show(title: string, node: React.ReactElement) {
  const { lastFrame, unmount } = render(node);
  const raw = lastFrame() ?? "";
  unmount();
  const tags: string[] = [];
  if (raw.includes(ORANGE)) tags.push("brand-orange✓");
  if (raw.includes(AMBER)) tags.push("amber✓");
  if (raw.includes(GREEN)) tags.push("green✓");
  process.stdout.write(`\n──── ${title} ${tags.length ? `[${tags.join(" ")}]` : ""}\n`);
  process.stdout.write(`${stripAnsi(raw)}\n`);
}

show("BootSplash", <BootSplash />);
show(
  "WelcomeBanner (code mode)",
  <WelcomeBanner inCodeMode workspaceRoot="/Users/mx/github/siliconcode" dashboardUrl={null} />,
);
show("PromptInput — empty", <PromptInput value="" onChange={() => {}} onSubmit={() => {}} />);
show(
  "PromptInput — typed",
  <PromptInput value="修复登录函数里的空指针" onChange={() => {}} onSubmit={() => {}} />,
);
show(
  "PromptInput — bash mode (!)",
  <PromptInput value="!ls -la src/cli" onChange={() => {}} onSubmit={() => {}} />,
);
show("ThinkingRow (whimsical)", <ThinkingRow whimsical />);
show(
  "ToolCard — ok + ⎿ result tree",
  <ToolCard
    card={{
      kind: "tool",
      id: "t1",
      ts: 1,
      name: "run_command",
      args: { command: "npm test" },
      output: ["PASS tests/a.test.ts", "PASS tests/b.test.ts", "Tests 12 passed"].join("\n"),
      done: true,
      exitCode: 0,
      elapsedMs: 1234,
    }}
  />,
);
show(
  "ToolCard — error",
  <ToolCard
    card={{
      kind: "tool",
      id: "t2",
      ts: 1,
      name: "run_command",
      args: { command: "npm run build" },
      output: ["error TS2304: Cannot find name 'foo'", "[exit code 1]"].join("\n"),
      done: true,
      exitCode: 1,
      elapsedMs: 800,
    }}
  />,
);
show(
  "StreamingCard — reply w/ todo list",
  <StreamingCard
    card={{
      kind: "streaming",
      id: "s1",
      ts: 1,
      text: "我会按下面的步骤来做：\n\n- [x] 读取登录函数\n- [ ] 加空值校验\n- [ ] 跑测试\n\n```ts\nif (!user) return null;\n```",
      done: true,
      model: "deepseek-v4-pro",
    }}
  />,
);
show(
  "ShellConfirm (permission ❯ options)",
  <ShellConfirm
    command="rm -rf node_modules && npm install"
    allowPrefix="rm"
    cwd="/Users/mx/github/siliconcode"
    onChoose={() => {}}
  />,
);
const diffRows: SplitDiffRow[] = [
  {
    left: { num: 40, kind: "ctx", text: "function login(email) {" },
    right: { num: 40, kind: "ctx", text: "function login(email) {" },
  },
  {
    left: { num: 41, kind: "del", text: "  if (!email) throw new Error('x')" },
    right: { num: 41, kind: "add", text: "  if (!email || typeof email !== 'string')" },
  },
  {
    left: { num: null, kind: "pad", text: "" },
    right: { num: 42, kind: "add", text: "    throw new TypeError('email required')" },
  },
];
show("SplitDiff (DIFF tokens)", <SplitDiff rows={diffRows} totalCols={80} />);
show(
  "StatusRow (bottom bar)",
  <AgentStoreProvider session={{ id: "default", branch: "main", workspace: "/repo", model: "deepseek-v4-pro" }}>
    <StatusRow
      statusBar={
        {
          showMode: true,
          showPreset: true,
          showSessionInfo: true,
          showBalance: false,
          showSessionCost: false,
          showTurnCost: false,
          showCacheHit: false,
          showCtxUsage: true,
          showVersion: true,
          showFeedbackHint: false,
        } as never
      }
    />
  </AgentStoreProvider>,
);
