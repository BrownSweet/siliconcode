# Dockerfile 构建与启动

使用一个 Dockerfile 构建包含前端与后端的镜像，再通过 `docker run` 启动单个容器。
宿主机只需安装 Docker，无需安装 Node.js 或 Compose。容器内的 Node HTTP 服务同时提供页面、API 和 SSE。

## 1. 构建镜像

进入服务器上的 Silicon Code 源码目录执行：

```bash
docker build \
  --build-arg SILICONCODE_BASE_PATH=/siliconcode/ \
  -t siliconcode:local .
```

Dockerfile 默认前缀也是 `/siliconcode/`。前端构建、首次配置页、静态资源、API、SSE 和健康检查均使用该前缀。
根路径部署可将构建参数改成 `/`，然后重建镜像和容器。普通 `npm run build` 默认仍是 `/`。

## 2. 启动单个容器

继续在源码目录执行，以下命令将**当前目录作为智能体操作的项目**：

```bash
docker run -d \
  --name siliconcode \
  --init \
  --restart unless-stopped \
  -p 3100:3100 \
  --mount "type=bind,source=$PWD,target=/workspace/project" \
  -v siliconcode-state:/home/node/.siliconcode \
  -v siliconcode-worktrees:/workspace/.siliconcode-worktrees \
  -v siliconcode-node-modules:/workspace/project/node_modules \
  siliconcode:local

docker logs --tail=30 siliconcode
```

要让智能体操作其他项目，把 `source=$PWD` 换成该项目在服务器上的真实绝对路径；目录必须已存在。
面板中的文件修改会同步到这个宿主机目录。Linux 宿主机需要确保容器 `node` 用户（UID 1000）对目标目录有读写权限；镜像不会递归修改宿主机项目权限。

这里的 `-p 3100:3100` 对应外部 Nginx 通过 `43.155.214.55:3100` 访问的部署方式，将该端口的防火墙来源限制为代理机器。
仅本机访问时改为 `-p 127.0.0.1:3100:3100`。同一 Docker 网络内访问的方式见下一节。

日志会给出带令牌的地址，例如：

```text
http://localhost:3100/siliconcode/?token=日志中的访问令牌
```

直接访问服务器时将 `localhost` 换成服务器 IP；通过域名访问则使用：

```text
https://tec.zhiquant.com/siliconcode/?token=日志中的访问令牌
```

首次启动填写 DeepSeek API Key 后进入完整面板。Key 和访问令牌保存在 `siliconcode-state` 数据卷中，配置文件权限为 0600，不会写进镜像。
配置页只保存 Key，不验证服务商余额或 Key 有效性。持有令牌的人可以操作挂载项目，不要公开完整访问链接。

也可以在 `docker run` 的镜像名之前加入 `-e DEEPSEEK_API_KEY`，将当前终端的同名环境变量传入容器以跳过配置页；能访问 Docker 的用户可以读取容器环境变量。
需要固定面板令牌时，可加入 `-e SILICONCODE_DASHBOARD_TOKEN`，值须为 16–128 位英文字母或数字；默认自动生成并持久化。
`docker run` 不会自动读取当前目录的 `.env`；如需从文件传参，显式使用 `--env-file /实际路径/siliconcode.env`。

## 3. 外部 Nginx 配置

在现有 HTTPS `server` 中加入，并沿用已有代理头、600 秒超时和 `proxy_buffering off`：

```nginx
location = /siliconcode {
    return 308 /siliconcode/$is_args$args;
}

location ^~ /siliconcode/ {
    proxy_pass http://43.155.214.55:3100;
}
```

**`proxy_pass` 末尾不要加 `/`**，容器需要收到完整 `/siliconcode/` 前缀。
完整三项目样例见 [`docker/host-nginx.conf.example`](../docker/host-nginx.conf.example)。
样例的 `/lawer/` 沿用原 `/a/` 的 8088 上游端口，须确认 Lawer 已自行支持 `/lawer/`。
本次不修改 Jiami 或 Lawer 项目，也不替换服务器上的 Nginx 配置。

用样例替换原同域名配置后，在外部 Nginx 容器中运行（将 `你的nginx容器名` 换成实际名称）：

