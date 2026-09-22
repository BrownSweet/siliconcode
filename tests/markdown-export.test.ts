import { describe, expect, it } from "vitest";
import { sessionToMarkdown } from "../src/transcript/markdown-export.js";
import type { ChatMessage } from "../src/types.js";

const messages: ChatMessage[] = [
  { role: "system", content: "You are Silicon Code…" },
  { role: "user", content: "修复登录函数" },
  {
    role: "assistant",
    content: "我先看一下文件。",
    tool_calls: [
      {
        id: "1",
        type: "function",
        function: { name: "read_file", arguments: '{"path":"src/auth.ts"}' },
      },
    ],
  },
  { role: "tool", name: "read_file", content: "export function login() {}" },
  { role: "assistant", content: "改好了。" },
];

describe("sessionToMarkdown", () => {
  it("renders a shareable transcript, skips the system prompt, friendly-names tools", () => {
    const md = sessionToMarkdown(messages, { name: "abc", summary: "登录修复", turnCount: 2 });
    expect(md).toContain("# Silicon Code 会话导出 — 登录修复");
    expect(md).toContain("2 轮");
    expect(md).toContain("## 🧑 用户");
    expect(md).toContain("修复登录函数");
    expect(md).toContain("## 🤖 Silicon Code");
    expect(md).toContain("Read(src/auth.ts)"); // friendly tool name + arg
    expect(md).toContain("<details>");
    expect(md).toContain("export function login()");
    expect(md).not.toContain("You are Silicon Code"); // system prompt omitted
  });

  it("truncates oversized tool results", () => {
    const big: ChatMessage[] = [{ role: "tool", name: "run_command", content: "x".repeat(5000) }];
    const md = sessionToMarkdown(big);
    expect(md).toContain("… (truncated)");
    expect(md.length).toBeLessThan(5000);
  });
});
