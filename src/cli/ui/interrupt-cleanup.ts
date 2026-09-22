import type { Card, SubAgentCard, TaskCard } from "./state/cards.js";

export function cleanupInterruptedCards(
  cards: ReadonlyArray<Card>,
  endedAt = Date.now(),
): ReadonlyArray<Card> {
  let changed = false;
  const next: Card[] = [];

  for (const card of cards) {
    if (card.kind === "live" && card.variant === "thinking") {
      changed = true;
      continue;
    }

    const cleaned = cleanupInterruptedCard(card, endedAt);
    if (cleaned !== card) changed = true;
    next.push(cleaned);
  }

  return changed ? next : cards;
}

function cleanupInterruptedCard(card: Card, endedAt: number): Card {
  if (card.kind === "reasoning" && card.streaming) {
    return {
      ...card,
      streaming: false,
      aborted: true,
      endedAt,
      paragraphs: card.paragraphs || countParagraphs(card.text),
      tokens: card.tokens || Math.round(card.text.length / 4),
    };
  }

  if (card.kind === "streaming" && !card.done) {
    return { ...card, done: true, aborted: true, endedAt };
  }

  if (card.kind === "tool" && !card.done) {
    return { ...card, done: true, aborted: true };
  }

  if (card.kind === "task" && card.status === "running") {
    return cleanupTaskCard(card);
  }

  if (card.kind === "subagent" && card.status === "running") {
    return cleanupSubagentCard(card, endedAt);
  }

  return card;
}

function cleanupTaskCard(card: TaskCard): TaskCard {
  let stepChanged = false;
  const steps = card.steps.map((step) => {
    if (step.status !== "running") return step;
    stepChanged = true;
    return { ...step, status: "failed" as const };
  });
  return {
    ...card,
    status: "failed",
    steps: stepChanged ? steps : card.steps,
  };
}

function cleanupSubagentCard(card: SubAgentCard, endedAt: number): SubAgentCard {
  const children = cleanupInterruptedCards(card.children, endedAt);
  return {
    ...card,
    status: "failed",
    children: children === card.children ? card.children : [...children],
  };
}

function countParagraphs(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\n\s*\n/).length;
}
