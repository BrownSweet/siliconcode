import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  deliveryConfigPath,
  initializeDeliveryConfig,
  loadDeliveryConfig,
  parseDeliveryConfig,
} from "../src/delivery/config.js";

describe("delivery automation config", () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "siliconcode-delivery-config-"));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("creates a visible template but refuses to treat placeholders as executable config", () => {
    const path = initializeDeliveryConfig(root);
    expect(path).toBe(deliveryConfigPath(root));
    expect(readFileSync(path, "utf8")).toContain("REPLACE_WITH_STAGING_DEPLOY_COMMAND");
    expect(() => loadDeliveryConfig(root)).toThrow(/template placeholder/);
    expect(() => initializeDeliveryConfig(root)).toThrow(/already exists/);
  });

  it("loads a complete command contract", () => {
    const path = initializeDeliveryConfig(root);
    writeFileSync(
      path,
      JSON.stringify({
        version: 1,
        validationCommands: ["npm test"],
        staging: {
          deployCommand: "deploy staging",
          healthCheckCommands: ["check staging"],
          regressionCommands: ["test staging"],
        },
        production: {
          canaryDeployCommand: "deploy production --percent {percent}",
          canaryPercent: 15,
          observationCommands: ["observe production"],
          observationWindowSeconds: 60,
          rollbackCommand: "rollback production",
          postRollbackHealthCheckCommands: ["check production"],
        },
      }),
    );
    expect(loadDeliveryConfig(root)?.production.canaryPercent).toBe(15);
  });

  it("requires a bounded canary and an explicit percentage placeholder", () => {
    const base = {
      version: 1,
      validationCommands: ["npm test"],
      staging: {
        deployCommand: "deploy staging",
        healthCheckCommands: ["check staging"],
        regressionCommands: ["test staging"],
      },
      production: {
        canaryDeployCommand: "deploy production",
        canaryPercent: 100,
        observationCommands: ["observe production"],
        observationWindowSeconds: 60,
        rollbackCommand: "rollback production",
        postRollbackHealthCheckCommands: ["check production"],
      },
    };
    expect(() => parseDeliveryConfig(base)).toThrow(/between 1 and 99/);
    expect(() =>
      parseDeliveryConfig({
        ...base,
        production: { ...base.production, canaryPercent: 10 },
      }),
    ).toThrow(/\{percent\}/);
  });
});
