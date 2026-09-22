/** Pure tool-result summarizer — shared by ToolCard, replay, and transcript export. */

const MAX_SUMMARY_CHARS = 80;
const TRAILING_ELLIPSIS = "…";

/** Internal tool id → Claude-style friendly verb shown in the timeline header. */
const TOOL_DISPLAY_NAMES: Record<string, string> = {
  run_command: "Bash",
  run_background: "Bash",
  read_file: "Read",
  write_file: "Write",
  edit_file: "Edit",
  search_files: "Search",
  list_directory: "List",
  directory_tree: "Tree",
  move_file: "Move",
  get_file_info: "Stat",
  spawn_subagent: "Task",
  web_fetch: "Fetch",
  fetch_url: "Fetch",
};

// Friendly verb for a tool id (run_command→Bash): exact match, then `_`-suffix (MCP namespacing), else the raw id.
export function friendlyToolName(name: string): string {
  const exact = TOOL_DISPLAY_NAMES[name];
  if (exact) return exact;
  for (const id in TOOL_DISPLAY_NAMES) {
    if (name.endsWith(`_${id}`)) return TOOL_DISPLAY_NAMES[id]!;
  }
  return name;
}

export interface ToolSummary {
  /** Single-line summary text. Empty string if the result was empty. */
  summary: string;
  /** True when the tool result represents a failure the renderer should color red. */
  isError: boolean;
}

export interface CommandOutputSummary {
  status: "passed" | "failed" | "unknown";
  headline: string;
  failures: string[];
  tail: string[];
}

function clip(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, Math.max(1, max - TRAILING_ELLIPSIS.length)) + TRAILING_ELLIPSIS;
}

function firstNonEmptyLine(text: string): string {
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed) return trimmed;
  }
  return "";
}

export function summarizeCommandOutput(content: string): CommandOutputSummary {
  const lines = content.split(/\r?\n/);
  const nonEmpty = lines.map((line) => line.trim()).filter(Boolean);
  const failures: string[] = [];
  const seen = new Set<string>();
  let headline = "";

  const addFailure = (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || seen.has(trimmed)) return;
    seen.add(trimmed);
    failures.push(trimmed);
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    const vitestFail = line.match(/^FAIL\s+(.+)/);
    if (vitestFail?.[1]) addFailure(vitestFail[1]);

    const stackLine = line.match(/^[❯>]\s+(.+\.(?:[cm]?[jt]sx?|tsx?):\d+:\d+)$/);
    if (stackLine?.[1]) addFailure(stackLine[1]);

    const tapFail = line.match(/^not ok\s+\d+\s+-\s+(.+)/);
    if (tapFail?.[1]) addFailure(tapFail[1]);

    const testsLine = line.match(/^Tests?\s+(.+)/);
    if (testsLine?.[1] && /\bfailed\b/i.test(testsLine[1])) headline = testsLine[1];

    const tapSummary = line.match(/^#\s*fail\s+(\d+)/i);
    if (tapSummary?.[1]) headline = `${tapSummary[1]} failed`;
  }

  if (!headline) {
    const testFilesLine = nonEmpty.find(
      (line) => /^Test Files\s+/.test(line) && /\bfailed\b/i.test(line),
    );
    if (testFilesLine) headline = testFilesLine.replace(/^Test Files\s+/, "");
  }

  const exitMatch = content.match(/(?:^|\n)\s*(?:\[?exit(?: code)?\s+(-?\d+)\]?)/i);
  const exitCode = exitMatch?.[1] ? Number(exitMatch[1]) : null;
  const failed =
    failures.length > 0 ||
    /\b\d+\s+failed\b/i.test(headline) ||
    (exitCode !== null && exitCode !== 0);
  const passed = !failed && (exitCode === 0 || /\bpassed\b/i.test(content));

  if (!headline) {
    if (exitCode !== null) headline = `exit ${exitCode}`;
    else if (failed) headline = "failed";
    else if (passed) headline = "passed";
    else headline = firstNonEmptyLine(content) || "(no output)";
  }

  return {
    status: failed ? "failed" : passed ? "passed" : "unknown",
    headline: clip(headline, MAX_SUMMARY_CHARS),
    failures: failures.slice(0, 6),
    tail: nonEmpty.slice(-5),
  };
}

export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "";
  if (ms < 100) return `${Math.round(ms)}ms`;
  if (ms < 1000) return `${(ms / 1000).toFixed(1)}s`;
  if (ms < 10_000) return `${(ms / 1000).toFixed(1)}s`;
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  const totalSec = Math.round(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return s === 0 ? `${m}m` : `${m}m${s}s`;
}

