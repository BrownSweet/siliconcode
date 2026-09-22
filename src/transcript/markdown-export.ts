import { friendlyToolName } from "../cli/ui/tool-summary.js";
import type { ChatMessage } from "../types.js";

export interface SessionExportMeta {
  name?: string;
  summary?: string;
  turnCount?: number;
  totalCostUsd?: number;
}

const TOOL_RESULT_MAX = 2000;

// First string arg value (or the key list) clipped to a short label, mirroring the ToolCard header.
function compactArgs(raw: string): string {
  let s = raw;
  try {
    const obj = JSON.parse(raw) as Record<string, unknown>;
    const firstStr = Object.values(obj).find((v) => typeof v === "string") as string | undefined;
    s = firstStr ?? Object.keys(obj).join(" ");
  } catch {
    /* non-JSON args — use the raw string */
  }
  return s.length > 60 ? `${s.slice(0, 60)}…` : s;
}

// Render a session's messages as a shareable Markdown transcript. The system prompt
// and reasoning are skipped; tool results go in collapsible blocks.
export function sessionToMarkdown(messages: ChatMessage[], meta: SessionExportMeta = {}): string {
  const out: string[] = [];
  const heading = meta.summary ? ` — ${meta.summary}` : meta.name ? ` — ${meta.name}` : "";
  out.push(`# Silicon Code 会话导出${heading}`);
  const bits: string[] = [];
  if (meta.turnCount) bits.push(`${meta.turnCount} 轮`);
  if (typeof meta.totalCostUsd === "number") bits.push(`成本 $${meta.totalCostUsd.toFixed(4)}`);
  if (bits.length) out.push("", `> ${bits.join(" · ")}`);
  out.push("");

  for (const m of messages) {
    const content = typeof m.content === "string" ? m.content : "";
    if (m.role === "user") {
      out.push("## 🧑 用户", "", content.trim() || "(empty)", "");
    } else if (m.role === "assistant") {
      if (content.trim()) out.push("## 🤖 Silicon Code", "", content.trim(), "");
      for (const tc of m.tool_calls ?? []) {
        const label = tc.function?.name ? friendlyToolName(tc.function.name) : "tool";
        out.push(`> ⏺ \`${label}(${compactArgs(tc.function?.arguments ?? "")})\``);
      }
      if (m.tool_calls?.length) out.push("");
    } else if (m.role === "tool") {
      const body =
        content.length > TOOL_RESULT_MAX
          ? `${content.slice(0, TOOL_RESULT_MAX)}\n… (truncated)`
          : content;
      if (body.trim()) {
        out.push(
          `<details><summary>⎿ ${m.name ?? "tool"} result</summary>`,
          "",
          "```",
          body,
          "```",
          "</details>",
          "",
        );
      }
    }
    // system + reasoning_content omitted from the export
  }
  return `${out
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trimEnd()}\n`;
}
