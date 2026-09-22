import { describe, expect, it } from "vitest";
import { resolveFlushIntervalMs } from "../src/cli/ui/flush-interval.js";

describe("resolveFlushIntervalMs", () => {
  it("defaults to 50ms", () => {
    expect(resolveFlushIntervalMs({})).toBe(50);
  });

  it("accepts valid SILICONCODE_FLUSH_MS values", () => {
    expect(resolveFlushIntervalMs({ SILICONCODE_FLUSH_MS: "16" })).toBe(16);
    expect(resolveFlushIntervalMs({ SILICONCODE_FLUSH_MS: "33.7" })).toBe(34);
    expect(resolveFlushIntervalMs({ SILICONCODE_FLUSH_MS: "1000" })).toBe(1000);
  });

  it("rejects invalid SILICONCODE_FLUSH_MS values", () => {
    expect(resolveFlushIntervalMs({ SILICONCODE_FLUSH_MS: "15" })).toBe(50);
    expect(resolveFlushIntervalMs({ SILICONCODE_FLUSH_MS: "1001" })).toBe(50);
    expect(resolveFlushIntervalMs({ SILICONCODE_FLUSH_MS: "fast" })).toBe(50);
  });

  it("prefers SILICONCODE_FLUSH_MS over the legacy REASONIX_FLUSH_MS", () => {
    expect(
      resolveFlushIntervalMs({
        SILICONCODE_FLUSH_MS: "80",
        REASONIX_FLUSH_MS: "120",
      }),
    ).toBe(80);
  });

  it("keeps REASONIX_FLUSH_MS as a legacy fallback", () => {
    expect(resolveFlushIntervalMs({ REASONIX_FLUSH_MS: "120" })).toBe(120);
  });
});
