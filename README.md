# dsh-docker

预装 DSH 和 dsh-loader、dsh-auxiliary、dsh-synapse，以 UID/GID `1000:1000` 的 `user` 用户运行 Web 服务。

在此目录构建并启动：

```sh
docker build --pull --no-cache -t dsh-docker .
docker run -d --name dsh --init -p 127.0.0.1:3080:3080 -v dsh-data:/data dsh-docker
docker logs dsh
```

打开日志中带有登录 token 的 `http://localhost:3080` 地址。默认端口为 `3080`；启动脚本自动绑定容器的具体 IPv4 地址，也可用 `DSH_HOST` 指定容器内的具体 IP。

`DSH_HOME=/data/.dsh`，配置、会话及插件随 `dsh-data` 数据卷保存。首次启动会从镜像模板初始化插件，之后保留已有 profile 和配置。构建新镜像不会覆盖旧数据卷中的插件。

pnpm 在构建和运行时均使用 `/home/user/.local/share/pnpm/store`，并以复制方式安装文件，避免 `/data` 位于另一挂载卷时自动切换仓库而出现 `ERR_PNPM_UNEXPECTED_STORE`。这些设置写入 `user` 用户的 pnpm 全局配置，供命令行与 Web 插件管理器持续使用。

启动时还会读取 Web profile 的 pnpm 安装记录，自动将原仓库路径及复制模式保存到该 profile 的配置。已有数据卷会沿用自己的安装路径，保留其他 pnpm 设置以及 DSH 配置、会话。

若旧容器安装或卸载插件时出现 `ERR_PNPM_UNEXPECTED_STORE`，在宿主机执行以下命令（`dsh` 替换为实际容器名）：

```sh
docker exec -i dsh bash <<'SH'
set -euo pipefail
cd "${DSH_HOME:-/data/.dsh}/profiles/web"
store_dir="$(node -p 'require("node:path").dirname(JSON.parse(require("node:fs").readFileSync("node_modules/.modules.yaml", "utf8")).storeDir)')"
pnpm config set --location=project storeDir "$store_dir"
pnpm config set --location=project packageImportMethod copy
pnpm config get storeDir
pnpm config get packageImportMethod
SH
```

此命令读取 pnpm 11 安装记录中的原仓库路径，并将其及复制模式保存到数据卷内的 `pnpm-workspace.yaml`；之后可直接在 Web 页面重试卸载。路径中的 `.local` 或 `local` 以实际安装记录为准，版本子目录 `/v11` 会自动去掉。操作保留插件、配置与会话；给某次安装单独传入 `--store-dir` 不会保存此设置。

镜像在 profile 中固定安装 `zod@3.25.76`，提供 MCP SDK 需要的 `zod/v3` 和 `zod/v4-mini`，并在构建时验证这些路径与 MCP Server 模块可以导入。

若旧数据卷出现包含 `zod/v3` 的 `ERR_PACKAGE_PATH_NOT_EXPORTED`，请更新该卷的依赖并重启（`dsh` 替换为实际容器名）：

```sh
docker exec dsh dsh plugin --profile web add --save-exact zod@3.25.76 \
  --package-import-method=copy
docker restart dsh
```

上述操作保留配置和会话；仅重建镜像不会修改旧数据卷中的依赖。

旧镜像应先按上面的仓库修复步骤保存 pnpm 配置，再更新 Zod。更新镜像时需要拉取新镜像并重建容器，保留原数据卷；仅执行 `docker restart` 不会切换镜像中的 DSH 版本。

若改用宿主机目录挂载 `/data`，请确保该目录对 UID/GID `1000:1000` 可写。可以通过 `docker exec -it dsh bash` 进入容器。

需要其他访问地址或反向代理时，可覆盖启动命令；`--trusted-host` 填写浏览器实际使用的主机名或 `host:port`：

```sh
docker run -d --name dsh --init -p 127.0.0.1:3080:3080 -v dsh-data:/data dsh-docker \
  dsh --profile web --no-open --port 3080 \
  --public-url https://dsh.example.com --trusted-host dsh.example.com
```

`--public-url` 只设置对外显示的地址；公网域名还必须通过 `--trusted-host` 加入信任列表。仅在 Nginx 中设置 `X-Forwarded-Proto` 不能替代它，否则 `/api/*` 和 WebSocket 请求会被 DSH 拒绝。

对于 HTTPS 反向代理，在现有站点的 `location /` 中保留可达的 `proxy_pass` 上游，并配置：

```nginx
proxy_http_version 1.1;
proxy_set_header Host $http_host;
proxy_set_header Origin $http_origin;
proxy_set_header X-Forwarded-Proto https;
proxy_set_header Upgrade $http_upgrade;
proxy_set_header Connection "upgrade";
proxy_cookie_flags ~ secure;
proxy_buffering off;
proxy_read_timeout 3600s;
```

修改容器启动命令后重新部署，保留原来的数据卷挂载；Nginx 配置通过 `nginx -t` 后重新加载。然后打开容器最新日志中带 token 的 HTTPS 域名地址，以该域名重新建立登录会话。

镜像使用 Node.js 24 和系统 Chromium；Puppeteer 不再额外下载浏览器。

## 自动构建与发布

推送分支或 Git 标签，以及在 GitHub Actions 中手动运行 `Build and publish Docker image`，都会构建 Linux amd64 镜像并推送至 `ghcr.io/<owner>/<repo>`（仓库路径自动转为小写）。工作流通过内置 `GITHUB_TOKEN` 登录，并声明 `packages: write` 权限，无需额外配置发布密钥。

发布前会挂载新的 Docker 数据卷，验证 profile 初始化、依赖安装、MCP 模块导入，以及通过 Web 插件管理器使用的 `service` 执行路径卸载插件；同时检查 DSH 实际安装版本与解析结果一致。检查通过后才推送已检查的镜像。安装和卸载检查允许访问 npm，供 pnpm 获取校验锁文件所需的仓库元数据；镜像内已有依赖文件不代表离线元数据缓存齐全。

每次运行都从 npm 官方 registry 解析以下标签，将确切版本传入 Docker 构建，并在 Actions 摘要中记录标签与版本。版本变化会使相关安装层的缓存失效。

| 包 | npm 标签 |
| --- | --- |
| `@deepseek-ai/dsh` | `alpha` |
| `@dsh-plugin/dsh-loader` | `next` |
| `@dsh-plugin/dsh-auxiliary` | `next` |
| `@dsh-plugin/dsh-synapse` | `next` |

npm 标签是发布者指定的版本别名，不按版本号或发布时间自动排序。例如 `next` 可能仍指向 `0.2.1-rc.5`，而 `alpha` 已指向 `0.2.2-alpha.3`。镜像上的 `next`、`latest` 是本仓库的镜像标签，与 npm 包标签独立。

镜像标签如下：

| 标签 | 更新时机 |
| --- | --- |
| `next`、`latest` | 默认分支的 push 或手动构建 |
| `branch-<分支名>` | 对应分支构建，特殊字符由工作流规范化 |
| `tag-<Git 标签>` | 对应 Git 标签构建 |
| `sha-<短提交哈希>` | 每次构建，同一提交重新构建时更新 |
| `build-<run_id>-<run_attempt>` | 每次运行及重试的独立镜像 |

本地构建时，`DSH_VERSION` 默认为 `alpha`，三个插件的版本参数默认为 `next`；上面的 `--no-cache` 确保重新解析标签。也可通过 `--build-arg DSH_VERSION=...`、`DSH_LOADER_VERSION`、`DSH_AUXILIARY_VERSION`、`DSH_SYNAPSE_VERSION` 指定确切版本。
