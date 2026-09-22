import { describe, expect, it } from "vitest";
import { wantsDeepThinking } from "../src/loop/thinking.js";

describe("wantsDeepThinking — natural-language deep-think trigger", () => {
  it("matches English 'think harder' phrasings", () => {
    for (const s of [
      "ultrathink about this",
      "ultra-think it through",
      "please think hard about the design",
      "think harder before you edit",
      "think deeply here",
      "let's think step by step",
      "think this through",
      "think carefully about the edge cases",
      "reason carefully about concurrency",
    ]) {
      expect(wantsDeepThinking(s), s).toBe(true);
    }
  });

  it("matches Chinese deep-think phrasings", () => {
    for (const s of [
      "深入思考一下这个设计",
      "深度思考这个问题",
      "仔细想想再动手",
      "好好想想边界情况",
      "认真想想怎么改",
      "深思熟虑之后再说",
    ]) {
      expect(wantsDeepThinking(s), s).toBe(true);
    }
  });

  it("does not over-trigger on ordinary requests", () => {
    for (const s of [
      "fix the bug in parse()",
      "I think hardcoded values are bad", // 'think hard' word-boundary guard
      "run the tests first",
      "重构一下登录函数",
      "我想清楚了，改这个函数", // '想清楚' intentionally not a trigger
      "add a button to the page",
      "",
    ]) {
      expect(wantsDeepThinking(s), s).toBe(false);
    }
  });
});