```bash
docker exec 你的nginx容器名 nginx -t
# 仅在检查通过后执行
docker exec 你的nginx容器名 nginx -s reload
```

外部 Nginx 和 Silicon Code 位于同一 Docker 宿主机时，也可以沿用 Jiami 的容器网络方式：
将上面的 `-p 3100:3100` 替换为 `--network 已存在的代理网络名`，并确保 Nginx 容器已加入该网络。
Nginx 上游改为 `proxy_pass http://siliconcode:3100;`，无需发布宿主机端口。
代理容器内的 `127.0.0.1` 指向代理自身，不能用来访问 Silicon Code 容器。

## 4. 持久化与升级

| 数据 | 容器路径 | 保存位置 |
| --- | --- | --- |
| 目标项目、项目级配置和交付状态 | `/workspace/project` | `--mount` 指定的宿主机目录 |
| API Key、用户配置、会话、面板令牌 | `/home/node/.siliconcode` | `siliconcode-state` 命名数据卷 |
| 交付独立 Git worktree | `/workspace/.siliconcode-worktrees` | `siliconcode-worktrees` 命名数据卷 |
| 主项目 Linux Node 依赖 | `/workspace/project/node_modules` | `siliconcode-node-modules` 命名数据卷 |

命名数据卷首次运行时由 Docker 创建。更新源码后，在源码目录重新构建，成功后再替换旧容器：

```bash
docker build --build-arg SILICONCODE_BASE_PATH=/siliconcode/ -t siliconcode:local .
# 构建成功后执行
docker stop siliconcode
docker rm siliconcode
# 再执行第 2 节的 docker run，复用原项目路径和三个数据卷名称。
```

删除容器不会删除这些命名数据卷；不要删除数据卷。`docker restart` 不会更新镜像、挂载或端口映射。
更换项目或同时运行多个实例时，使用不同的容器名、宿主机端口、项目目录和三组数据卷，避免混用状态。
如果此前已使用 Compose 部署，先用 `docker inspect 旧容器名 --format '{{json .Mounts}}'` 查出实际卷名（通常带项目前缀），在 `docker run` 中复用这些卷名；直接使用新的卷名会表现为全新实例。

## 5. 管理和使用

```bash
# 状态与健康检查（healthy 也可能表示首次配置页已就绪）
docker ps --filter name=siliconcode
docker inspect --format '{{.State.Health.Status}}' siliconcode

# 日志 / 找回访问链接
docker logs --tail=30 siliconcode

# 重启 / 停止 / 启动已有容器
docker restart siliconcode
docker stop siliconcode
docker start siliconcode

# 容器内命令行
docker exec -it siliconcode brown --help

# 目标 Node 项目需要依赖时，自行安装
docker exec -it siliconcode npm ci --include=dev

# 初始化并检查自动交付配置
docker exec -it siliconcode brown delivery init-config
docker exec -it siliconcode brown delivery config
```

容器默认运行已有的附属 Dashboard（`brown code`），首次配置后可在页面聊天、编码和处理审批。
独立 `brown serve` 工作台也支持子路径，但未替换本镜像的默认入口。
交付 worktree 需要真实 Git 仓库和有效的 `HEAD`；自动提交前需配置 Git 作者身份。
将项目 `.siliconcode/delivery/config.json` 中的 `REPLACE_WITH_*` 替换为真实验证和部署命令。
交付循环有重试及轮次限制，生产发布需人批准；重启后不会自动重新执行中断任务。

镜像包含 Node.js 22、npm、Git、SSH 客户端、curl、ripgrep、Python 3 和 C/C++ 基础构建工具。
目标项目依赖需要单独安装；独立 worktree 也需要自己的依赖。
镜像不包含 Docker CLI、宿主机 Docker socket、浏览器测试运行时或生产凭据。

## 6. 验证镜像

开发环境安装 Node.js 22 或更高版本时，构建后执行：

```bash
node docker/smoke-test.mjs
```

测试通过 `docker run` 启动隔离临时容器，验证子路径、配置页、鉴权、静态资源、SSE、健康检查、重启及复用挂载重建容器后的数据持久化。
测试使用假 Key，不调用模型，不操作真实项目，结束后清理临时容器和测试卷。
