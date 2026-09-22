import { describe, expect, it } from "vitest";
import { detectTerminal } from "../src/cli/terminal-info.js";

describe("detectTerminal", () => {
  it("identifies iTerm2 with truecolor", () => {
    const info = detectTerminal(
      { TERM_PROGRAM: "iTerm.app", TERM: "xterm-256color", COLORTERM: "truecolor" },
      true,
      "darwin",
    );
    expect(info.program).toBe("iTerm2");
    expect(info.adviceKey).toBe("iterm");
    expect(info.trueColor).toBe(true);
    expect(info.isTTY).toBe(true);
  });

  it("identifies VS Code, Windows Terminal, and falls back to generic", () => {
    expect(detectTerminal({ TERM_PROGRAM: "vscode" }, true, "linux").adviceKey).toBe("vscode");
    expect(detectTerminal({ WT_SESSION: "x" }, true, "win32").adviceKey).toBe("windowsTerminal");
    expect(detectTerminal({ TERM: "screen" }, false, "linux").adviceKey).toBe("generic");
  });

  it("reports no truecolor when COLORTERM is absent", () => {
    expect(detectTerminal({ TERM: "xterm" }, true, "linux").trueColor).toBe(false);
  });
});
