#!/usr/bin/env bash
set -euo pipefail

export HOME="${HOME:-/root}"
export NPM_CONFIG_PREFIX="${NPM_CONFIG_PREFIX:-/usr/local}"
export PNPM_HOME="${PNPM_HOME:-/usr/local}"
export PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:${PATH:-}"

NPM_BIN="${AI_TOOLS_NPM_BIN:-/usr/local/bin/npm}"
APT_GET_BIN="${AI_TOOLS_APT_GET_BIN:-/usr/bin/apt-get}"

AI_TOOLS_NPM_PACKAGES="${AI_TOOLS_NPM_PACKAGES:-npm@latest pnpm@latest corepack@latest fallow@latest ripgrep@latest pm2@latest tsx@latest typescript@latest @openai/codex@latest @anthropic-ai/claude-code@latest @technomoron/agent-run@latest}"
AI_TOOLS_APT_PACKAGES="${AI_TOOLS_APT_PACKAGES:-gh}"

if [ "$(id -u)" -ne 0 ]; then
	echo "update-ai-tools.sh must run as root" >&2
	exit 1
fi

if [ -n "$AI_TOOLS_NPM_PACKAGES" ]; then
	read -r -a npm_packages <<<"$AI_TOOLS_NPM_PACKAGES"
	"$NPM_BIN" install -g --force "${npm_packages[@]}"
fi

CLAUDE_INSTALL="$("$NPM_BIN" root -g)/@anthropic-ai/claude-code/install.cjs"
if [ -f "$CLAUDE_INSTALL" ]; then
	/usr/local/bin/node "$CLAUDE_INSTALL"
fi

if [ -n "$AI_TOOLS_APT_PACKAGES" ] && command -v "$APT_GET_BIN" >/dev/null 2>&1; then
	read -r -a apt_packages <<<"$AI_TOOLS_APT_PACKAGES"
	"$APT_GET_BIN" install --only-upgrade -y "${apt_packages[@]}"
fi
