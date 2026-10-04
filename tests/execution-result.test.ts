import { describe, expect, it } from "vitest";
import {
  type DeliveryResultSource,
  deliveryResult,
  workbenchResult,
} from "../dashboard/src/lib/execution-result.js";
import type { Task } from "../dashboard/src/workbench-components.js";

function task(): Task {
  return {
    id: "task",
    projectId: "project",
    versionId: "version",
    kind: "develop",
    status: "completed",
    phase: "completed",
    updatedAt: "",
    attempt: 2,
    verifiedFingerprint: "verified",
    reviews: [{ attempt: 2, fingerprint: "verified", summary: "reviewed", findings: [] }],
    checks: ["test", "build"].map((kind) => ({
      attempt: 2,
      fingerprint: "verified",
      kind,
      command: `npm run ${kind}`,
      output: "ok",
      exitCode: 0,
      timedOut: false,
    })),
  };
}
describe("shared execution result presentation", () => {
  it("reports local completion only with matching review/test/build evidence and never implies deployment", () => {
    const data = task();
    expect(workbenchResult(data).status).toBe("passed");
    expect(workbenchResult(data).note.zh).toContain("未执行部署");
    data.checks[0]!.fingerprint = "old";
    expect(workbenchResult(data).status).toBe("unverified");
    data.checks[0]!.exitCode = 1;
    data.status = "failed";
    expect(workbenchResult(data).rows[1]!.status).toBe("failed");
    data.checks = [];
    data.reviews = [];
    data.verifiedFingerprint = undefined;
    data.kind = "clarify";
    data.status = "completed";
    const result = workbenchResult(data);
    expect(result.status).toBe("passed");
    expect(result.rows.every((r) => r.status === "pending")).toBe(true);
  });
  it("separates delivery approval from deployment and ignores previous-iteration or unlinked evidence", () => {
    const run: DeliveryResultSource = {
      status: "active",
      iteration: 2,
      stages: {
        production_approval: { status: "passed", evidenceIds: ["approve"] },
        canary_deploy: { status: "pending", evidenceIds: [] },
        validation: { status: "passed", evidenceIds: ["test"] },
      },
      evidence: [
        {
          id: "approve",
          iteration: 2,
          stage: "production_approval",
          kind: "approval",
          outcome: "passed",
        },
        { id: "test", iteration: 1, stage: "validation", kind: "test", outcome: "passed" },
      ],
    };
    const result = deliveryResult(run);
    expect(result.rows.find((r) => r.label.en === "Production approval")?.status).toBe("passed");
    expect(result.rows.find((r) => r.label.en === "Canary deployment")?.status).toBe("pending");
    expect(result.rows[0]!.status).toBe("unverified");
    run.evidence![1]!.iteration = 2;
    run.stages.validation!.evidenceIds = [];
    expect(deliveryResult(run).rows[0]!.status).toBe("unverified");
    run.status = "completed";
    expect(deliveryResult(run).status).toBe("unverified");
    run.status = "rolled_back";
    expect(deliveryResult(run).status).toBe("rolled_back");
  });
});
