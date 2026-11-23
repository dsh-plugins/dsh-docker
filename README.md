# dsh-docker

预装 DSH，不预装任何插件。Web 服务以 UID/GID `1000:1000` 的 `user` 用户运行。

在此目录构建并启动：

```sh
docker build --pull --no-cache -t dsh-docker .
docker run -d --name dsh --init -p 127.0.0.1:3080:3080 -v dsh-data:/data dsh-docker
docker logs dsh
```

打开日志中带有登录 token 的 `http://localhost:3080` 地址。默认端口为 `3080`；启动脚本自动绑定容器的具体 IPv4 地址，也可用 `DSH_HOST` 指定容器内的具体 IP。

`DSH_HOME=/data/.dsh`，配置、会话及插件随 `dsh-data` 数据卷保存。新数据卷只会初始化 Web profile 的 pnpm 配置，不会安装任何插件。更新镜像不会覆盖或删除旧数据卷中的插件、会话和配置。

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

默认分支的 GitHub Actions 每小时第 17 分钟检查一次（UTC）。从 npm 官方仓库读取 `@deepseek-ai/dsh` 的 `alpha`、`next` 和 `latest`，按 [SemVer](https://semver.org/lang/zh-CN/) 选最高版本。版本和 Dockerfile 当前值相同或更低时，不构建也不发布；任一标签无效或无法读取时，检查失败且不会写入 Dockerfile。

有新版本时，工作流用该确切版本构建 Linux amd64 镜像，验证安装版本和新数据卷没有预装插件，才推送至 `ghcr.io/<owner>/<repo>`。发布成功后，`github-actions[bot]` 提交 `[skip ci]`，只改 Dockerfile 中的 `DSH_VERSION`。如果发布失败，不改版本号，下一次检查会重试。

| 镜像标签 | 示例与含义 |
| --- | --- |
| DSH 精确版本 | `0.2.3-alpha.2`。若版本含构建元数据，Docker 标签用 `_` 代替 `+`；镜像标签元数据仍记录原版本。 |
| `latest`、`next` | 指向同一最新成功发布的镜像；不是 npm 的同名标签。 |

```sh
docker pull ghcr.io/dsh-plugins/dsh-docker:0.2.3-alpha.2
```

可在 Actions 手动执行检查；仅在首次发布或确需重建当前版本时勾选 `bootstrap`。普通推送不会发布镜像。本地构建默认使用 Dockerfile 固定的版本；也可通过 `--build-arg DSH_VERSION=...` 指定其他确切版本。
