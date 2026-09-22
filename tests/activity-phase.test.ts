import { afterAll, describe, expect, it } from "vitest";
import { deriveActivityLabel } from "../src/cli/ui/hooks/useActivityPhase.js";
import type { Card } from "../src/cli/ui/state/cards.js";
import { getLanguage, setLanguageRuntime } from "../src/i18n/index.js";

function user(id: string): Card {
  return { id, ts: 0, kind: "user", text: "" };
}
function reasoning(id: string, streaming: boolean): Card {
  return { id, ts: 0, kind: "reasoning", text: "", paragraphs: 0, tokens: 0, streaming };
}
function tool(id: string, done: boolean): Card {
  return { id, ts: 0, kind: "tool", name: "read_file", args: {}, output: "", done, elapsedMs: 0 };
}
function streaming(id: string, done: boolean): Card {
  return { id, ts: 0, kind: "streaming", text: "", done };
}

describe("deriveActivityLabel", () => {
  const originalLang = getLanguage();

  afterAll(() => {
    setLanguageRuntime(originalLang);
  });

  it("returns a localized waiting label when only the user card exists", () => {
    setLanguageRuntime("zh-CN");
    expect(deriveActivityLabel([user("u1")])).toBe("等待模型…");
  });

  it("returns a localized waiting label when card list is empty", () => {
    setLanguageRuntime("zh-CN");
    expect(deriveActivityLabel([])).toBe("等待模型…");
  });

  it("returns a localized thinking label while a reasoning card is streaming", () => {
    setLanguageRuntime("zh-CN");
    expect(deriveActivityLabel([user("u1"), reasoning("r1", true)])).toBe("思考中…");
  });

  it("returns a localized processing label once reasoning has settled", () => {
    setLanguageRuntime("zh-CN");
    expect(deriveActivityLabel([user("u1"), reasoning("r1", false)])).toBe("处理中…");
  });

  it("returns a localized processing label between a finished tool and the next event", () => {
    setLanguageRuntime("zh-CN");
    expect(deriveActivityLabel([user("u1"), tool("t1", true)])).toBe("处理中…");
  });

  it("prefers the localized thinking label even when a settled reasoning card sits later", () => {
    setLanguageRuntime("zh-CN");
    expect(deriveActivityLabel([user("u1"), reasoning("r1", true), reasoning("r2", false)])).toBe(
      "思考中…",
    );
  });

  it("returns a localized processing label when the last card is a streaming content card", () => {
    setLanguageRuntime("zh-CN");
    expect(deriveActivityLabel([user("u1"), streaming("s1", false)])).toBe("处理中…");
  });

  it("still supports English labels when the runtime language is EN", () => {
    setLanguageRuntime("EN");
    expect(deriveActivityLabel([user("u1")])).toBe("waiting for model…");
    expect(deriveActivityLabel([user("u1"), reasoning("r1", true)])).toBe("thinking…");
    expect(deriveActivityLabel([user("u1"), tool("t1", true)])).toBe("processing…");
  });
});
