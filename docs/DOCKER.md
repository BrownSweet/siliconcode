# Docker 开发工作台

Docker 默认运行 `brown serve`，与本机新版浏览器工作台使用同一套账号登录、项目、需求版本、PRD/SDD、审批和执行结果界面，不再启动 `brown code` 附属聊天面板。
容器内的 Node HTTP 服务同时提供页面、API 和 SSE，外部 Nginx 提供 HTTPS。

## 1. 构建镜像

进入服务器上的 Silicon Code 源码目录执行：

```bash
docker build --build-arg SILICONCODE_BASE_PATH=/siliconcode/ -t siliconcode:local .
```

默认前缀为 `/siliconcode/`，前端、API、Cookie 和健康检查均使用该前缀。
根路径部署可将构建参数改成 `/`，再重建镜像和容器。普通 `npm run build` 默认仍是 `/`。

## 2. 启动容器

下面将当前目录挂载为可供工作台打开的项目目录。将 `SILICONCODE_WORKBENCH_ORIGIN` 换成实际外部 HTTPS 地址，**只填写协议、域名和可选端口，不含 `/siliconcode/` 路径**。

```bash
docker run -d \
  --name siliconcode \
  --init \
  --restart unless-stopped \
  -p 3100:3100 \
  -e SILICONCODE_WORKBENCH_ORIGIN=https://tec.zhiquant.com \
  --mount "type=bind,source=$PWD,target=/workspace/project" \
  -v siliconcode-state:/home/node/.siliconcode \
  -v siliconcode-worktrees:/workspace/.siliconcode-worktrees \
  -v siliconcode-node-modules:/workspace/project/node_modules \
  siliconcode:local

docker logs --tail=30 siliconcode
```

打开 `https://tec.zhiquant.com/siliconcode/`，无需 `?token=...`。
首次启动日志会输出「首次设置凭据（仅用于创建管理员）」；在页面输入凭据、用户名和至少 12 字符的密码。
创建管理员后登录，在模型设置中填写 API Key，使用「打开项目文件夹」选择 `/workspace/project`，然后新建任务。
即使没有 API Key，首次设置和登录页面也能正常打开；只有执行模型任务时才需要可用的模型配置。

设置凭据只用于首次创建管理员，创建成功后失效。尚未创建管理员时，每次进程启动都会生成新凭据，请以当前日志为准。
账号密码使用加盐哈希保存；模型配置权限为 0600。登录会话在重启后失效，账号、项目、需求版本和模型配置保留。
已有 `~/.siliconcode/config.json` 中的模型设置继续沿用，也可通过 `-e DEEPSEEK_API_KEY` 传入环境变量；环境变量可能优先于页面保存的 Key，详见工作台模型设置中的来源提示。
旧 `SILICONCODE_DASHBOARD_TOKEN` 不再用于工作台认证，旧访问令牌不能替代用户名和密码。

要操作其他项目，将 `source=$PWD` 换成服务器上的真实绝对路径；目录必须已存在。
工作台操作会同步到该宿主机目录。Linux 宿主机需确保容器 `node` 用户（UID 1000）有读写权限，镜像不会递归修改宿主机目录权限。
端口 `3100` 的防火墙来源应限制为代理机器；代理位于同一宿主机时可绑定 `127.0.0.1:3100:3100`。
此端口为 HTTPS 代理的内部上游，不是浏览器直连入口；工作台会检查 Host，认证 Cookie 只通过 HTTPS 发送。

`docker run` 不自动读取 `.env`；文件传参需显式加 `--env-file /实际路径/siliconcode.env`。
使用 Compose 时，在 `.env` 设置 `SILICONCODE_WORKBENCH_ORIGIN=https://tec.zhiquant.com`，再执行 `docker compose up -d --build`。
Compose 默认将端口绑定到 `127.0.0.1`；外部代理机器连接时，按需设置 `SILICONCODE_BIND_ADDRESS` 并限制防火墙来源。
已有 `SILICONCODE_DASHBOARD_HOST` / `SILICONCODE_DASHBOARD_PORT` 环境变量仍兼容，用于容器内监听地址/端口，默认 `0.0.0.0:3100`。

## 3. 外部 Nginx 配置

在已有 HTTPS `server` 中使用以下路由，沿用证书配置：

```nginx
location = /siliconcode {
    return 308 /siliconcode/$is_args$args;
}

location ^~ /siliconcode/ {
    proxy_pass http://43.155.214.55:3100;
    proxy_http_version 1.1;
    proxy_set_header Host $http_host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_read_timeout 600s;
    proxy_send_timeout 600s;
    proxy_buffering off;
}
```

