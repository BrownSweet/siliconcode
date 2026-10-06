import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

try {
  const token = readFileSync(join(homedir(), ".siliconcode", "dashboard-token"), "utf8").trim();
  const port = process.env.SILICONCODE_DASHBOARD_PORT || "3100";
  const configuredBase = process.env.SILICONCODE_BASE_PATH?.trim() || "/";
  const basePath = configuredBase.endsWith("/") ? configuredBase : `${configuredBase}/`;
  const response = await fetch(`http://127.0.0.1:${port}${basePath}?token=${token}`, {
    signal: AbortSignal.timeout(4000),
  });
  process.exit(response.ok ? 0 : 1);
} catch {
  process.exit(1);
}
