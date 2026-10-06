# Silicon Code

Silicon Code 是面向个人开发者的 DeepSeek 编码工作台，以 Codex 的项目、会话、回合与工具审批交互为参照。浏览器工作台支持从模糊需求、多轮澄清、PRD/SDD，到自动开发、独立审查、测试和打包；也保留 `brown code` 终端入口。底层复用 DeepSeek-Reasonix 的 TypeScript Agent 引擎，并保留 MIT 归因。

在项目目录中启动后，它会读取并搜索你的代码、提出修改方案并以 diff 展示、在运行 shell 命令前征求你的确认、按需运行测试验证，并为每次会话留下简洁的记录。

English: [README.en.md](README.en.md)

## 安装

要求 Node.js 22 或更新版本。

```bash
npm install -g @brownsweet/siliconcode
cd path/to/project
brown
```

Windows PowerShell 运行 `npm` 命令时，如果提示 `npm.ps1` 被禁止执行，请改用 `npm.cmd`，例如：

```powershell
npm.cmd install
npm.cmd run dev
npm.cmd run verify
```

短命令：

```bash
brown
```

不全局安装也可以临时运行：

```bash
npx @brownsweet/siliconcode
```

## 浏览器工作台

```bash
brown serve --port 3000
# 在源码目录开发时：npm run build && node dist/cli/index.js serve --port 3000
```

打开 `http://127.0.0.1:3000`，使用终端输出的一次性设置凭据创建个人管理员。
登录后配置模型、添加服务端项目目录，创建 1.0 需求版本并开始对话。
PRD/SDD 中的待澄清问题解决后，确认当前修订，再授权修改文件及列出的测试/打包命令。
开发中的其他命令逐次审批；执行记录包含审查结论、真实退出码和代码 diff。
后续从已确认版本创建 2.0，上一版文档保持不变。

自动开发要求项目是已有提交的 Git 仓库。它直接编辑所选目录，保留已有修改并展示开发前基线，
不会自动提交、推送或部署。账户为个人管理员模式，命令以服务所在系统账户执行。
使用说明、重启恢复、远程 HTTPS 部署和验证边界见 [浏览器工作台说明](docs/WORKBENCH.md)。

## Dockerfile 构建与启动

在源码目录执行（只需 Docker）：

```bash
docker build --build-arg SILICONCODE_BASE_PATH=/siliconcode/ -t siliconcode:local .
docker run -d --name siliconcode --init --restart unless-stopped \
  -p 3100:3100 \
  --mount "type=bind,source=$PWD,target=/workspace/project" \
  -v siliconcode-state:/home/node/.siliconcode \
  -v siliconcode-worktrees:/workspace/.siliconcode-worktrees \
  -v siliconcode-node-modules:/workspace/project/node_modules \
  siliconcode:local
docker logs --tail=30 siliconcode
```

打开日志中的 `http://localhost:3100/siliconcode/?token=...` 完整地址；远程访问将主机换成服务器 IP。
通过外部 Nginx 访问时使用 `https://tec.zhiquant.com/siliconcode/?token=...`，上游为容器的 3100 端口，保留 `/siliconcode/` 前缀。
首次填写 DeepSeek API Key 后进入面板；配置和会话保存在命名数据卷中。
上述命令挂载当前项目，面板修改会同步到宿主机；3100 端口只应允许外部代理访问。

项目目录、容器网络、Nginx 配置、持久化与升级步骤见 [Docker 使用说明](docs/DOCKER.md)。

## 常用命令

| 命令 | 用途 |
| --- | --- |
| `brown` | 在当前项目目录启动编码智能体（等同 `brown code`）。 |
| `brown serve` | 启动不依赖终端 TUI 的浏览器开发工作台。 |
| `brown code [dir]` | 在指定目录 `[dir]` 启动编码智能体；省略 `[dir]` 即为当前目录。 |
| `brown chat` | 不带文件系统和 shell 工具的纯聊天。 |
| `brown run "task"` | 非交互式执行一次任务。 |
| `brown delivery create "需求"` | 创建可恢复的需求到生产交付流程。 |
| `brown delivery run <id> --yolo` | 在隔离工作区自动开发、验证和审计，运行到下一人工门禁。 |
| `brown init [dir]` | 分析项目并生成 `SILICON.md` 项目指南。 |
| `brown doctor` | 本地环境健康检查。 |
| `brown update` | 检查并安装最新 CLI 包。 |

