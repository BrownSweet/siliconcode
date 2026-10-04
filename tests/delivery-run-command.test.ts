import { describe, expect, it } from "vitest";
import {
  requireUnattendedDeliveryAuthorization,
  restrictPreWorkspaceTools,
} from "../src/delivery/authorization.js";

describe("delivery run command", () => {
  it("requires explicit unattended-execution authorization", () => {
    expect(() => requireUnattendedDeliveryAuthorization(undefined)).toThrow(
      /requires explicit --yolo/,
    );
    expect(() => requireUnattendedDeliveryAuthorization(true)).not.toThrow();
  });

  it("removes file, shell, memory, and scaffold mutations before a worktree exists", () => {
    const removed: string[] = [];
    restrictPreWorkspaceTools({ unregister: (name) => removed.push(name) });
    expect(removed).toEqual(
      expect.arrayContaining(["edit_file", "apply_patch", "run_command", "install_skill"]),
    );
    expect(removed).not.toContain("delivery_record_documents");
    expect(removed).not.toContain("read_file");
  });
});
