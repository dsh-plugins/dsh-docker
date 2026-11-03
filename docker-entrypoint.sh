#!/bin/bash
set -euo pipefail

export DSH_HOME="${DSH_HOME:-/data/.dsh}"

if [[ "${1:-}" == dsh ]]; then
    mkdir -p "$DSH_HOME"
    if [[ ! -f "$DSH_HOME/profiles/web/package.json" ]]; then
        cp -a -n /opt/dsh-home/. "$DSH_HOME/"
    fi
fi

if [[ "${1:-}" == dsh && "${2:-}" == --profile && "${3:-}" == web ]]; then
    shift 3
    # DSH 0.2.2 rejects wildcard bind addresses; use the container's concrete IP.
    host="${DSH_HOST:-$(node -e 'const interfaces = Object.values(require("node:os").networkInterfaces()).flat(); process.stdout.write(interfaces.find(address => !address.internal && address.family === "IPv4")?.address ?? "127.0.0.1")')}"
    exec dsh --profile web --host "$host" "$@"
fi

exec "$@"
