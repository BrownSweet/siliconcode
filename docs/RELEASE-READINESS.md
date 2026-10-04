# 本地交付与发布准备

核对日期：2026-10-03。此记录对应个人本机 alpha 准备，公开 npm 发布、推送和生产部署未执行。

## 模型配置

- 新配置和 `flash` / `auto` 预设使用官方推荐的 `deepseek-flash`，Pro 使用 `deepseek-v4-pro`。
- 明确保存的 `deepseek-v4-flash` 仍保留为可调用别名，不重写用户的模型配置。
- 官方说明 Flash 由 V4.1-Flash 提供服务；本地能力表沿用 1M 上下文、384K 最大输出。
- 估算采用官方高峰美元价：Flash 输入缓存命中 0.006、未命中 0.3、输出 1.2 / 百万 Token；
  Pro 分别为 0.044、1.32、3.96。低峰账单可能更低，估算不作为结算凭证。

依据：[模型与价格](https://api-docs.deepseek.com/quick_start/pricing/)、
[官方 API 调用与别名说明](https://api-docs.deepseek.com/quick_start/pricing-details-cny/)。
本轮没有发起付费推理请求；配置发现测试使用虚构提供方。

## 可重现的本地验证

使用 Node.js 22+：

```bash
npm ci
npm run verify
npm run verify:package -- .tools/release-check
```

`verify` 构建 CLI/浏览器资源，检查后端与前端 lint、类型并运行全部测试。
本机最终结果：382 个测试文件通过，4,174 项通过、3 项跳过（Node v24.19.0，macOS）。
`verify:package` 使用已验证构建生成 tarball，在独立临时目录真实安装它，
检查 `brown` 版本、serve / workbench-restore 入口、启动随机端口服务、首页与静态资源、
未登录 API 拒绝访问、进程退出和随包的 MIT/第三方声明。
它使用单独 npm 缓存和临时账户数据，不读写真实账户，不调用模型，安装完成后清理临时进程与目录。
输出目录保留 `.tgz` 和含 SHA-256 的 `verification.json`。

当前本机产物放在 `.tools/release-20261003/`，该目录不会进入 Git 或 npm 包。
CI 已增加 macOS，Linux / Windows / macOS 均运行完整验证及独立安装验证；
未配置 Git remote，本次没有产生远程 CI 运行结果。

前端交互测试使用 Happy DOM 挂载实际工作台，HTTP/SSE 为内存夹具，覆盖跨项目派生草稿、
刷新恢复、后台任务完成后的可操作状态、任务重命名/搜索/归档/恢复及预览授权与停止。
真实服务端测试另外使用临时 HTTP 服务、Git 仓库和子进程验证其实际执行路径。
本轮浏览器人工检查受工具授权拒绝限制，未作为验收证据；这些自动化测试不证明像素布局或真实浏览器兼容性。

## Git 检查点

`codex/workbench-pre-reliability` 保存实施前已有的未提交成果，来自开始修改前的文件快照。
基线提交为 `23489ea60b197e5f5cb7930d7ed67105ea828980`。
实施结果整理在 `codex/workbench-reliability-delivery`，与基线比较可查看本次完整修改。
检查点使用独立索引生成，保留当前分支、工作目录与用户暂存状态。

```bash
git diff codex/workbench-pre-reliability..codex/workbench-reliability-delivery
git log --oneline codex/workbench-reliability-delivery
```

需要恢复时先保存当时的工作目录，再在单独 worktree 中检出目标检查点。
不要把 reset/clean 作为默认恢复步骤；已有用户数据、依赖和忽略文件不属于 Git 快照。

## 公开发布条件

2026-10-03 公开 registry 查询 `@brownsweet/siliconcode` 返回 404；这只说明当前查询未找到可访问的公开包。
仓库没有配置 Git remote，npm Trusted Publishing 的账户侧绑定尚未核实。
现有 `.github/workflows/publish.yml` 使用 Node 24、`id-token: write`、`npm` environment 和 provenance；
tag 必须匹配包版本，并执行验证。正式发布前还需要仓库所有者完成：

1. 明确公开发布或继续内部 alpha；为 `BrownSweet/siliconcode` 配置正确的远程仓库。
2. 在 npm 为 `@brownsweet/siliconcode` 配置 Trusted Publisher，精确匹配组织/用户、仓库、workflow 文件及 environment。
3. 确认 GitHub `npm` environment 的访问/审批设置，并核对新版本在三平台 CI 的实际结果。
4. 再次核对当时的官方模型与价格、包内容、许可证和版本号，然后再创建发布 tag。

本地安装成功不等于 OIDC 已获授权或 npm 已发布；不会为绕过 Trusted Publishing 写入长期令牌。
