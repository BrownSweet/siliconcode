import { request } from "node:http";

try {
  const port = process.env.SILICONCODE_DASHBOARD_PORT || "3100";
  const configuredBase = process.env.SILICONCODE_BASE_PATH?.trim() || "/";
  const basePath = configuredBase.endsWith("/") ? configuredBase : `${configuredBase}/`;
  const origin = process.env.SILICONCODE_WORKBENCH_ORIGIN?.trim();
  const host = process.env.SILICONCODE_DASHBOARD_HOST || "0.0.0.0";
  const probeHost = ["localhost", "127.0.0.1", "::1"].includes(host) ? host : "127.0.0.1";
  // Native fetch ignores a custom Host on supported Node versions. Use HTTP directly
  // so the loopback probe passes the same public Host check as the HTTPS proxy.
  const headers = origin ? { Host: new URL(origin).host } : {};
  const req = request(`http://${probeHost.includes(":") ? `[${probeHost}]` : probeHost}:${port}${basePath}api/auth/status`, { headers }, (res) => {
    let body = "";
    res.setEncoding("utf8");
    res.on("data", (chunk) => { body += chunk; });
    res.on("error", () => process.exit(1));
    res.on("end", () => {
      try {
        const status = JSON.parse(body);
        process.exit(res.statusCode === 200 && typeof status?.needsSetup === "boolean" ? 0 : 1);
      } catch { process.exit(1); }
    });
  });
  req.on("error", () => process.exit(1));
  setTimeout(() => { req.destroy(); process.exit(1); }, 4000).unref();
  req.end();
} catch {
  process.exit(1);
}
