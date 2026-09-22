/** Pure NORMAL-mode reducer for the composer's vim layer (INSERT is handled by
   processMultilineKey): motions, d/c/y operators + dd/cc/yy, x/D/C, p/P, u-undo. */

import {
  type MultilineKey,
  endOfLine,
  firstNonBlank,
  moveCursorDown,
  moveCursorUp,
  nextWordEnd,
  nextWordStart,
  previousWordStart,
  startOfLine,
} from "./multiline-keys.js";

export type VimMode = "insert" | "normal";

export interface VimState {
  /** Pending operator ("d"/"c"/"y") or "g" prefix awaiting a second key; "" = none. */
  pending: "" | "d" | "c" | "y" | "g";
  /** Unnamed register for p/P. */
  register: string;
  /** Register holds whole line(s) (dd/yy/cc) → p opens a new line below. */
  registerLinewise: boolean;
}

export const INITIAL_VIM_STATE: VimState = {
  pending: "",
  register: "",
  registerLinewise: false,
};

export interface VimResult {
  /** New buffer value, or null = unchanged. */
  next: string | null;
  /** New cursor (0..len), or null = unchanged. */
  cursor: number | null;
  /** Mode transition target, or null = stay in normal. */
  mode: VimMode | null;
  /** Updated vim state (pending/register). */
  state: VimState;
  /** `u` — parent pops its undo stack. */
  undo?: boolean;
}

function clamp(c: number, value: string): number {
  return Math.max(0, Math.min(c, value.length));
}

/** Cursor when leaving INSERT for NORMAL: step back one, but never past the line's last real char. */
export function normalCursorOnExit(value: string, cursor: number): number {
  const lineStart = startOfLine(value, cursor);
  const nl = value.indexOf("\n", cursor);
  const lastCol = (nl === -1 ? value.length : nl) - 1;
  return Math.max(lineStart, Math.min(cursor - 1, Math.max(lineStart, lastCol)));
}

/** [start, endExclusive] of the cursor's line including its trailing newline. */
function lineSpan(value: string, cursor: number): [number, number] {
  const start = startOfLine(value, cursor);
  const nl = value.indexOf("\n", cursor);
  return [start, nl === -1 ? value.length : nl + 1];
}

const NOOP = (state: VimState): VimResult => ({ next: null, cursor: null, mode: null, state });

/** Range a motion key would cover from `cursor`; null if the key isn't a motion. */
function motionRange(
  value: string,
  cursor: number,
  key: MultilineKey,
): { a: number; b: number; linewise: boolean } | null {
  const ls = startOfLine(value, cursor);
  const le = endOfLine(value, cursor);
  const ch = key.input;
  if (ch === "w") return { a: cursor, b: nextWordStart(value, cursor), linewise: false };
  if (ch === "e")
    return { a: cursor, b: Math.min(value.length, nextWordEnd(value, cursor)), linewise: false };
  if (ch === "b") return { a: previousWordStart(value, cursor), b: cursor, linewise: false };
  if (ch === "0" || key.home) return { a: ls, b: cursor, linewise: false };
  if (ch === "^") return { a: firstNonBlank(value, cursor), b: cursor, linewise: false };
  if (ch === "$" || key.end) return { a: cursor, b: le, linewise: false };
  if (ch === "h" || key.leftArrow)
    return { a: Math.max(ls, cursor - 1), b: cursor, linewise: false };
  if (ch === "l" || key.rightArrow)
    return { a: cursor, b: Math.min(le, cursor + 1), linewise: false };
  if (ch === "j" || key.downArrow) {
    const [, end] = lineSpan(value, cursor);
    if (end >= value.length) return null; // no line below
    const [, end2] = lineSpan(value, end);
    return { a: ls, b: end2, linewise: true };
  }
  if (ch === "k" || key.upArrow) {
    if (ls === 0) return null; // no line above
    const prevStart = startOfLine(value, ls - 1);
    const [, end] = lineSpan(value, cursor);
    return { a: prevStart, b: end, linewise: true };
  }
  return null;
}

function applyOperator(
  op: "d" | "c" | "y",
  value: string,
  a: number,
  b: number,
  linewise: boolean,
  state: VimState,
): VimResult {
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  const text = value.slice(lo, hi);
  const nextState: VimState = { pending: "", register: text, registerLinewise: linewise };
  if (op === "y") {
    return { next: null, cursor: lo, mode: null, state: nextState };
  }
  const next = value.slice(0, lo) + value.slice(hi);
  return {
    next,
    cursor: clamp(lo, next),
    mode: op === "c" ? "insert" : null,
    state: nextState,
  };
}

/** Doubled operator: dd / cc / yy operate on the whole current line. */
function applyLinewiseSelf(op: "d" | "c" | "y", value: string, cursor: number): VimResult {
  const [ls, le] = lineSpan(value, cursor); // includes trailing newline
  const contentEnd = endOfLine(value, cursor);
  if (op === "y") {
    return {
      next: null,
      cursor: ls,
      mode: null,
      state: { pending: "", register: value.slice(ls, le), registerLinewise: true },
    };
  }
  if (op === "c") {
    // Clear the line's content, keep the (now empty) line, enter insert at its start.
    const next = value.slice(0, ls) + value.slice(contentEnd);
    return {
      next,
      cursor: ls,
      mode: "insert",
      state: { pending: "", register: value.slice(ls, contentEnd), registerLinewise: true },
    };
  }
  // dd: remove the whole line including its newline.
  const next = value.slice(0, ls) + value.slice(le);
  return {
    next,
    cursor: clamp(firstNonBlank(next, Math.min(ls, next.length)), next),
    mode: null,
    state: { pending: "", register: value.slice(ls, le), registerLinewise: true },
  };
}

