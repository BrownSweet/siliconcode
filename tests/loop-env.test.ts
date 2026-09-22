import { describe, expect, it } from "vitest";
import {
  parsePositiveIntEnv,
  resolveParallelMaxEnv,
  resolveStormThresholdEnv,
  resolveStormWindowEnv,
  resolveToolDispatchSerial,
} from "../src/loop/env.js";

describe("loop env helpers", () => {
  it("parses positive integer env values only", () => {
    expect(parsePositiveIntEnv(undefined)).toBeUndefined();
    expect(parsePositiveIntEnv("")).toBeUndefined();
    expect(parsePositiveIntEnv("0")).toBeUndefined();
    expect(parsePositiveIntEnv("-1")).toBeUndefined();
    expect(parsePositiveIntEnv("3")).toBe(3);
  });

  it("prefers Silicon storm env vars over legacy Reasonix values", () => {
    const env = {
      SILICONCODE_STORM_THRESHOLD: "4",
      REASONIX_STORM_THRESHOLD: "2",
      SILICONCODE_STORM_WINDOW: "8",
      REASONIX_STORM_WINDOW: "6",
    };

    expect(resolveStormThresholdEnv(env)).toBe(4);
    expect(resolveStormWindowEnv(env)).toBe(8);
  });

  it("keeps legacy storm env vars as fallbacks", () => {
    const env = {
      REASONIX_STORM_THRESHOLD: "2",
      REASONIX_STORM_WINDOW: "6",
    };

    expect(resolveStormThresholdEnv(env)).toBe(2);
    expect(resolveStormWindowEnv(env)).toBe(6);
  });

  it("prefers SILICONCODE_TOOL_DISPATCH over the legacy dispatch env", () => {
    expect(
      resolveToolDispatchSerial({
        SILICONCODE_TOOL_DISPATCH: "auto",
        REASONIX_TOOL_DISPATCH: "serial",
      }),
    ).toBe(false);
  });

  it("keeps REASONIX_TOOL_DISPATCH as a legacy fallback", () => {
    expect(resolveToolDispatchSerial({ REASONIX_TOOL_DISPATCH: "serial" })).toBe(true);
  });

  it("prefers and clamps SILICONCODE_PARALLEL_MAX before legacy fallback", () => {
    expect(
      resolveParallelMaxEnv({
        SILICONCODE_PARALLEL_MAX: "20",
        REASONIX_PARALLEL_MAX: "2",
      }),
    ).toBe(16);
  });

  it("keeps REASONIX_PARALLEL_MAX as a legacy fallback", () => {
    expect(resolveParallelMaxEnv({ REASONIX_PARALLEL_MAX: "2" })).toBe(2);
    expect(resolveParallelMaxEnv({ REASONIX_PARALLEL_MAX: "bad" })).toBe(3);
  });
});
