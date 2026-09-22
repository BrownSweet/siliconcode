export type ThemeName =
  | "default"
  | "dark"
  | "light"
  | "tokyo-night"
  | "github-dark"
  | "github-light"
  | "high-contrast";

export interface ThemeTokens {
  fg: {
    strong: string;
    body: string;
    sub: string;
    meta: string;
    faint: string;
  };
  tone: {
    brand: string;
    accent: string;
    violet: string;
    ok: string;
    warn: string;
    err: string;
    info: string;
  };
  toneActive: ThemeTokens["tone"];
  surface: {
    bg: string;
    bgInput: string;
    bgCode: string;
    bgElev: string;
  };
  /** Diff add/del foreground + background washes, tuned per theme (light vs dark). */
  diff: {
    addFg: string;
    addBg: string;
    delFg: string;
    delBg: string;
  };
  card: Record<
    | "user"
    | "reasoning"
    | "streaming"
    | "task"
    | "tool"
    | "plan"
    | "diff"
    | "error"
    | "warn"
    | "usage"
    | "subagent"
    | "approval"
    | "search"
    | "memory"
    | "ctx"
    | "doctor"
    | "branch",
    { color: string; glyph: string }
  >;
}

type ThemeBase = Omit<ThemeTokens, "card">;

function card(fg: ThemeTokens["fg"], tone: ThemeTokens["tone"]): ThemeTokens["card"] {
  return {
    user: { color: tone.brand, glyph: "◇" },
    reasoning: { color: tone.accent, glyph: "◆" },
    streaming: { color: tone.brand, glyph: "◈" },
    task: { color: tone.warn, glyph: "▶" },
    tool: { color: tone.info, glyph: "▣" },
    plan: { color: tone.accent, glyph: "⊞" },
    diff: { color: tone.ok, glyph: "±" },
    error: { color: tone.err, glyph: "✖" },
    warn: { color: tone.warn, glyph: "⚠" },
    usage: { color: fg.meta, glyph: "Σ" },
    subagent: { color: tone.violet, glyph: "⌬" },
    approval: { color: tone.warn, glyph: "?" },
    search: { color: tone.info, glyph: "⊙" },
    memory: { color: fg.meta, glyph: "⌑" },
    ctx: { color: tone.brand, glyph: "◔" },
    doctor: { color: fg.meta, glyph: "⚕" },
    branch: { color: tone.violet, glyph: "⎇" },
  };
}

function defineTheme(base: ThemeBase): ThemeTokens {
  return { ...base, card: card(base.fg, base.tone) };
}

const githubDark = defineTheme({
  fg: {
    strong: "#f8fafc",
    body: "#e5e7eb",
    sub: "#a1a1aa",
    meta: "#71717a",
    faint: "#52525b",
  },
  tone: {
    brand: "#d97757",
    accent: "#a78bfa",
    violet: "#c084fc",
    ok: "#22c55e",
    warn: "#eab308",
    err: "#ef4444",
    info: "#60a5fa",
  },
  toneActive: {
    brand: "#e89a82",
    accent: "#c4b5fd",
    violet: "#d8b4fe",
    ok: "#4ade80",
    warn: "#facc15",
    err: "#f87171",
    info: "#93c5fd",
  },
  surface: {
    bg: "#09090b",
    bgInput: "#111113",
    bgCode: "#050507",
    bgElev: "#18181b",
  },
  diff: {
    addFg: "#bef0c8",
    addBg: "#0c2718",
    delFg: "#fbc8c8",
    delBg: "#2a1212",
  },
});

