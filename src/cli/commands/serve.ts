import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { defaultConfigPath } from "../../config.js";
import { startWorkbenchServer } from "../../workbench/server.js";

export async function serveCommand(options: {
  host?: string;
  port?: string;
  dataDir?: string;
  origin?: string;
  configPath?: string;
}): Promise<void> {
  const port = Number(options.port ?? "3000");
  if (!Number.isInteger(port) || port < 0 || port > 65535)
    throw new Error("port 必须是 0–65535 的整数");
  const dataDir = resolve(options.dataDir ?? join(homedir(), ".siliconcode", "workbench"));
  const server = await startWorkbenchServer({
    host: options.host,
    port,
    dataDir,
    origin: options.origin,
    configPath: options.configPath ? resolve(options.configPath) : defaultConfigPath(),
  });
  process.stdout.write(`Silicon Code 浏览器工作台：${server.url}\n数据目录：${dataDir}\n`);
  if (server.auth.needsSetup)
    process.stdout.write(`首次设置凭据（仅用于创建管理员）：${server.auth.setupToken}\n`);
  process.stdout.write("使用浏览器登录、选择服务端项目目录后开始。Ctrl+C 停止服务。\n");
  await new Promise<void>((done) => {
    const stop = () => {
      process.off("SIGINT", stop);
      process.off("SIGTERM", stop);
      void server.close().then(done, (err) => {
        process.stderr.write(`${(err as Error).message}\n`);
        process.exitCode = 1;
        done();
      });
    };
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
  });
}
