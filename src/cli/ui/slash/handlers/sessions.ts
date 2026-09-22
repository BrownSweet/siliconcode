import { t } from "../../../../i18n/index.js";
import type { SlashHandler } from "../dispatch.js";

const sessions: SlashHandler = () => ({ openSessionsPicker: true });

const exportHandler: SlashHandler = (args) => ({
  exportSession: { format: args[0]?.toLowerCase() === "json" ? "json" : "md" },
});

const title: SlashHandler = (_args, _loop, ctx) => {
  if (!ctx.generateSessionTitle || !ctx.postInfo) {
    return { info: t("handlers.sessions.titleUnavailable") };
  }
  void ctx.generateSessionTitle().then(
    (info) => ctx.postInfo?.(info),
    (err) =>
      ctx.postInfo?.(
        t("handlers.sessions.titleFailed", {
          reason: err instanceof Error ? err.message : String(err),
        }),
      ),
  );
  return { info: t("handlers.sessions.titleStarted") };
};

export const handlers: Record<string, SlashHandler> = {
  sessions,
  // /resume is Claude Code's name for the same recent-session picker (restores on pick).
  resume: sessions,
  export: exportHandler,
  title,
};
