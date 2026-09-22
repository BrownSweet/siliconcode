import { defaultConfigPath, loadResolvedSkillPaths } from "@/config.js";
import { t } from "@/i18n/index.js";
import { type Skill, SkillStore } from "@/skills.js";
import type { SlashHandler } from "../dispatch.js";

/** "deepseek-v4-pro" → "pro"; undefined → "default". */
function shortModel(model: string | undefined): string {
  if (!model) return "default";
  if (model.endsWith("pro")) return "pro";
  if (model.endsWith("flash")) return "flash";
  return model;
}

function fit(value: string, width: number): string {
  // ASCII columns (scope/name/model/tools) — truncate then pad to a fixed width so
  // rows stay aligned regardless of tool-list length.
  const v = value.length > width ? `${value.slice(0, width - 1)}…` : value;
  return v.padEnd(width);
}

function agentRow(s: Skill): string {
  const scope = fit(`(${s.scope})`, 11);
  const name = fit(s.name, 20);
  const model = fit(shortModel(s.model), 8);
  const tools = fit(s.allowedTools?.length ? s.allowedTools.join(",") : "inherits", 16);
  // desc is the last (ragged) column — the chat renderer wraps it; keep it readable.
  const desc = s.description.length > 60 ? `${s.description.slice(0, 59)}…` : s.description;
  return `  ${scope} ${name} ${model} ${tools} ${desc}`;
}

const agents: SlashHandler = (args, _loop, ctx) => {
  const baseDir = ctx.codeRoot ?? process.cwd();
  const configPath = ctx.configPath ?? defaultConfigPath();
  const store = new SkillStore({
    projectRoot: ctx.codeRoot,
    customSkillPaths: loadResolvedSkillPaths(baseDir, configPath),
  });
  const sub = (args[0] ?? "").toLowerCase();

  if (sub === "new" || sub === "init") {
    const name = args[1];
    if (!name) return { info: t("handlers.agents.newUsage") };
    const wantsGlobal = args.slice(2).includes("--global") || !ctx.codeRoot;
    const result = store.createAgent(name, wantsGlobal ? "global" : "project");
    if ("error" in result) {
      return { info: t("handlers.agents.newError", { reason: result.error }) };
    }
    return { info: t("handlers.agents.newCreated", { name, path: result.path }) };
  }

  if (sub === "show" || sub === "cat") {
    const target = args[1];
    if (!target) return { info: t("handlers.agents.showUsage") };
    const found = store.readAgent(target);
    if (!found) {
      return { info: t("handlers.agents.showNotFound", { name: target }) };
    }
    return {
      info: [
        `▸ ${found.name}  (${found.scope})  model=${shortModel(found.model)}`,
        found.description ? `  ${found.description}` : "",
        `  ${found.path}`,
        "",
        found.body,
      ]
        .filter((l) => l !== "")
        .join("\n"),
    };
  }

  // bare / list
  const list = store.listAgents();
  const lines = [t("handlers.agents.listHeader", { count: list.length })];
  for (const s of list) lines.push(agentRow(s));
  lines.push(
    "",
    t("handlers.agents.listAddHint"),
    t("handlers.agents.listInvokeHint"),
    t("handlers.agents.listNewHint"),
  );
  return { info: lines.join("\n") };
};

export const handlers: Record<string, SlashHandler> = {
  agents,
  agent: agents,
};
