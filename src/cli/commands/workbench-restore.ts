import { resolve } from "node:path";
import { restoreWorkbench } from "../../workbench/backup.js";

export async function workbenchRestoreCommand(archive: string, options: { dataDir: string }) {
  const target = resolve(options.dataDir);
  await restoreWorkbench(resolve(archive), target);
  process.stdout.write(
    `工作台数据已校验并恢复：${target}\n使用原账户密码登录；项目源码与模型 API Key 需要单独准备。\n`,
  );
}
