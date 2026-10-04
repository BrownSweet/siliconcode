import { Marked } from "marked";

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
// Model/project text is untrusted. Raw HTML and remote images stay inert.
const markdown = new Marked({
  gfm: true,
  breaks: false,
  renderer: {
    html({ text }) {
      return escapeHtml(text);
    },
    link({ href, tokens }) {
      const label = this.parser.parseInline(tokens);
      if (!/^https?:\/\//i.test(href)) return label;
      return `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${label}</a>`;
    },
    image({ text }) {
      return `<span class="image-placeholder">${escapeHtml(text || "图片")}</span>`;
    },
  },
});
export function renderWorkbenchMarkdown(text: string): string {
  return markdown.parse(text, { async: false });
}

export interface WorkbenchEvent {
  seq: number;
  type: string;
  data: any;
}
export function visibleEvents(events: WorkbenchEvent[]) {
  return events.filter(
    (event) =>
      event.type !== "state" &&
      event.type !== "requirements" &&
      (event.type !== "loop" || ["tool_start", "tool", "error", "done"].includes(event.data.role)),
  );
}
export function assistantOutput(events: WorkbenchEvent[]): string {
  let text = "";
  let pending = "";
  for (const event of events) {
    if (event.type !== "loop") continue;
    if (event.data.role === "assistant_delta") pending += event.data.content || "";
    if (event.data.role === "assistant_final") {
      const content = event.data.content || pending;
      if (content) text += `${text ? "\n\n" : ""}${content}`;
      pending = "";
    }
  }
  return text + (pending ? `${text ? "\n\n" : ""}${pending}` : "");
}
export function diffCounts(diff: string) {
  const lines = diff.split("\n");
  return {
    added: lines.filter((l) => l.startsWith("+") && !l.startsWith("+++")).length,
    removed: lines.filter((l) => l.startsWith("-") && !l.startsWith("---")).length,
  };
}
