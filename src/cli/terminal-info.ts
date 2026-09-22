export type TerminalAdvice =
  | "iterm"
  | "vscode"
  | "appleTerminal"
  | "wezterm"
  | "windowsTerminal"
  | "generic";

export interface TerminalInfo {
  /** Friendly terminal name. */
  program: string;
  term: string;
  trueColor: boolean;
  isTTY: boolean;
  platform: string;
  adviceKey: TerminalAdvice;
}

// Best-effort terminal detection from env — report-only, never mutates terminal config.
export function detectTerminal(
  env: NodeJS.ProcessEnv,
  isTTY: boolean,
  platform: string,
): TerminalInfo {
  const tp = env.TERM_PROGRAM ?? "";
  const term = env.TERM ?? "";
  const colorTerm = (env.COLORTERM ?? "").toLowerCase();
  const trueColor = colorTerm.includes("truecolor") || colorTerm.includes("24bit");

  let program = tp || term || "unknown";
  let adviceKey: TerminalAdvice = "generic";
  if (tp === "iTerm.app") {
    program = "iTerm2";
    adviceKey = "iterm";
  } else if (tp === "vscode") {
    program = "VS Code";
    adviceKey = "vscode";
  } else if (tp === "Apple_Terminal") {
    program = "Terminal.app";
    adviceKey = "appleTerminal";
  } else if (tp === "WezTerm") {
    program = "WezTerm";
    adviceKey = "wezterm";
  } else if (env.WT_SESSION) {
    program = "Windows Terminal";
    adviceKey = "windowsTerminal";
  }
  return { program, term, trueColor, isTTY, platform, adviceKey };
}
