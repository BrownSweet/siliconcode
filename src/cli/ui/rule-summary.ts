import { basename, relative, resolve } from "node:path";
import { t } from "../../i18n/index.js";
import { memoryEnabled, readProjectMemory } from "../../memory/project.js";

export function collectStartupRuleFiles(rootDir: string): string[] {
  if (!memoryEnabled()) return [];
  const mem = readProjectMemory(rootDir);
  return mem ? [mem.path] : [];
}

export function formatRuleSummary(rootDir: string, files: ReadonlyArray<string>): string | null {
  const labels = unique(files)
    .map((file) => displayRulePath(rootDir, file))
    .filter((label) => label.length > 0);
  if (labels.length === 0) return null;
  return `${t("ui.ruleSummaryLabel")} · ${labels.join(", ")}`;
}

function unique(files: ReadonlyArray<string>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const file of files) {
    const normalized = resolve(file);
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }
  return out;
}

function displayRulePath(rootDir: string, file: string): string {
  const rel = relative(resolve(rootDir), resolve(file)).replaceAll("\\", "/");
  if (!rel || rel.startsWith("../") || rel === "..") return basename(file);
  return rel;
}