const dark = defineTheme({
  fg: {
    strong: "#f4f7fb",
    body: "#d8dee9",
    sub: "#a7b1c2",
    meta: "#778294",
    faint: "#4d5666",
  },
  tone: {
    brand: "#d97757",
    accent: "#c084fc",
    violet: "#a78bfa",
    ok: "#86efac",
    warn: "#fbbf24",
    err: "#f87171",
    info: "#60a5fa",
  },
  toneActive: {
    brand: "#e89a82",
    accent: "#e9d5ff",
    violet: "#ddd6fe",
    ok: "#bbf7d0",
    warn: "#fde68a",
    err: "#fecaca",
    info: "#bfdbfe",
  },
  surface: {
    bg: "#0b1020",
    bgInput: "#111827",
    bgCode: "#080c16",
    bgElev: "#151d2f",
  },
  diff: {
    addFg: "#bef0c8",
    addBg: "#0c2718",
    delFg: "#fbc8c8",
    delBg: "#2a1212",
  },
});

const codexLightBase: ThemeBase = {
  fg: {
    strong: "#0d0d0d",
    body: "#111111",
    sub: "#666666",
    meta: "#9a9a9a",
    faint: "#c7c7c7",
  },
  tone: {
    brand: "#c2410c",
    accent: "#c000c0",
    violet: "#7a5cff",
    ok: "#238636",
    warn: "#8a7a00",
    err: "#c62828",
    info: "#0096a6",
  },
  toneActive: {
    brand: "#ea580c",
    accent: "#d000d0",
    violet: "#8a6dff",
    ok: "#2ea043",
    warn: "#9a8700",
    err: "#d32f2f",
    info: "#00a3b5",
  },
  surface: {
    bg: "#ffffff",
    bgInput: "#f2f2f2",
    bgCode: "#f5f5f5",
    bgElev: "#e7e7e7",
  },
  diff: {
    addFg: "#0a5a1a",
    addBg: "#d6f5dd",
    delFg: "#8a1a1a",
    delBg: "#fbdcdc",
  },
};

const light = defineTheme(codexLightBase);

const tokyoNight = defineTheme({
  fg: {
    strong: "#c0caf5",
    body: "#a9b1d6",
    sub: "#9aa5ce",
    meta: "#565f89",
    faint: "#414868",
  },
  tone: {
    brand: "#d97757",
    accent: "#bb9af7",
    violet: "#9d7cd8",
    ok: "#9ece6a",
    warn: "#e0af68",
    err: "#f7768e",
    info: "#2ac3de",
  },
  toneActive: {
    brand: "#e89a82",
    accent: "#d7b9ff",
    violet: "#c6a0f6",
    ok: "#b9f27c",
    warn: "#ffd089",
    err: "#ff9cac",
    info: "#7dcfff",
  },
  surface: {
    bg: "#1a1b26",
    bgInput: "#1f2335",
    bgCode: "#16161e",
    bgElev: "#24283b",
  },
  diff: {
    addFg: "#bef0c8",
    addBg: "#0c2718",
    delFg: "#fbc8c8",
    delBg: "#2a1212",
  },
});

const githubLight = defineTheme(codexLightBase);

const highContrast = defineTheme({
  fg: {
    strong: "#ffffff",
    body: "#f5f5f5",
    sub: "#d4d4d4",
    meta: "#bdbdbd",
    faint: "#8a8a8a",
  },
  tone: {
    brand: "#ff8c42",
    accent: "#ff4dff",
    violet: "#b388ff",
    ok: "#00ff66",
    warn: "#ffdd00",
    err: "#ff4d4d",
    info: "#4da3ff",
  },
  toneActive: {
    brand: "#ffab70",
    accent: "#ff99ff",
    violet: "#d0b3ff",
    ok: "#80ffb3",
    warn: "#ffee80",
    err: "#ff9999",
    info: "#99c9ff",
  },
  surface: {
    bg: "#000000",
    bgInput: "#0a0a0a",
    bgCode: "#050505",
    bgElev: "#141414",
  },
  diff: {
    addFg: "#aaffaa",
    addBg: "#06330f",
    delFg: "#ffb3b3",
    delBg: "#3a0d0d",
  },
});

