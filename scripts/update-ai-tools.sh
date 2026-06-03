#!/usr/bin/env bash
set -euo pipefail

export HOME="${HOME:-/root}"
export NPM_CONFIG_PREFIX="${NPM_CONFIG_PREFIX:-/usr}"
export PNPM_HOME="${PNPM_HOME:-/usr/local/bin}"
export PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:${PATH:-}"

NPM_BIN="${AI_TOOLS_NPM_BIN:-/usr/bin/npm}"
APT_GET_BIN="${AI_TOOLS_APT_GET_BIN:-/usr/bin/apt-get}"

AI_TOOLS_NPM_PACKAGES="${AI_TOOLS_NPM_PACKAGES:-npm pnpm netlify-cli@latest @openai/codex@latest @anthropic-ai/claude-code@latest @technomoron/agent-run@latest @technomoron/repo-check@latest}"
AI_TOOLS_APT_PACKAGES="${AI_TOOLS_APT_PACKAGES:-gh}"

if [ -n "$AI_TOOLS_NPM_PACKAGES" ]; then
	# shellcheck disable=SC2086
	"$NPM_BIN" install -g --force $AI_TOOLS_NPM_PACKAGES
fi

if [ -n "$AI_TOOLS_APT_PACKAGES" ] && command -v "$APT_GET_BIN" >/dev/null 2>&1; then
	# shellcheck disable=SC2086
	"$APT_GET_BIN" install --only-upgrade -y $AI_TOOLS_APT_PACKAGES
fi
