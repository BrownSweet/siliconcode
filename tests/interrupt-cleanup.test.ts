import { describe, expect, it } from "vitest";
import { cleanupInterruptedCards } from "../src/cli/ui/interrupt-cleanup.js";
import type { Card } from "../src/cli/ui/state/cards.js";

describe("cleanupInterruptedCards", () => {
  it("settles in-flight assistant and tool rows while preserving completed history", () => {
    const cards: Card[] = [
      { kind: "user", id: "u1", ts: 1, text: "fix tests" },
      {
        kind: "reasoning",
        id: "r1",
        ts: 2,
        text: "thinking",
        paragraphs: 0,
        tokens: 0,
        streaming: true,
      },
      { kind: "streaming", id: "s1", ts: 3, text: "partial", done: false },
      {
        kind: "tool",
        id: "t1",
        ts: 4,
        name: "run_command",
        args: { command: "npm test" },
        output: "",
        done: false,
        elapsedMs: 0,
      },
      { kind: "live", id: "think1", ts: 5, variant: "thinking", text: "thinking", tone: "brand" },
      {
        kind: "tool",
        id: "t2",
        ts: 6,
        name: "read_file",
        args: { path: "src/a.ts" },
        output: "ok",
        done: true,
        elapsedMs: 12,
      },
      {
        kind: "plan",
        id: "p1",
        ts: 7,
        title: "approved plan",
        steps: [{ id: "one", title: "one", status: "queued" }],
        variant: "active",
      },
    ];

    const cleaned = cleanupInterruptedCards(cards, 1234);

    expect(cleaned.find((card) => card.id === "think1")).toBeUndefined();
    expect(cleaned.find((card) => card.id === "r1")).toMatchObject({
      kind: "reasoning",
      streaming: false,
      aborted: true,
      endedAt: 1234,
    });
    expect(cleaned.find((card) => card.id === "s1")).toMatchObject({
      kind: "streaming",
      done: true,
      aborted: true,
      endedAt: 1234,
    });
    expect(cleaned.find((card) => card.id === "t1")).toMatchObject({
      kind: "tool",
      done: true,
      aborted: true,
    });
    expect(cleaned.find((card) => card.id === "t2")).toEqual(cards[5]);
    expect(cleaned.find((card) => card.id === "p1")).toEqual(cards[6]);
  });

  it("is idempotent after the first cleanup", () => {
    const cards: Card[] = [
      { kind: "streaming", id: "s1", ts: 1, text: "partial", done: false },
      { kind: "live", id: "think1", ts: 2, variant: "thinking", text: "thinking", tone: "brand" },
    ];

    const once = cleanupInterruptedCards(cards, 10);
    const twice = cleanupInterruptedCards(once, 20);

    expect(twice).toEqual(once);
  });
});
