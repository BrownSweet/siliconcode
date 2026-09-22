import { promises as fs } from "node:fs";
import * as pathMod from "node:path";

function displayRel(rootDir: string, full: string): string {
  return pathMod.relative(rootDir, full).replaceAll("\\", "/");
}

export async function applyEdit(
  rootDir: string,
  abs: string,
  args: { search: string; replace: string },
): Promise<string> {
  if (args.search.length === 0) {
    throw new Error("edit_file: search cannot be empty");
  }
  const before = await fs.readFile(abs, "utf8");
  const le = before.includes("\r\n") ? "\r\n" : "\n";
  const adaptedSearch = args.search.replace(/\r?\n/g, le);
  const adaptedReplace = args.replace.replace(/\r?\n/g, le);
  const firstIdx = before.indexOf(adaptedSearch);
  if (firstIdx < 0) {
    throw new Error(`edit_file: search text not found in ${displayRel(rootDir, abs)}`);
  }
  const nextIdx = before.indexOf(adaptedSearch, firstIdx + 1);
  if (nextIdx >= 0) {
    throw new Error(
      `edit_file: search text appears multiple times in ${displayRel(rootDir, abs)} — include more context to disambiguate`,
    );
  }
  const after =
    before.slice(0, firstIdx) + adaptedReplace + before.slice(firstIdx + adaptedSearch.length);
  await fs.writeFile(abs, after, "utf8");
  const rel = displayRel(rootDir, abs);
  const header = `edited ${rel} (${adaptedSearch.length}→${adaptedReplace.length} chars)`;
  const startLine = before.slice(0, firstIdx).split(/\r?\n/).length;
  const diff = renderEditDiff(adaptedSearch, adaptedReplace, startLine);
  return `${header}\n${diff}`;
}

export interface MultiEditEntry {
  abs: string;
  search: string;
  replace: string;
}

export async function applyMultiEdit(
  rootDir: string,
  edits: ReadonlyArray<MultiEditEntry>,
): Promise<string> {
  if (edits.length === 0) {
    throw new Error("multi_edit: edits must contain at least one entry");
  }
  type FileState = {
    buf: string;
    le: string;
    hunks: string[];
    deltaChars: number;
    touched: number;
    created: boolean;
  };
  const filesByPath = new Map<string, FileState>();

  for (let i = 0; i < edits.length; i++) {
    const e = edits[i]!;
    if (typeof e.abs !== "string" || e.abs.length === 0) {
      throw new Error(`multi_edit: edit #${i + 1} requires a string \`path\` (no edits applied)`);
    }
    if (typeof e.search !== "string") {
      throw new Error(`multi_edit: edit #${i + 1} requires a string \`search\` (no edits applied)`);
    }
    if (typeof e.replace !== "string") {
      throw new Error(
        `multi_edit: edit #${i + 1} requires a string \`replace\` (no edits applied)`,
      );
    }
    const rel = displayRel(rootDir, e.abs);
    let state = filesByPath.get(e.abs);
    if (!state) {
      let before: string;
      if (e.search.length === 0) {
        try {
          await fs.readFile(e.abs, "utf8");
          throw new Error("empty SEARCH only creates new files — this file already exists");
        } catch (err) {
          const code = (err as NodeJS.ErrnoException).code;
          if (code !== "ENOENT") {
            throw new Error(
              `multi_edit: edit #${i + 1} cannot create ${rel}: ${(err as Error).message} (no edits applied)`,
            );
          }
        }
        state = { buf: "", le: "\n", hunks: [], deltaChars: 0, touched: 0, created: true };
        filesByPath.set(e.abs, state);
      } else {
        try {
          before = await fs.readFile(e.abs, "utf8");
        } catch (err) {
          throw new Error(
            `multi_edit: edit #${i + 1} cannot read ${rel}: ${(err as Error).message} (no edits applied)`,
          );
        }
        const le = before.includes("\r\n") ? "\r\n" : "\n";
        state = { buf: before, le, hunks: [], deltaChars: 0, touched: 0, created: false };
        filesByPath.set(e.abs, state);
      }
    }
    if (e.search.length === 0 && (!state.created || state.touched > 0)) {
      throw new Error(
        `multi_edit: edit #${i + 1} (${rel}) empty search only creates new files (no edits applied)`,
      );
    }
    const adaptedSearch = e.search.replace(/\r?\n/g, state.le);
    const adaptedReplace = e.replace.replace(/\r?\n/g, state.le);
    if (adaptedSearch.length === 0) {
      state.buf = adaptedReplace;
      state.hunks.push(`# ${rel}\n${renderCreateDiff(adaptedReplace)}`);
      state.deltaChars += adaptedReplace.length;
      state.touched++;
      continue;
    }
    const firstIdx = state.buf.indexOf(adaptedSearch);
    if (firstIdx < 0) {
      throw new Error(
        `multi_edit: edit #${i + 1} search text not found in ${rel} — no edits applied (multi_edit is atomic)`,
      );
    }
    const nextIdx = state.buf.indexOf(adaptedSearch, firstIdx + 1);
    if (nextIdx >= 0) {
      throw new Error(
        `multi_edit: edit #${i + 1} search text appears multiple times in ${rel} — include more context to disambiguate (no edits applied)`,
      );
    }
    const startLine = state.buf.slice(0, firstIdx).split(/\r?\n/).length;
    state.buf =
      state.buf.slice(0, firstIdx) +
      adaptedReplace +
      state.buf.slice(firstIdx + adaptedSearch.length);
    state.hunks.push(`# ${rel}\n${renderEditDiff(adaptedSearch, adaptedReplace, startLine)}`);
    state.deltaChars += adaptedReplace.length - adaptedSearch.length;
    state.touched++;
  }

  for (const [abs, state] of filesByPath) {
    if (state.created) await fs.mkdir(pathMod.dirname(abs), { recursive: true });
    await fs.writeFile(abs, state.buf, "utf8");
  }

  const fileCount = filesByPath.size;
  const editCount = edits.length;
  let totalDelta = 0;
  const allHunks: string[] = [];
  for (const state of filesByPath.values()) {
    totalDelta += state.deltaChars;
    allHunks.push(...state.hunks);
  }
  const sign = totalDelta >= 0 ? "+" : "";
  const editNoun = editCount === 1 ? "edit" : "edits";
  const fileNoun = fileCount === 1 ? "file" : "files";
  const header = `multi_edit: applied ${editCount} ${editNoun} across ${fileCount} ${fileNoun} (${sign}${totalDelta} chars)`;
  return `${header}\n${allHunks.join("\n")}`;
}

