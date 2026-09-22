import { render } from "ink";
import React from "react";
import { afterEach, describe, expect, it } from "vitest";
import { ThemePicker } from "../src/cli/ui/ThemePicker.js";
import { listThemeNames } from "../src/cli/ui/theme/tokens.js";
import { setLanguageRuntime } from "../src/i18n/index.js";
import { makeFakeStdin, makeFakeStdout } from "./helpers/ink-stdio.js";

function renderPicker(props: {
  currentPreference: "auto" | ReturnType<typeof listThemeNames>[number];
  activeTheme: ReturnType<typeof listThemeNames>[number];
}): string {
  const stdout = makeFakeStdout();
  const { unmount } = render(
    React.createElement(ThemePicker, {
      currentPreference: props.currentPreference,
      activeTheme: props.activeTheme,
      onChoose: () => {},
    }),
    { stdout: stdout as never, stdin: makeFakeStdin() as never },
  );
  unmount();
  return stdout.text();
}

describe("ThemePicker", () => {
  afterEach(() => {
    setLanguageRuntime("EN");
  });

  it("lists auto and all registered themes", () => {
    const text = renderPicker({ currentPreference: "auto", activeTheme: "github-dark" });
    expect(text).toContain("auto");
    for (const name of listThemeNames()) {
      expect(text).toContain(name);
    }
  });

  it("marks the current preference and active theme", () => {
    const text = renderPicker({ currentPreference: "auto", activeTheme: "github-dark" });
    expect(text).toMatch(/auto[\s\S]*current preference/);
    expect(text).toMatch(/github-dark[\s\S]*active now/);
  });

  it("renders the keybind hint footer", () => {
    const text = renderPicker({ currentPreference: "tokyo-night", activeTheme: "tokyo-night" });
    expect(text).toContain("↑↓");
    expect(text).toContain("⏎");
    expect(text).toContain("esc");
  });

  it("renders Simplified Chinese labels when zh-CN is active", () => {
    setLanguageRuntime("zh-CN");
    const text = renderPicker({ currentPreference: "auto", activeTheme: "github-dark" });
    expect(text).toContain("选择主题");
    expect(text).toContain("auto - 自动");
    expect(text).toContain("github-dark - GitHub 深色");
    expect(text).toMatch(/auto[\s\S]*当前偏好/);
    expect(text).toMatch(/github-dark[\s\S]*当前生效/);
    expect(text).toContain("↑↓ 选择");
  });
});
