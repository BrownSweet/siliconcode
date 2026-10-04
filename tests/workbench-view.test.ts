import { describe, expect, it } from "vitest";
import {
  assistantOutput,
  diffCounts,
  renderWorkbenchMarkdown,
  visibleEvents,
} from "../dashboard/src/lib/workbench-view.js";

describe("workbench presentation of untrusted content", () => {
  it("renders readable Markdown while keeping HTML, dangerous links and remote images inert", () => {
    const result = renderWorkbenchMarkdown(
      "# 需求\n\n**验收**与 `npm test`\n\n<script>alert(1)</script>\n\n[x](javascript:alert) [y](data:text/html,hi) ![tracking](https://example.com/pixel)\n\n[文档](https://example.com/?q=1&b=2)\n\n```html\n<img onerror=alert(1)>\n```",
    );
    expect(result).toContain("<h1>需求</h1>");
    expect(result).toContain("<strong>验收</strong>");
    expect(result).not.toContain("<script>");
    expect(result).not.toContain("<img");
    expect(result).not.toContain('href="javascript:');
    expect(result).not.toContain('href="data:');
    expect(result).toContain('rel="noopener noreferrer"');
    expect(result).toContain("&lt;img onerror=alert(1)&gt;");
  });
  it("does not duplicate streamed text when a complete assistant message arrives", () => {
    const event = (seq: number, role: string, content: string) => ({
      seq,
      type: "loop",
      data: { role, content },
    });
    expect(
      assistantOutput([
        event(1, "assistant_delta", "你"),
        event(2, "assistant_delta", "好"),
        event(3, "assistant_final", "你好"),
        event(4, "assistant_delta", "下一步"),
      ]),
    ).toBe("你好\n\n下一步");
  });
  it("retains complete tool results and excludes argument fragments from activity", () => {
    const events = ["tool_call_delta", "assistant_delta", "tool_start", "tool", "done"].map(
      (role, seq) => ({ seq, type: "loop", data: { role } }),
    );
    expect(visibleEvents(events).map((e) => e.data.role)).toEqual(["tool_start", "tool", "done"]);
    expect(diffCounts("--- a/file\n+++ b/file\n@@ -1 +1 @@\n-old\n+new\n+added")).toEqual({
      added: 2,
      removed: 1,
    });
  });
});