function renderEditDiff(search: string, replace: string, startLine: number): string {
  const a = search.split(/\r?\n/);
  const b = replace.split(/\r?\n/);
  const diff = lineDiff(a, b);
  const hunk = `@@ -${startLine},${a.length} +${startLine},${b.length} @@`;
  const body = diff.map((d) => `${d.op === " " ? " " : d.op} ${d.line}`).join("\n");
  return `${hunk}\n${body}`;
}

function renderCreateDiff(replace: string): string {
  const lines = replace.length === 0 ? [] : replace.split(/\r?\n/);
  const hunk = `@@ -1,0 +1,${lines.length} @@`;
  const body = lines.map((line) => `+ ${line}`).join("\n");
  return body ? `${hunk}\n${body}` : hunk;
}

export function lineDiff(
  a: readonly string[],
  b: readonly string[],
): Array<{ op: "-" | "+" | " "; line: string }> {
  const n = a.length;
  const m = b.length;
  // dp[i][j] = LCS length of a[0..i) and b[0..j).
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      if (a[i - 1] === b[j - 1]) dp[i]![j] = dp[i - 1]![j - 1]! + 1;
      else dp[i]![j] = Math.max(dp[i - 1]![j]!, dp[i]![j - 1]!);
    }
  }
  // Backtrack to recover the op sequence.
  const out: Array<{ op: "-" | "+" | " "; line: string }> = [];
  let i = n;
  let j = m;
  while (i > 0 && j > 0) {
    if (a[i - 1] === b[j - 1]) {
      out.unshift({ op: " ", line: a[i - 1]! });
      i--;
      j--;
    } else if ((dp[i - 1]![j] ?? 0) > (dp[i]![j - 1] ?? 0)) {
      out.unshift({ op: "-", line: a[i - 1]! });
      i--;
    } else {
      // Tie-break goes here (strictly less or equal): take the
      // insertion first during backtrack so the final forward order
      // renders removals BEFORE additions for a substitution —
      // matches git-diff convention of `- old / + new`.
      out.unshift({ op: "+", line: b[j - 1]! });
      j--;
    }
  }
  while (i > 0) {
    out.unshift({ op: "-", line: a[i - 1]! });
    i--;
  }
  while (j > 0) {
    out.unshift({ op: "+", line: b[j - 1]! });
    j--;
  }
  return out;
}