function formatBytes(n: number): string {
  if (n < 1000) return `${n}B`;
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}KB`;
  return `${(n / 1_000_000).toFixed(1)}MB`;
}

function formatLineCount(text: string): string {
  // Cheap line count — the +1 covers files without a trailing newline.
  const lines = text.split(/\r?\n/).length;
  return `${lines} line${lines === 1 ? "" : "s"}`;
}

function summarizeStructured(content: string): ToolSummary | null {
  const trimmed = content.trim();
  if (!trimmed.startsWith("{")) return null;
  try {
    const parsed = JSON.parse(trimmed);
    if (!parsed || typeof parsed !== "object") return null;
    const obj = parsed as Record<string, unknown>;
    // Plan / choice signals come through as errors carrying structured
    // payloads — the App-level handlers extract the structured part.
    // For the tool row here we just want the tag.
    if (typeof obj.error === "string") {
      const tag = obj.error.split(":", 1)[0]?.trim() ?? "error";
      const detail = obj.error.slice(tag.length + 1).trim();
      // The tag-only case (no colon body) — show the bare tag.
      const summary = detail ? `${tag} — ${detail}` : tag;
      // Plan / Choice errors are control-flow signals, not real errors.
      const isControlSignal =
        tag === "PlanProposedError" ||
        tag === "PlanRevisionProposedError" ||
        tag === "ChoiceRequestedError" ||
        tag === "NeedsConfirmationError";
      return { summary: clip(summary, MAX_SUMMARY_CHARS), isError: !isControlSignal };
    }
    // step_completed payload (when used outside the error path, kept
    // for forward-compat with non-throwing variants).
    if (obj.kind === "step_completed" && typeof obj.stepId === "string") {
      const result = typeof obj.result === "string" ? obj.result : "";
      return {
        summary: clip(`✓ ${obj.stepId}: ${result}`, MAX_SUMMARY_CHARS),
        isError: false,
      };
    }
    return null;
  } catch {
    return null;
  }
}

export function formatStructuredErrorOutput(content: string): string {
  const structured = summarizeStructured(content);
  if (!structured?.isError) return content;
  return structured.summary;
}

/** Suffix-match so MCP-prefixed tools (`filesystem_read_file`) pick up the same specialized summary. */
function summarizeKnownTool(toolName: string, content: string): ToolSummary | null {
  const hasSuffix = (s: string) => toolName === s || toolName.endsWith(`_${s}`);
  if (hasSuffix("read_file")) {
    const lines = formatLineCount(content);
    const bytes = formatBytes(content.length);
    const head = clip(
      firstNonEmptyLine(content),
      MAX_SUMMARY_CHARS - lines.length - bytes.length - 8,
    );
    return {
      summary: head ? `${head} · ${lines} · ${bytes}` : `${lines} · ${bytes}`,
      isError: false,
    };
  }
  if (hasSuffix("list_directory") || hasSuffix("directory_tree")) {
    const entries = content.split(/\r?\n/).filter((l) => l.trim()).length;
    return { summary: `${entries} entr${entries === 1 ? "y" : "ies"}`, isError: false };
  }
  if (hasSuffix("search_files") || hasSuffix("search_content")) {
    const matches = content.split(/\r?\n/).filter((l) => l.trim()).length;
    if (matches === 0) return { summary: "no matches", isError: false };
    const first = firstNonEmptyLine(content);
    return {
      summary: clip(`${matches} match${matches === 1 ? "" : "es"} · ${first}`, MAX_SUMMARY_CHARS),
      isError: false,
    };
  }
  if (hasSuffix("write_file")) {
    const lines = formatLineCount(content);
    const bytes = formatBytes(content.length);
    return { summary: `wrote ${lines} · ${bytes}`, isError: false };
  }
  if (hasSuffix("multi_edit") || hasSuffix("apply_patch")) {
    const m = content.match(/applied (\d+) edits? across (\d+) files?/);
    if (m) {
      return {
        summary: `${m[1]} edit${m[1] === "1" ? "" : "s"} · ${m[2]} file${m[2] === "1" ? "" : "s"}`,
        isError: false,
      };
    }
    return { summary: clip(firstNonEmptyLine(content), MAX_SUMMARY_CHARS), isError: false };
  }
  if (hasSuffix("todo_write")) {
    if (/^todos cleared/.test(content)) return { summary: "todos cleared", isError: false };
    const m = content.match(/^todos updated · (\d+) done · (\d+) in progress · (\d+) pending/);
    if (m) {
      return { summary: `${m[1]} done · ${m[2]} in progress · ${m[3]} pending`, isError: false };
    }
    return { summary: clip(firstNonEmptyLine(content), MAX_SUMMARY_CHARS), isError: false };
  }
  if (hasSuffix("run_command") || hasSuffix("run_background")) {
    const commandSummary = summarizeCommandOutput(content);
    if (commandSummary.status === "failed") {
      const firstFailure = commandSummary.failures[0];
      return {
        summary: clip(
          firstFailure ? `${commandSummary.headline} · ${firstFailure}` : commandSummary.headline,
          MAX_SUMMARY_CHARS,
        ),
        isError: true,
      };
    }
    // Native shell tools prepend "exit 0:" / "exit N:" or the result
    // already mentions exit code. Try to surface it.
    const exitMatch = content.match(/exit (?:code )?(-?\d+)/i);
    const first = firstNonEmptyLine(content);
    if (exitMatch) {
      const code = exitMatch[1];
      const isError = code !== "0";
      return {
        summary: clip(`exit ${code} · ${first}`, MAX_SUMMARY_CHARS),
        isError,
      };
    }
    return { summary: clip(first || "(no output)", MAX_SUMMARY_CHARS), isError: false };
  }
  return null;
}

export function summarizeToolResult(toolName: string, content: string): ToolSummary {
  const isExplicitError = content.startsWith("ERROR:");
  if (isExplicitError) {
    const stripped = content.slice("ERROR:".length).trim();
    return { summary: clip(stripped || "(unknown error)", MAX_SUMMARY_CHARS), isError: true };
  }
  const structured = summarizeStructured(content);
  if (structured) return structured;
  const known = summarizeKnownTool(toolName, content);
  if (known) return known;
  // Generic: first line + size hint.
  const first = firstNonEmptyLine(content);
  if (!content.trim()) return { summary: "(empty)", isError: false };
  if (content.length <= MAX_SUMMARY_CHARS) {
    return { summary: clip(first, MAX_SUMMARY_CHARS), isError: false };
  }
  const sizeHint = formatBytes(content.length);
  const head = clip(first, MAX_SUMMARY_CHARS - sizeHint.length - 3);
  return { summary: `${head} · ${sizeHint}`, isError: false };
}
