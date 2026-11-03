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

若改用宿主机目录挂载 `/data`，请确保该目录对 UID/GID `1000:1000` 可写。可以通过 `docker exec -it dsh bash` 进入容器。

需要其他访问地址或反向代理时，可覆盖启动命令；`--trusted-host` 填写浏览器实际使用的主机名或 `host:port`：

```sh
docker run -d --name dsh --init -p 127.0.0.1:3080:3080 -v dsh-data:/data dsh-docker \
  dsh --profile web --no-open --port 3080 \
  --public-url https://dsh.example.com --trusted-host dsh.example.com
```

镜像使用 Node.js 24 和系统 Chromium；Puppeteer 不再额外下载浏览器。

## 自动构建与发布

推送分支或 Git 标签，以及在 GitHub Actions 中手动运行 `Build and publish Docker image`，都会构建 Linux amd64 镜像并推送至 `ghcr.io/<owner>/<repo>`（仓库路径自动转为小写）。工作流通过内置 `GITHUB_TOKEN` 登录，并声明 `packages: write` 权限，无需额外配置发布密钥。

每次运行都从 npm 官方 registry 解析以下包的 `next` 标签，将确切版本传入 Docker 构建，并在 Actions 摘要中记录。版本变化会使相关安装层的缓存失效。

- `@deepseek-ai/dsh`
- `@dsh-plugin/dsh-loader`
- `@dsh-plugin/dsh-auxiliary`
- `@dsh-plugin/dsh-synapse`

镜像标签如下：

| 标签 | 更新时机 |
| --- | --- |
| `next`、`latest` | 默认分支的 push 或手动构建 |
| `branch-<分支名>` | 对应分支构建，特殊字符由工作流规范化 |
| `tag-<Git 标签>` | 对应 Git 标签构建 |
| `sha-<短提交哈希>` | 每次构建，同一提交重新构建时更新 |
| `build-<run_id>-<run_attempt>` | 每次运行及重试的独立镜像 |

本地构建时，这四个版本参数默认均为 `next`；上面的 `--no-cache` 确保重新解析标签。也可通过 `--build-arg DSH_VERSION=...`、`DSH_LOADER_VERSION`、`DSH_AUXILIARY_VERSION`、`DSH_SYNAPSE_VERSION` 指定确切版本。
