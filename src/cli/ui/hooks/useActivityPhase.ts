import { t } from "../../../i18n/index.js";
import type { Card } from "../state/cards.js";
import { useAgentState } from "../state/provider.js";

export function deriveActivityLabel(cards: ReadonlyArray<Card>): string {
  if (cards.some((c) => c.kind === "reasoning" && c.streaming)) {
    return t("ui.activityThinking");
  }
  const last = cards[cards.length - 1];
  if (!last || last.kind === "user") return t("ui.activityWaitingForModel");
  return t("ui.activityProcessing");
}

export function useActivityLabel(): string {
  return useAgentState((s) => deriveActivityLabel(s.cards));
}
