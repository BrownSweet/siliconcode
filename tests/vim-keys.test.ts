/** Pure NORMAL-mode vim reducer — motions, operators, edits, registers, undo signal. */

import { describe, expect, it } from "vitest";
import type { MultilineKey } from "../src/cli/ui/multiline-keys.js";
import {
  INITIAL_VIM_STATE,
  type VimMode,
  type VimState,
  normalCursorOnExit,
  vimNormal,
} from "../src/cli/ui/vim-keys.js";

function key(input: string, extra: Partial<MultilineKey> = {}): MultilineKey {
  return { input, ...extra };
}

interface Snapshot {
  value: string;
  cursor: number;
  mode: VimMode;
  state: VimState;
  undo: boolean;
}

/** Feed a sequence of NORMAL-mode keys, threading state. (Insert-mode keystrokes are out of scope.) */
function drive(value: string, cursor: number, keys: MultilineKey[]): Snapshot {
  let v = value;
  let c = cursor;
  let mode: VimMode = "normal";
  let state = INITIAL_VIM_STATE;
  let undo = false;
  for (const ki of keys) {
    const r = vimNormal(v, c, ki, state);
    state = r.state;
    undo = r.undo ?? false;
    if (r.next !== null) v = r.next;
    if (r.cursor !== null) c = r.cursor;
    if (r.mode) mode = r.mode;
  }
  return { value: v, cursor: c, mode, state, undo };
}

describe("vimNormal — mode entry", () => {
  it("i keeps the cursor and enters insert", () => {
    const r = drive("abc", 1, [key("i")]);
    expect(r.mode).toBe("insert");
    expect(r.cursor).toBe(1);
    expect(r.value).toBe("abc");
  });

  it("a moves one right and enters insert (clamped to line end)", () => {
    expect(drive("abc", 1, [key("a")])).toMatchObject({ mode: "insert", cursor: 2 });
    expect(drive("abc", 3, [key("a")])).toMatchObject({ mode: "insert", cursor: 3 });
  });

  it("A jumps to end of line; I to first non-blank", () => {
    expect(drive("ab\ncd", 0, [key("A")])).toMatchObject({ mode: "insert", cursor: 2 });
    expect(drive("  ab", 4, [key("I")])).toMatchObject({ mode: "insert", cursor: 2 });
  });

  it("o opens a line below; O above — both enter insert", () => {
    expect(drive("ab", 1, [key("o")])).toMatchObject({ value: "ab\n", cursor: 3, mode: "insert" });
    expect(drive("ab", 1, [key("O")])).toMatchObject({ value: "\nab", cursor: 0, mode: "insert" });
  });
});

describe("vimNormal — motions", () => {
  it("h/l stay within the line; j/k move between lines", () => {
    expect(drive("abc", 2, [key("h")]).cursor).toBe(1);
    expect(drive("abc", 0, [key("h")]).cursor).toBe(0); // clamped at line start
    expect(drive("abc", 1, [key("l")]).cursor).toBe(2);
    expect(drive("ab\ncd", 1, [key("j")]).cursor).toBe(4);
    expect(drive("ab\ncd", 4, [key("k")]).cursor).toBe(1);
  });

  it("0 / ^ / $ jump within the line", () => {
    expect(drive("  abc", 4, [key("0")]).cursor).toBe(0);
    expect(drive("  abc", 4, [key("^")]).cursor).toBe(2);
    expect(drive("abc\ndef", 0, [key("$")]).cursor).toBe(3);
  });

  it("w / b / e move by word", () => {
    expect(drive("foo bar baz", 0, [key("w")]).cursor).toBe(4);
    expect(drive("foo bar baz", 8, [key("b")]).cursor).toBe(4);
    expect(drive("foo bar", 0, [key("e")]).cursor).toBe(3);
  });

  it("gg goes to the buffer start; G to the last line", () => {
    expect(drive("a\nb\nc", 4, [key("g"), key("g")]).cursor).toBe(0);
    expect(drive("a\nb\nc", 0, [key("G")]).cursor).toBe(4);
  });

  it("a lone g prefix is abandoned by a non-g key", () => {
    const r = drive("abc", 0, [key("g"), key("l")]);
    expect(r.state.pending).toBe("");
  });
});

