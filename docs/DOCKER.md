# Docker 启动与浏览器使用

## 1. 启动

安装并启动 Docker（包含 Compose），在本仓库目录执行：

```bash
docker compose up -d --build
docker compose logs --tail=30 siliconcode
```

在**宿主机浏览器**打开日志给出的完整地址：

```text
http://localhost:3100/?token=日志中的访问令牌
```

首次启动显示中文配置页。填写 DeepSeek API Key，点击“保存并打开面板”，等待完整面板启动。
Key 存放在 `siliconcode-state` 数据卷内的 `config.json`（文件权限 0600），不会写进镜像。
令牌也会持久化；不要将完整链接公开分享。配置页仅保存 Key，不验证服务商余额或 Key 有效性，真实调用时才会返回服务商错误。

也可以在启动前设置 `DEEPSEEK_API_KEY` 环境变量，跳过配置页；使用环境变量时，能访问 Docker 的用户可以从容器配置中读取它。

## 2. 在面板中使用

- **聊天/编码**：输入需求，例如“先分析这个项目，列出实现登录功能的方案，暂时不要改代码”。随后授权修改，并在面板中处理命令审批、查看结果。
- **自动交付（Delivery）**：切换到自动交付页（若未展示，打开高级面板列表），新建需求，勾选无人值守文件修改和命令执行授权，然后运行到下一门禁。按页面提示创建独立工作区、处理审批。
- **部署配置**：实际测试/构建/部署/回滚命令必须按项目配置；镜像不会猜测你的生产服务器，也不会自动获得生产权限。

首次使用交付循环，在终端执行：

```bash
docker compose exec siliconcode brown delivery init-config
```

编辑宿主机项目中的 `.siliconcode/delivery/config.json`，将所有 `REPLACE_WITH_*` 占位命令替换为真实命令，然后检查：

```bash
docker compose exec siliconcode brown delivery config
```

交付循环有重试和轮次限制，不是无限自改循环；生产发布必须由人批准。容器重启保留交付状态，但不会自动重新执行中断的任务，应查看状态后恢复。

镜像包含 Node.js 22、npm、Git、SSH 客户端、curl、ripgrep、Python 3 和 C/C++ 基础构建工具。
**目标项目依赖不是 Silicon Code 镜像依赖**，需要自行安装。例如 Node 项目：

```bash
docker compose exec siliconcode npm ci --include=dev
```

容器没有 Docker CLI/宿主机 Docker socket，也没有浏览器测试运行时或生产凭据；需要这些能力时应显式扩展镜像/配置，不要假设部署命令必定可用。不要随意挂载 Docker socket，它会大幅扩大容器权限。

## 3. 项目与持久化

默认挂载当前仓库：

| 数据 | 容器路径 | 保存位置 |
| --- | --- | --- |
| 目标项目 | `/workspace/project` | 宿主机绑定目录，修改实时同步 |
| API Key、用户配置、会话、面板令牌 | `/home/node/.siliconcode` | `siliconcode-state` 数据卷 |
| 交付独立 Git worktree | `/workspace/.siliconcode-worktrees` | `siliconcode-worktrees` 数据卷 |
| 主项目 Linux Node 依赖 | `/workspace/project/node_modules` | `siliconcode-node-modules` 数据卷，避免混用宿主机依赖 |

数据卷名称会带 Compose 项目前缀。交付状态与项目级配置保存在目标项目的 `.siliconcode/delivery` 下。独立 worktree 需要自己的依赖安装步骤，不能假设复用主项目的 `node_modules`。

要操作另一个项目，请在 Silicon Code 源码目录执行（替换为真实绝对路径；目标目录须存在）：

```bash
SILICONCODE_PROJECT_DIR=/absolute/path/to/your-project \
SILICONCODE_HTTP_PORT=3101 \
docker compose -p my-project up -d --build
docker compose -p my-project logs --tail=30 siliconcode
```

此时使用 `http://localhost:3101/?token=...`。后续该实例的命令也要保持同样的环境变量和 `-p my-project`，可在本地 `.env` 保存这些值。每个不同项目建议使用独立 Compose 项目名隔离状态和依赖卷。

交付 worktree 需要真实 Git 仓库和有效的 `HEAD`。容器内生成的 worktree 路径属于容器，不应直接从宿主机执行其中的 Git 操作。
镜像以 `node` 用户（UID 1000）运行。Linux 宿主机须确保目标项目允许 UID 1000 读写；本方案不会自动递归修改你的项目权限。自动提交前也需在目标仓库设置 Git 作者身份。

## 4. 远程服务器访问

默认只绑定宿主机 `127.0.0.1:3100`。远程服务器推荐通过 SSH 隧道访问：

```bash
ssh -L 3100:127.0.0.1:3100 user@server
```

随后在本地浏览器使用日志里的 `http://localhost:3100/?token=...`。

如需局域网直接访问，在服务器启动时指定：

```bash
SILICONCODE_BIND_ADDRESS=0.0.0.0 docker compose up -d
```

浏览器使用 `http://服务器IP:3100/?token=...`，并限制防火墙来源。不要把当前 HTTP 面板直接暴露在公网；公网使用应增加 HTTPS 反向代理与额外访问控制。持有令牌的人可以操作挂载的项目。

## 5. 常用管理命令

```bash
# 状态（healthy 同样可能表示首次配置页已就绪）
docker compose ps

# 日志 / 找回访问链接
docker compose logs --tail=30 siliconcode

# 重启
docker compose restart siliconcode

# 停止并移除容器，保留命名数据卷
docker compose down

# 源码更新后重建并启动；容器内自动更新已禁用
docker compose up -d --build

# 容器内命令行
docker compose exec siliconcode brown --help
```

不要使用 `docker compose down -v`，除非确定要删除配置、会话、独立 worktree 和依赖卷。Key 或挂载项目的权限错误可以先查看日志排查。

可选环境变量：`SILICONCODE_HTTP_PORT`（默认 3100）、`SILICONCODE_BIND_ADDRESS`（默认 127.0.0.1）、`SILICONCODE_PROJECT_DIR`（默认当前仓库）、`DEEPSEEK_API_KEY`、`SILICONCODE_DASHBOARD_TOKEN`（16–128 位英文字母或数字；默认随机生成并持久化）。