Silicon Code 也安装 `brown`。默认不会安装 `cc`，因为这个名字通常是系统 C 编译器。

### 自动交付循环

Silicon Code 可以通过 CLI 或随 `brown code` 启动的本地 Web Dashboard 自动写代码。完整流程会持久化 PRD/SDD/验收标准，创建独立 Git worktree，执行开发、有限重试、四类独立审计、测试环境部署与验证，并在生产发布前停止等待人工批准；灰度或观察失败会进入回滚。

```bash
brown delivery init-config
# 编辑 .siliconcode/delivery/config.json，替换全部 REPLACE_WITH_* 命令
brown delivery config
brown delivery create "实现……" --title "功能名称"
brown delivery run <run-id> --yolo
```

`--yolo` 只授权无人值守的文件修改和 shell 命令，不会授权生产发布。生产仍须执行 `brown delivery approve-production <run-id> --actor <姓名>` 或在 Dashboard 中由人批准。设计和验收边界见 [自动交付 PRD/SDD](docs/superpowers/specs/2026-09-23-autonomous-delivery.md)。

## 配置

用户配置文件位置：

```text
~/.siliconcode/config.json
```

可以通过首次运行向导配置 DeepSeek API Key，也可以直接导出环境变量：

```bash
export DEEPSEEK_API_KEY=sk-...
```

项目规则建议写在仓库里的 `AGENTS.md` 或 `SILICON.md`。

模型预设使用官方推荐 API ID：`flash` 对应 `deepseek-flash`，
`pro` 对应 `deepseek-v4-pro`，`auto` 默认从 Flash 开始，并在困难回合一次性升级
到 Pro。

2026-10-03 核对官方文档：Flash 推荐名称是 `deepseek-flash`；旧名称仍可调用，
由 V4.1-Flash 提供服务。工作台可直接填写新名称，费用估算按官方高峰价格保守计算，
不代表实际账单；低峰价格更低。来源：[DeepSeek 模型与价格](https://api-docs.deepseek.com/quick_start/pricing/)。

桌面端也支持标准 OpenAI 兼容提供方。在“设置 -> 模型 -> 添加模型提供方”中先填写
Base URL 和 API Key，应用会自动读取 `/models`、推荐模型，并在 Responses API 与
Chat Completions API 之间安全适配。服务端返回的新模型可以直接使用，不会因为未在
本地能力表登记而阻断。完整行为、安全边界和验收方式见
[OpenAI 兼容提供方文档](docs/OPENAI-COMPATIBLE-PROVIDERS.md)。

### 错误诊断

Silicon Code 默认收集并上传经过脱敏的 `error`/`fatal` 错误元数据和堆栈，用于定位发布版本故障。不会上传对话、模型输出、文件内容、完整命令参数、API Key、令牌、Cookie 或环境变量值。网络不可用时，事件会暂存在 `~/.siliconcode/diagnostics/pending/`，队列有数量和大小上限。

可在桌面端“设置 -> 通用 -> 错误诊断”中关闭，也可通过配置或环境变量关闭：

```json
{
  "diagnostics": { "enabled": false }
}
```

```bash
export SILICONCODE_DIAGNOSTICS=off
```

初始化已有项目的规则文件：

```bash
brown init
brown init --dry-run
brown init --force --yes
```

该命令只读取仓库中的 manifest、目录和工具配置，不调用模型。已有规则文件默认
不会被覆盖；可先使用 `--dry-run` 查看差异，再显式传入 `--force`。

## 许可与归因

Silicon Code 使用 MIT 许可证。

第三方 MIT 声明保留在：

- `THIRD_PARTY_NOTICES.md`
- `LICENSES/`

不要移除派生源码中的 copyright 或 MIT notice。