function paste(value: string, cursor: number, state: VimState, before: boolean): VimResult {
  if (!state.register) return NOOP(state);
  if (state.registerLinewise) {
    const [ls, le] = lineSpan(value, cursor);
    const reg = state.register.endsWith("\n") ? state.register : `${state.register}\n`;
    const at = before ? ls : le;
    const next = value.slice(0, at) + reg + value.slice(at);
    return { next, cursor: clamp(at, next), mode: null, state };
  }
  const at = before ? cursor : Math.min(value.length, cursor + 1);
  const next = value.slice(0, at) + state.register + value.slice(at);
  return { next, cursor: clamp(at + state.register.length - 1, next), mode: null, state };
}

/** Stateful entry point: routes by `state.pending`. */
export function vimNormal(
  value: string,
  cursor: number,
  key: MultilineKey,
  state: VimState,
): VimResult {
  if (key.escape) {
    return { next: null, cursor: null, mode: "normal", state: INITIAL_VIM_STATE };
  }

  // Pending `g` (waiting for the second g of `gg`).
  if (state.pending === "g") {
    if (key.input === "g") {
      return { next: null, cursor: 0, mode: null, state: INITIAL_VIM_STATE };
    }
    return NOOP(INITIAL_VIM_STATE); // abandon the g prefix
  }

  // Pending operator: this key is the motion (or the doubled operator).
  if (state.pending === "d" || state.pending === "c" || state.pending === "y") {
    const op = state.pending;
    if (key.input === op) return applyLinewiseSelf(op, value, cursor);
    // vim quirk: `cw` acts like `ce` — change to word-end, leaving the trailing space.
    if (op === "c" && key.input === "w") {
      return applyOperator(
        op,
        value,
        cursor,
        Math.min(value.length, nextWordEnd(value, cursor)),
        false,
        state,
      );
    }
    const range = motionRange(value, cursor, key);
    if (!range) return NOOP(INITIAL_VIM_STATE); // invalid motion → cancel operator
    return applyOperator(op, value, range.a, range.b, range.linewise, state);
  }

  // ── insert-entry keys ─────────────────────────────────────────────
  if (key.input === "i") return { next: null, cursor: null, mode: "insert", state };
  if (key.input === "a") {
    const le = endOfLine(value, cursor);
    return { next: null, cursor: Math.min(le, cursor + 1), mode: "insert", state };
  }
  if (key.input === "I") {
    return { next: null, cursor: firstNonBlank(value, cursor), mode: "insert", state };
  }
  if (key.input === "A") {
    return { next: null, cursor: endOfLine(value, cursor), mode: "insert", state };
  }
  if (key.input === "o") {
    const le = endOfLine(value, cursor);
    const next = `${value.slice(0, le)}\n${value.slice(le)}`;
    return { next, cursor: le + 1, mode: "insert", state };
  }
  if (key.input === "O") {
    const ls = startOfLine(value, cursor);
    const next = `${value.slice(0, ls)}\n${value.slice(ls)}`;
    return { next, cursor: ls, mode: "insert", state };
  }

  // ── operators (await a motion) ────────────────────────────────────
  if (key.input === "d" || key.input === "c" || key.input === "y") {
    return { next: null, cursor: null, mode: null, state: { ...state, pending: key.input } };
  }
  if (key.input === "g") {
    return { next: null, cursor: null, mode: null, state: { ...state, pending: "g" } };
  }

  // ── single-key edits ──────────────────────────────────────────────
  if (key.input === "x") {
    if (cursor >= value.length || value[cursor] === "\n") return NOOP(state);
    const next = value.slice(0, cursor) + value.slice(cursor + 1);
    return {
      next,
      cursor: clamp(cursor, next),
      mode: null,
      state: { ...state, register: value[cursor] ?? "", registerLinewise: false },
    };
  }
  if (key.input === "D") {
    const le = endOfLine(value, cursor);
    if (le === cursor) return NOOP(state);
    const next = value.slice(0, cursor) + value.slice(le);
    return {
      next,
      cursor: clamp(cursor, next),
      mode: null,
      state: { ...state, register: value.slice(cursor, le), registerLinewise: false },
    };
  }
  if (key.input === "C") {
    const le = endOfLine(value, cursor);
    const next = value.slice(0, cursor) + value.slice(le);
    return {
      next,
      cursor: cursor,
      mode: "insert",
      state: { ...state, register: value.slice(cursor, le), registerLinewise: false },
    };
  }
  if (key.input === "p") return paste(value, cursor, state, false);
  if (key.input === "P") return paste(value, cursor, state, true);
  if (key.input === "u") return { next: null, cursor: null, mode: null, state, undo: true };

  // ── motions ───────────────────────────────────────────────────────
  if (key.input === "G") {
    return { next: null, cursor: firstNonBlank(value, value.length), mode: null, state };
  }
  // j/k preserve the column (the linewise motionRange below is operator-only).
  if (key.input === "j" || key.downArrow) {
    return { next: null, cursor: moveCursorDown(value, cursor), mode: null, state };
  }
  if (key.input === "k" || key.upArrow) {
    return { next: null, cursor: moveCursorUp(value, cursor), mode: null, state };
  }
  const range = motionRange(value, cursor, key);
  if (range && !range.linewise) {
    // A charwise motion's resting cursor is the far end in the direction of travel.
    const backwards = range.b === cursor && range.a !== cursor;
    return { next: null, cursor: clamp(backwards ? range.a : range.b, value), mode: null, state };
  }

  // Unknown key in normal mode — swallow it (never insert printable text).
  return NOOP(state);
}
