import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { handleDelivery } from "../src/server/api/delivery.js";
import type { DashboardContext } from "../src/server/context.js";

const roots: string[] = [];

function context(root: string): DashboardContext {
  return {
    mode: "attached",
    configPath: join(root, "config.json"),
    usageLogPath: join(root, "usage.jsonl"),
    getCurrentCwd: () => root,
  };
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("dashboard delivery API", () => {
  it("creates, lists, and reads a durable run", async () => {
    const root = mkdtempSync(join(tmpdir(), "silicon-dashboard-delivery-"));
    roots.push(root);
    const ctx = context(root);
    const created = await handleDelivery(
      "POST",
      [],
      JSON.stringify({
        id: "web-run",
        title: "Web workflow",
        requirement: "Build from the dashboard",
      }),
      ctx,
    );
    expect(created.status).toBe(201);
    expect((created.body as { run: { currentStage: string } }).run.currentStage).toBe("intake");

    const list = await handleDelivery("GET", [], "", ctx);
    expect((list.body as { runs: unknown[] }).runs).toHaveLength(1);
    const detail = await handleDelivery("GET", ["web-run"], "", ctx);
    expect((detail.body as { run: { requirement: string } }).run.requirement).toBe(
      "Build from the dashboard",
    );
  });

  it("refuses delivery actions without an attached code workspace", async () => {
    const ctx: DashboardContext = {
      mode: "standalone",
      configPath: "/tmp/config.json",
      usageLogPath: "/tmp/usage.jsonl",
    };
    const result = await handleDelivery("GET", [], "", ctx);
    expect(result).toMatchObject({ status: 503 });
  });

  it("does not accept a model-shaped empty production approval", async () => {
    const root = mkdtempSync(join(tmpdir(), "silicon-dashboard-delivery-"));
    roots.push(root);
    const ctx = context(root);
    await handleDelivery(
      "POST",
      [],
      JSON.stringify({ id: "approval-run", title: "Approval", requirement: "Ship safely" }),
      ctx,
    );
    const result = await handleDelivery(
      "POST",
      ["approval-run", "approve-production"],
      JSON.stringify({ actor: "" }),
      ctx,
    );
    expect(result).toMatchObject({ status: 400 });
  });

  it("requires explicit Web authorization before starting unattended edits and commands", async () => {
    const root = mkdtempSync(join(tmpdir(), "silicon-dashboard-delivery-"));
    roots.push(root);
    const ctx = context(root);
    await handleDelivery(
      "POST",
      [],
      JSON.stringify({ id: "runner-run", title: "Runner", requirement: "Automate safely" }),
      ctx,
    );
    const result = await handleDelivery(
      "POST",
      ["runner-run", "run"],
      JSON.stringify({ confirmUnattended: false }),
      ctx,
    );
    expect(result).toMatchObject({ status: 400 });
    expect((result.body as { error: string }).error).toMatch(/explicit unattended/);
  });
});
