FROM debian:12.10

SHELL ["/bin/bash", "-o", "pipefail", "-c"]

RUN chmod 1777 /tmp

RUN ln -sf /usr/share/zoneinfo/Asia/Shanghai /etc/localtime

RUN echo 'Asia/Shanghai' > /etc/timezone

RUN echo -e "\
Types: deb\n\
URIs: http://mirrors.tuna.tsinghua.edu.cn/debian\n\
Suites: bookworm bookworm-updates bookworm-backports\n\
Components: main contrib non-free non-free-firmware\n\
Signed-By: /usr/share/keyrings/debian-archive-keyring.gpg\n\n\
Types: deb-src\n\
URIs: http://mirrors.tuna.tsinghua.edu.cn/debian\n\
Suites: bookworm bookworm-updates bookworm-backports\n\
Components: main contrib non-free non-free-firmware\n\
Signed-By: /usr/share/keyrings/debian-archive-keyring.gpg\n\n\
Types: deb\n\
URIs: http://mirrors.tuna.tsinghua.edu.cn/debian-security\n\
Suites: bookworm-security\n\
Components: main contrib non-free non-free-firmware\n\
Signed-By: /usr/share/keyrings/debian-archive-keyring.gpg\n\n\
Types: deb-src\n\
URIs: http://mirrors.tuna.tsinghua.edu.cn/debian-security\n\
Suites: bookworm-security\n\
Components: main contrib non-free non-free-firmware\n\
Signed-By: /usr/share/keyrings/debian-archive-keyring.gpg\n\
" > /etc/apt/sources.list.d/debian.sources

RUN apt-get update \
    && DEBIAN_FRONTEND=noninteractive apt-get install -y \
    apt-transport-https \
    ca-certificates \
    locales \
    tzdata \
    fontconfig \
    wget \
    curl \
    openssh-server \
    git git-lfs gh \
    python3 build-essential \
    chromium \
    p7zip-full \
    && wget -q https://github.com/be5invis/Sarasa-Gothic/releases/download/v1.0.37/SarasaFixedSC-TTF-1.0.37.7z \
    && 7z x SarasaFixedSC-TTF-1.0.37.7z -o/usr/share/fonts/truetype/ -y \
    && rm SarasaFixedSC-TTF-1.0.37.7z \
    && wget -q https://github.com/googlefonts/noto-emoji/raw/refs/heads/main/2D/fonts/NotoColorEmoji.ttf \
    && mv NotoColorEmoji.ttf /usr/share/fonts/truetype/ \
    && fc-cache -fv \
    && curl -fsSL https://deb.nodesource.com/setup_24.x -o /tmp/nodesource-setup.sh \
    && bash /tmp/nodesource-setup.sh \
    && apt-get install -y nodejs \
    && rm /tmp/nodesource-setup.sh \
    && rm -rf /var/lib/apt/lists/*

ARG DSH_VERSION=next

RUN npm i -g pnpm@11 "@deepseek-ai/dsh@${DSH_VERSION}"

RUN groupadd -g 1000 user \
    && useradd -u 1000 -g 1000 -m user \
    && mkdir -p /data /opt/dsh-home/profiles/web \
    && chown user:user /data \
    && chown -R user:user /opt/dsh-home

RUN sed -i 's/# en_US.UTF-8 UTF-8/en_US.UTF-8 UTF-8/' /etc/locale.gen

RUN locale-gen

ENV LANG=en_US.UTF-8

ENV LANGUAGE=en_US:en

ENV LC_ALL=en_US.UTF-8

ENV HOME=/home/user

ENV DSH_HOME=/data/.dsh

# Keep the same store when profiles move from the image to a mounted /data.
ENV PNPM_CONFIG_STORE_DIR=/home/user/.local/share/pnpm/store

ENV PNPM_CONFIG_PACKAGE_IMPORT_METHOD=copy

ENV PUPPETEER_SKIP_DOWNLOAD=true

ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

COPY --chmod=755 docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh

COPY --chown=user:user pnpm-workspace.yaml /opt/dsh-home/profiles/web/pnpm-workspace.yaml

USER user

ARG DSH_LOADER_VERSION=next

ARG DSH_AUXILIARY_VERSION=next

ARG DSH_SYNAPSE_VERSION=next

# MCP SDK needs zod/v3 and zod/v4-mini at the profile root.
RUN export DSH_HOME=/opt/dsh-home \
    && dsh --profile web --dump-default-config > /dev/null \
    && dsh plugin --profile web add --save-exact \
    "@dsh-plugin/dsh-loader@${DSH_LOADER_VERSION}" \
    "@dsh-plugin/dsh-auxiliary@${DSH_AUXILIARY_VERSION}" \
    "@dsh-plugin/dsh-synapse@${DSH_SYNAPSE_VERSION}" \
    zod@3.25.76 \
    && cd "$DSH_HOME/profiles/web" \
    && node --input-type=module -e 'await import("zod/v3"); await import("zod/v4-mini"); await import("@modelcontextprotocol/sdk/server/mcp.js");'

WORKDIR /data

EXPOSE 3080

VOLUME ["/data"]

ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]

CMD ["dsh", "--profile", "web", "--no-open", "--port", "3080", "--public-url", "http://localhost:3080"]
