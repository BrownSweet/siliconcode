import { Box, Text } from "ink";
import { render } from "ink-testing-library";
import React from "react";
import stripAnsi from "strip-ansi";
import { describe, expect, it } from "vitest";
import { ConversationViewport } from "../src/cli/ui/layout/ConversationViewport.js";
import { makeFakeStdin, makeFakeStdout } from "./helpers/ink-stdio.js";

function renderConversation(): string {
  const stdout = makeFakeStdout();
  stdout.rows = 12;
  const { lastFrame, unmount } = render(
    <ConversationViewport
      history={
        <Box flexDirection="column">
          <Text>assistant latest</Text>
        </Box>
      }
      controls={<Text>› input task</Text>}
      bottomReserveRows={3}
    />,
    { stdout: stdout as never, stdin: makeFakeStdin() as never },
  );
  const out = lastFrame() ?? "";
  unmount();
  return stripAnsi(out);
}

describe("ConversationViewport", () => {
  it("places the composer directly after the current conversation when history is short", () => {
    const lines = renderConversation().split("\n");
    const messageLine = lines.findIndex((line) => line.includes("assistant latest"));
    const inputLine = lines.findIndex((line) => line.includes("› input task"));

    expect(messageLine).toBeGreaterThanOrEqual(0);
    expect(inputLine).toBe(messageLine + 1);
    expect(inputLine).toBeLessThan(10);
  });
});
