import { describe, expect, it } from "vitest";
import { codeSystemPrompt } from "../src/code/prompt.js";
import { outputStyleFragment } from "../src/prompt-fragments.js";

describe("output style", () => {
  it("default = empty; explanatory/learning append a styled section", () => {
    expect(outputStyleFragment("default")).toBe("");
    expect(outputStyleFragment("explanatory")).toContain("# Output style: explanatory");
    expect(outputStyleFragment("learning")).toContain("TODO(human)");
  });

  it("codeSystemPrompt injects the fragment only for non-default styles", () => {
    const root = "/tmp/cc-output-style-noexist";
    expect(codeSystemPrompt(root, { outputStyle: "default" })).not.toContain("# Output style:");
    expect(codeSystemPrompt(root)).not.toContain("# Output style:");
    expect(codeSystemPrompt(root, { outputStyle: "explanatory" })).toContain(
      "# Output style: explanatory",
    );
    expect(codeSystemPrompt(root, { outputStyle: "learning" })).toContain(
      "# Output style: learning",
    );
  });
});