`proxy_pass` 末尾不要加 `/`，以保留完整 `/siliconcode/` 前缀。
必须保留 Host（包括非默认端口），与 `SILICONCODE_WORKBENCH_ORIGIN` 一致；Origin 校验和 Cookie 认证使用外部 HTTPS 地址。
完整三项目样例见 [`docker/host-nginx.conf.example`](../docker/host-nginx.conf.example)。

如果 Nginx 与工作台在同一个 Docker 网络，将启动命令中的 `-p` 替换为 `--network 已存在的代理网络名`，上游使用 `http://siliconcode:3100`。
代理容器中的 `127.0.0.1` 指向代理自身，不能用来访问工作台容器。
修改 Nginx 后先执行 `nginx -t`，通过后再 reload。

## 4. 旧面板升级与持久化

| 数据 | 容器路径 | 保存位置 |
| --- | --- | --- |
| 项目代码 | `/workspace/project` | 宿主机绑定目录 |
| 模型配置、保留的旧面板数据 | `/home/node/.siliconcode` | `siliconcode-state` |
| 新工作台账号、项目、需求版本与执行记录 | `/home/node/.siliconcode/workbench` | 同一 `siliconcode-state` |
| 独立 Git worktree | `/workspace/.siliconcode-worktrees` | `siliconcode-worktrees` |
| 主项目 Linux Node 依赖 | `/workspace/project/node_modules` | `siliconcode-node-modules` |

旧版升级必须重建镜像、重建容器，并添加 `SILICONCODE_WORKBENCH_ORIGIN`。只执行 `git pull` 或 `docker restart` 不会更新容器入口。
先查看旧容器挂载，确认实际项目路径和卷名：

```bash
docker inspect siliconcode --format '{{json .Mounts}}'
# 保存旧镜像，便于回退
docker image tag "$(docker inspect siliconcode --format '{{.Image}}')" siliconcode:before-workbench
# 获取更新代码后构建
docker build --build-arg SILICONCODE_BASE_PATH=/siliconcode/ -t siliconcode:local .
# 构建成功后停止并删除旧容器，保留数据卷
docker stop siliconcode
docker rm siliconcode
# 再执行第 2 节的 docker run，复用原项目路径和三个实际数据卷名称。
```

Compose 创建的卷通常带项目前缀，不能直接替换为新卷名，否则会表现为全新实例。不要删除数据卷，也不要执行 `docker compose down -v`。
新工作台使用独立数据格式；旧面板会话、URL 令牌和 delivery 记录保留原位，不会自动转换为新工作台账号或任务。
首次切换需要创建管理员并添加项目；之后重建容器仍可登录原账号并恢复新工作台记录。
回退时停止新容器，用 `siliconcode:before-workbench` 和升级前的启动参数、原卷名重新创建；新工作台数据保留，旧面板不会读取它。

## 5. 验收与管理

```bash
docker ps --filter name=siliconcode
docker inspect --format '{{.State.Health.Status}}' siliconcode
docker logs --tail=30 siliconcode
docker exec siliconcode node /opt/siliconcode/docker/healthcheck.mjs
```

健康检查访问新工作台的 `/siliconcode/api/auth/status`，校验返回的 `needsSetup`，不依赖旧面板令牌。
`healthy` 表示新工作台认证接口可用，未创建管理员时也可健康；不代表模型 Key 或自动开发已验证。
页面应加载 `/siliconcode/assets/workbench.js`，显示管理员设置或登录界面；登录后能打开项目和创建需求版本，不应再出现旧 `attached` 面板。
功能与验证边界见 [浏览器工作台说明](WORKBENCH.md)。

镜像包含 Node.js 22、npm、Git、SSH 客户端、curl、ripgrep、Python 3 和 C/C++ 基础构建工具。
目标项目和隔离工作区的依赖需要按需安装；镜像不包含 Docker CLI、宿主机 Docker socket、浏览器测试运行时或生产凭据。

## 6. 验证镜像

在开发环境构建镜像后，使用 Node.js 22+ 执行：

```bash
node docker/smoke-test.mjs
```

测试启动隔离临时容器，验证新工作台入口与资源、子路径、无 Key 启动、管理员设置/登录、Host/Origin/CSRF、健康检查、项目/需求版本/模型配置持久化、重启、容器重建和正常退出。
测试使用临时账号与假 Key，不调用模型，不操作真实项目，结束后清理临时容器和测试卷。
