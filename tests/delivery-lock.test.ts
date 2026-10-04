import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { acquireDeliveryRunLock } from "../src/delivery/lock.js";

describe("delivery runner lock", () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "siliconcode-delivery-lock-"));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("blocks a second live runner and releases idempotently", () => {
    const first = acquireDeliveryRunLock(root, "run-one");
    expect(() => acquireDeliveryRunLock(root, "run-one")).toThrow(/already controlled/);
    first.release();
    first.release();
    const second = acquireDeliveryRunLock(root, "run-one");
    second.release();
  });

  it("recovers a lock owned by a dead process", () => {
    const lock = acquireDeliveryRunLock(root, "run-two");
    const path = lock.path;
    lock.release();
    writeFileSync(
      path,
      JSON.stringify({ token: "stale", pid: 2_147_483_647, createdAt: "2000-01-01T00:00:00Z" }),
    );
    expect(dirname(path)).toContain("run-two");
    const recovered = acquireDeliveryRunLock(root, "run-two");
    expect(readFileSync(recovered.path, "utf8")).not.toContain("stale");
    recovered.release();
  });
});
