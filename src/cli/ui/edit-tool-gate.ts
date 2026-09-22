import { relative, resolve } from "node:path";
import { type EditBlock, toWholeFileEditBlock } from "../../code/edit-blocks.js";
import { looksLikeAbsoluteSystemPath, pathIsUnder } from "../../tools/filesystem.js";
import { parseUnifiedPatch } from "../../tools/fs/patch.js";

const EDIT_TOOL_NAMES = new Set(["edit_file", "write_file", "multi_edit", "apply_patch"]);

export function buildEditToolBlocks(
  name: string,
  args: Record<string, unknown>,
  rootDir: string,
): EditBlock[] | null {
  if (!EDIT_TOOL_NAMES.has(name)) return null;

  if (name === "apply_patch") {
    const patch = typeof args.patch === "string" ? args.patch : "";
    if (!patch) return null;
    try {
      return parseUnifiedPatch(patch).map((block) => {
        const relPath = normalizeToolPath(block.path, rootDir);
        if (!relPath) throw new Error("path escapes root");
        return { ...block, path: relPath };
      });
    } catch {
      return null;
    }
  }

  if (name === "multi_edit") {
    const edits = Array.isArray(args.edits) ? args.edits : null;
    if (!edits || edits.length === 0) return null;
    const blocks: EditBlock[] = [];
    for (const edit of edits) {
      if (!edit || typeof edit !== "object") return null;
      const entry = edit as Record<string, unknown>;
      const relPath = normalizeToolPath(entry.path, rootDir);
      if (!relPath) return null;
      const search = typeof entry.search === "string" ? entry.search : "";
      const replace = typeof entry.replace === "string" ? entry.replace : "";
      blocks.push({ path: relPath, search, replace, offset: 0 });
    }
    return blocks;
  }

  const relPath = normalizeToolPath(args.path, rootDir);
  if (!relPath) return null;

  if (name === "edit_file") {
    const search = typeof args.search === "string" ? args.search : "";
    const replace = typeof args.replace === "string" ? args.replace : "";
    if (!search) return null;
    return [{ path: relPath, search, replace, offset: 0 }];
  }

  const content = typeof args.content === "string" ? args.content : "";
  return [toWholeFileEditBlock(relPath, content, rootDir)];
}

function normalizeToolPath(raw: unknown, rootDir: string): string | null {
  if (typeof raw !== "string" || raw.length === 0) return null;
  const absRoot = resolve(rootDir);

  if (looksLikeAbsoluteSystemPath(raw)) {
    const abs = resolve(raw);
    if (!pathIsUnder(abs, absRoot)) return null;
    const rel = relative(absRoot, abs);
    return rel ? rel.replaceAll("\\", "/") : null;
  }

  let stripped = raw;
  while (stripped.startsWith("/") || stripped.startsWith("\\")) {
    stripped = stripped.slice(1);
  }
  if (!stripped) return null;

  const abs = resolve(absRoot, stripped);
  if (!pathIsUnder(abs, absRoot)) return null;
  const rel = relative(absRoot, abs);
  return rel ? rel.replaceAll("\\", "/") : null;
}