describe("vimNormal — edits", () => {
  it("x deletes the char under the cursor into the register", () => {
    const r = drive("abc", 1, [key("x")]);
    expect(r.value).toBe("ac");
    expect(r.cursor).toBe(1);
    expect(r.state.register).toBe("b");
  });

  it("x is a no-op on an empty line / past content", () => {
    expect(drive("a\n\nb", 2, [key("x")]).value).toBe("a\n\nb");
  });

  it("D deletes to end of line; C deletes and enters insert", () => {
    expect(drive("abcdef", 3, [key("D")])).toMatchObject({ value: "abc", cursor: 3 });
    expect(drive("abcdef", 3, [key("C")])).toMatchObject({ value: "abc", mode: "insert" });
  });

  it("dd deletes the whole line", () => {
    expect(drive("a\nb\nc", 0, [key("d"), key("d")]).value).toBe("b\nc");
    expect(drive("a\nb\nc", 2, [key("d"), key("d")]).value).toBe("a\nc");
  });

  it("dw deletes a word (with trailing space); cw leaves the space and enters insert", () => {
    expect(drive("foo bar", 0, [key("d"), key("w")]).value).toBe("bar");
    expect(drive("foo bar", 0, [key("c"), key("w")])).toMatchObject({
      value: " bar",
      mode: "insert",
    });
  });

  it("d$ deletes to end of line", () => {
    expect(drive("abcdef", 2, [key("d"), key("$")]).value).toBe("ab");
  });

  it("an invalid motion cancels a pending operator without mutating", () => {
    const r = drive("abc", 0, [key("d"), key("z")]);
    expect(r.value).toBe("abc");
    expect(r.state.pending).toBe("");
  });
});

describe("vimNormal — yank / paste", () => {
  it("yy yanks a line; p pastes it below", () => {
    const r = drive("a\nb", 0, [key("y"), key("y"), key("p")]);
    expect(r.value).toBe("a\na\nb");
    expect(r.state.registerLinewise).toBe(true);
  });

  it("x then p pastes the char after the cursor", () => {
    // "abc" → x at 0 removes 'a' (reg 'a'), cursor 0 on 'b' → p inserts 'a' after → "bac"
    const r = drive("abc", 0, [key("x"), key("p")]);
    expect(r.value).toBe("bac");
  });

  it("P pastes a linewise register above the current line", () => {
    const r = drive("a\nb", 2, [key("y"), key("y")]);
    // re-drive: yy on line 2 yanks "b", move to line 1, P
    const r2 = drive("a\nb", 2, [key("y"), key("y"), key("k"), key("P")]);
    expect(r.state.register).toBe("b");
    expect(r2.value).toBe("b\na\nb");
  });
});

describe("vimNormal — undo + escape", () => {
  it("u signals an undo request", () => {
    expect(drive("abc", 0, [key("u")]).undo).toBe(true);
  });

  it("escape clears pending state and stays in normal", () => {
    const r = drive("abc", 0, [key("d"), key("Escape", { escape: true })]);
    expect(r.mode).toBe("normal");
    expect(r.state.pending).toBe("");
  });

  it("printable keys never mutate the buffer in normal mode", () => {
    expect(drive("abc", 0, [key("z"), key("Z"), key("5")]).value).toBe("abc");
  });
});

describe("normalCursorOnExit — INSERT→NORMAL cursor never lands past the line", () => {
  it("steps back one within the line", () => {
    expect(normalCursorOnExit("hello", 3)).toBe(2);
  });

  it("clamps to the last real char after `o` then Esc (regression: was out of bounds)", () => {
    // After `o`, buffer is "hello\n" with the insert cursor at 6 (the new empty line).
    expect(normalCursorOnExit("hello\n", 6)).toBe(6); // empty last line: rests at its start
    // After typing on a non-empty appended line, rest on its last char, not past it.
    expect(normalCursorOnExit("hello\nx", 7)).toBe(6);
  });

  it("never goes before the line start", () => {
    expect(normalCursorOnExit("a\nbc", 2)).toBe(2); // start of line "bc"
    expect(normalCursorOnExit("abc", 0)).toBe(0);
  });
});