export const THEMES = {
  default: githubDark,
  dark,
  light,
  "tokyo-night": tokyoNight,
  "github-dark": githubDark,
  "github-light": githubLight,
  "high-contrast": highContrast,
} as const satisfies Record<ThemeName, ThemeTokens>;

export const DEFAULT_THEME_NAME: ThemeName = "github-dark";

export function isThemeName(value: string): value is ThemeName {
  return Object.prototype.hasOwnProperty.call(THEMES, value);
}

export function resolveThemeName(value?: string | null): ThemeName {
  if (!value || value === "auto") return DEFAULT_THEME_NAME;
  return isThemeName(value) ? value : DEFAULT_THEME_NAME;
}

export function listThemeNames(): ThemeName[] {
  return Object.keys(THEMES) as ThemeName[];
}

export function themeTokens(name?: string | null): ThemeTokens {
  return THEMES[resolveThemeName(name)];
}

export const DEFAULT_THEME = THEMES[DEFAULT_THEME_NAME];

let activeTheme: ThemeTokens = DEFAULT_THEME;
let activeThemeVersion = 0;

export function setActiveTheme(theme: ThemeTokens): () => void {
  const previousTheme = activeTheme;
  activeTheme = theme;
  activeThemeVersion += 1;
  const version = activeThemeVersion;
  return () => {
    if (activeThemeVersion !== version || activeTheme !== theme) return;
    activeTheme = previousTheme;
    activeThemeVersion += 1;
  };
}

function proxyTokens<T extends object>(select: (theme: ThemeTokens) => T): T {
  const target = select(DEFAULT_THEME);
  return new Proxy(target, {
    get(_target, prop: string | symbol) {
      return select(activeTheme)[prop as keyof T];
    },
    getOwnPropertyDescriptor(_target, prop: string | symbol) {
      return Reflect.getOwnPropertyDescriptor(select(activeTheme), prop);
    },
    has(_target, prop: string | symbol) {
      return prop in select(activeTheme);
    },
    ownKeys() {
      return Reflect.ownKeys(select(activeTheme));
    },
  });
}

export const FG = proxyTokens((theme) => theme.fg);
export const TONE = proxyTokens((theme) => theme.tone);
export const TONE_ACTIVE = proxyTokens((theme) => theme.toneActive);
export const SURFACE = proxyTokens((theme) => theme.surface);
export const CARD = proxyTokens((theme) => theme.card);
export const DIFF = proxyTokens((theme) => theme.diff);

export type CardTone = keyof ThemeTokens["card"];

/** DeepSeek prices in CNY; our internal table is USD divided by 7.2. Multiply back for display. */
export const USD_TO_CNY = 7.2;

const SYMBOL: Record<string, string> = { USD: "$", CNY: "¥" };

/** Format an amount already in `currency`. Undefined currency → CNY (matches pre-fix behavior). */
export function formatBalance(
  amount: number,
  currency?: string,
  opts?: { fractionDigits?: number; label?: boolean },
): string {
  const cur = currency ?? "CNY";
  const sym = SYMBOL[cur];
  const digits = opts?.fractionDigits ?? 2;
  const body = sym ? `${sym}${amount.toFixed(digits)}` : `${cur} ${amount.toFixed(digits)}`;
  return opts?.label ? `w ${body}` : body;
}

/** Format an internal USD cost in the wallet's display currency. Undefined currency → CNY. */
export function formatCost(costUsd: number, currency?: string, fractionDigits = 4): string {
  const cur = currency ?? "CNY";
  const amount = cur === "CNY" ? costUsd * USD_TO_CNY : costUsd;
  return formatBalance(amount, cur, { fractionDigits });
}

/** Threshold color for a wallet balance. USD is converted to CNY before the threshold check. */
export function balanceColor(amount: number, currency?: string): string {
  const cny = (currency ?? "CNY") === "USD" ? amount * USD_TO_CNY : amount;
  if (cny < 5) return TONE.err;
  if (cny < 20) return TONE.warn;
  return TONE.brand;
}
