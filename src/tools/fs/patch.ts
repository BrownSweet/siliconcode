import type { EditBlock } from "../../code/edit-blocks.js";

export interface ParsedPatchFile {
  path: string;
  blocks: EditBlock[];
}

type PatchPath = string | null;

interface FileState {
  oldPath: PatchPath;
  newPath: PatchPath;
  blocks: EditBlock[];
}

export function parseUnifiedPatch(patch: string): EditBlock[] {
  if (typeof patch !== "string" || patch.trim().length === 0) {
    throw new Error("apply_patch: patch must be a non-empty string");
  }

  const lines = patch.split(/\n/);
  const files: FileState[] = [];
  let current: FileState | null = null;

  const ensureCurrent = (): FileState => {
    if (!current) {
      current = { oldPath: null, newPath: null, blocks: [] };
      files.push(current);
    }
    return current;
  };

  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;

    if (line.startsWith("diff --git ")) {
      current = { oldPath: null, newPath: null, blocks: [] };
      files.push(current);
      i++;
      continue;
    }

    if (line.startsWith("--- ")) {
      ensureCurrent().oldPath = parsePatchPath(line.slice(4));
      i++;
      continue;
    }

    if (line.startsWith("+++ ")) {
      ensureCurrent().newPath = parsePatchPath(line.slice(4));
      i++;
      continue;
    }

    if (line.startsWith("@@")) {
      const file = ensureCurrent();
      const path = file.newPath ?? file.oldPath;
      if (!path) throw new Error("apply_patch: hunk is missing a file path");

      const searchLines: string[] = [];
      const replaceLines: string[] = [];
      i++;
      while (i < lines.length) {
        const hunkLine = lines[i]!;
        if (
          hunkLine.startsWith("diff --git ") ||
          hunkLine.startsWith("@@") ||
          hunkLine.startsWith("--- ")
        ) {
          break;
        }
        if (hunkLine === "" && i === lines.length - 1) {
          break;
        }
        if (hunkLine.startsWith("\\ No newline at end of file")) {
          i++;
          continue;
        }
        const marker = hunkLine[0];
        const body = hunkLine.slice(1);
        if (marker === " ") {
          searchLines.push(body);
          replaceLines.push(body);
        } else if (marker === "-") {
          searchLines.push(body);
        } else if (marker === "+") {
          replaceLines.push(body);
        } else if (hunkLine.trim().length === 0) {
          // A blank separator after a hunk is common in model-emitted patches.
        } else {
          throw new Error(`apply_patch: invalid hunk line: ${hunkLine}`);
        }
        i++;
      }

      file.blocks.push({
        path,
        search: file.oldPath === null ? "" : linesToText(searchLines),
        replace: linesToText(replaceLines),
        offset: 0,
      });
      continue;
    }

    i++;
  }

  const blocks = files.flatMap((file) => file.blocks);
  if (blocks.length === 0) throw new Error("apply_patch: patch did not contain any hunks");
  return blocks;
}

function linesToText(lines: readonly string[]): string {
  if (lines.length === 0) return "";
  return `${lines.join("\n")}\n`;
}

function parsePatchPath(raw: string): PatchPath {
  const cleaned = unquotePath(raw.trim().split(/\t/, 1)[0] ?? "");
  if (cleaned === "/dev/null") return null;
  const withoutPrefix = cleaned.replace(/^[ab]\//, "");
  const normalized = withoutPrefix.replace(/^[/\\]+/, "");
  if (!normalized) throw new Error(`apply_patch: invalid patch path: ${raw}`);
  return normalized.replaceAll("\\", "/");
}

function unquotePath(path: string): string {
  if (path.length < 2 || !path.startsWith('"') || !path.endsWith('"')) return path;
  try {
    return JSON.parse(path) as string;
  } catch {
    return path.slice(1, -1);
  }
}
