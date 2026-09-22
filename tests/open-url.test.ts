import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openUrl, resolveNoOpenEnv } from "../src/cli/ui/open-url.js";

describe("openUrl", () => {
  const originalCi = process.env.CI;
  const originalSiliconNoOpen = process.env.SILICONCODE_NO_OPEN;
  const originalReasonixNoOpen = process.env.REASONIX_NO_OPEN;

  beforeEach(() => {
    Reflect.deleteProperty(process.env, "CI");
    Reflect.deleteProperty(process.env, "SILICONCODE_NO_OPEN");
    Reflect.deleteProperty(process.env, "REASONIX_NO_OPEN");
  });

  afterEach(() => {
    if (originalCi === undefined) Reflect.deleteProperty(process.env, "CI");
    else process.env.CI = originalCi;

    if (originalSiliconNoOpen === undefined)
      Reflect.deleteProperty(process.env, "SILICONCODE_NO_OPEN");
    else process.env.SILICONCODE_NO_OPEN = originalSiliconNoOpen;

    if (originalReasonixNoOpen === undefined)
      Reflect.deleteProperty(process.env, "REASONIX_NO_OPEN");
    else process.env.REASONIX_NO_OPEN = originalReasonixNoOpen;
  });

  it("skips opening URLs under CI", () => {
    process.env.CI = "1";
    Reflect.deleteProperty(process.env, "SILICONCODE_NO_OPEN");
    Reflect.deleteProperty(process.env, "REASONIX_NO_OPEN");

    expect(openUrl("https://example.com")).toEqual({ opened: false, reason: "ci" });
  });

  it("prefers SILICONCODE_NO_OPEN over the legacy REASONIX_NO_OPEN", () => {
    process.env.SILICONCODE_NO_OPEN = "0";
    process.env.REASONIX_NO_OPEN = "1";

    expect(resolveNoOpenEnv()).toBe("0");
    expect(openUrl("https://example.com")).toEqual({ opened: false, reason: "disabled" });
  });

  it("keeps REASONIX_NO_OPEN as a legacy fallback", () => {
    Reflect.deleteProperty(process.env, "SILICONCODE_NO_OPEN");
    process.env.REASONIX_NO_OPEN = "1";

    expect(resolveNoOpenEnv()).toBe("1");
    expect(openUrl("https://example.com")).toEqual({ opened: false, reason: "disabled" });
  });
});
