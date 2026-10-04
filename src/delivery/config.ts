import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

export interface DeliveryAutomationConfig {
  version: 1;
  validationCommands: string[];
  staging: {
    deployCommand: string;
    healthCheckCommands: string[];
    regressionCommands: string[];
  };
  production: {
    canaryDeployCommand: string;
    canaryPercent: number;
    observationCommands: string[];
    observationWindowSeconds: number;
    rollbackCommand: string;
    postRollbackHealthCheckCommands: string[];
  };
}

export function deliveryConfigPath(workspaceRoot: string): string {
  return resolve(workspaceRoot, ".siliconcode", "delivery", "config.json");
}

export function deliveryConfigTemplate(): DeliveryAutomationConfig {
  return {
    version: 1,
    validationCommands: ["npm run lint", "npm run typecheck", "npm test", "npm run build"],
    staging: {
      deployCommand: "REPLACE_WITH_STAGING_DEPLOY_COMMAND",
      healthCheckCommands: ["REPLACE_WITH_STAGING_HEALTH_CHECK_COMMAND"],
      regressionCommands: ["REPLACE_WITH_STAGING_REGRESSION_COMMAND"],
    },
    production: {
      canaryDeployCommand: "REPLACE_WITH_CANARY_DEPLOY_COMMAND --percent {percent}",
      canaryPercent: 10,
      observationCommands: ["REPLACE_WITH_PRODUCTION_OBSERVATION_COMMAND"],
      observationWindowSeconds: 300,
      rollbackCommand: "REPLACE_WITH_PRODUCTION_ROLLBACK_COMMAND",
      postRollbackHealthCheckCommands: ["REPLACE_WITH_POST_ROLLBACK_HEALTH_CHECK_COMMAND"],
    },
  };
}

function command(value: unknown, path: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${path} must be a non-empty command string`);
  }
  const result = value.trim();
  if (result.includes("REPLACE_WITH_")) {
    throw new Error(`${path} is still a template placeholder`);
  }
  return result;
}

function commands(value: unknown, path: string): string[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`${path} must contain at least one command`);
  }
  return value.map((entry, index) => command(entry, `${path}[${index}]`));
}

export function parseDeliveryConfig(value: unknown): DeliveryAutomationConfig {
  if (!value || typeof value !== "object") throw new Error("delivery config must be an object");
  const root = value as Record<string, unknown>;
  if (root.version !== 1) throw new Error("delivery config version must be 1");
  const staging = root.staging;
  const production = root.production;
  if (!staging || typeof staging !== "object") throw new Error("staging config is required");
  if (!production || typeof production !== "object") {
    throw new Error("production config is required");
  }
  const stagingRecord = staging as Record<string, unknown>;
  const productionRecord = production as Record<string, unknown>;
  const canaryPercent = productionRecord.canaryPercent;
  if (
    !Number.isInteger(canaryPercent) ||
    (canaryPercent as number) < 1 ||
    (canaryPercent as number) > 99
  ) {
    throw new Error("production.canaryPercent must be an integer between 1 and 99");
  }
  const observationWindowSeconds = productionRecord.observationWindowSeconds;
  if (
    !Number.isInteger(observationWindowSeconds) ||
    (observationWindowSeconds as number) < 1 ||
    (observationWindowSeconds as number) > 86_400
  ) {
    throw new Error("production.observationWindowSeconds must be an integer between 1 and 86400");
  }
  const canaryDeployCommand = command(
    productionRecord.canaryDeployCommand,
    "production.canaryDeployCommand",
  );
  if (!canaryDeployCommand.includes("{percent}")) {
    throw new Error("production.canaryDeployCommand must contain the {percent} placeholder");
  }
  return {
    version: 1,
    validationCommands: commands(root.validationCommands, "validationCommands"),
    staging: {
      deployCommand: command(stagingRecord.deployCommand, "staging.deployCommand"),
      healthCheckCommands: commands(
        stagingRecord.healthCheckCommands,
        "staging.healthCheckCommands",
      ),
      regressionCommands: commands(stagingRecord.regressionCommands, "staging.regressionCommands"),
    },
    production: {
      canaryDeployCommand,
      canaryPercent: canaryPercent as number,
      observationCommands: commands(
        productionRecord.observationCommands,
        "production.observationCommands",
      ),
      observationWindowSeconds: observationWindowSeconds as number,
      rollbackCommand: command(productionRecord.rollbackCommand, "production.rollbackCommand"),
      postRollbackHealthCheckCommands: commands(
        productionRecord.postRollbackHealthCheckCommands,
        "production.postRollbackHealthCheckCommands",
      ),
    },
  };
}

export function loadDeliveryConfig(workspaceRoot: string): DeliveryAutomationConfig | null {
  const path = deliveryConfigPath(workspaceRoot);
  if (!existsSync(path)) return null;
  let value: unknown;
  try {
    value = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new Error(
      `invalid delivery config JSON at ${path}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  try {
    return parseDeliveryConfig(value);
  } catch (error) {
    throw new Error(
      `invalid delivery config at ${path}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

export function initializeDeliveryConfig(workspaceRoot: string, force = false): string {
  const path = deliveryConfigPath(workspaceRoot);
  if (existsSync(path) && !force) {
    throw new Error(`delivery config already exists: ${path}; use --force to replace it`);
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(deliveryConfigTemplate(), null, 2)}\n`, "utf8");
  return path;
}
