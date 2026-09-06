#!/usr/bin/env bash
set -euo pipefail

export HOME=/root
export NPM_CONFIG_PREFIX=/usr/local
export PNPM_HOME=/usr/local
export PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin

NPM_BIN=/usr/local/bin/npm
NODE_BIN=/usr/local/bin/node
PNPM_BIN=/usr/local/bin/pnpm
APT_GET_BIN=/usr/bin/apt-get

AI_TOOLS_APT_PACKAGES="${AI_TOOLS_APT_PACKAGES:-gh}"

packages=(
	npm@latest corepack@latest fallow@latest ripgrep@latest
	pm2@latest tsx@latest typescript@latest @openai/codex@latest
	@anthropic-ai/claude-code@latest @google/gemini-cli@latest
	@xai-official/grok@latest @technomoron/agent-run@latest
)

if [ "$(id -u)" -ne 0 ]; then
	echo "update-ai-tools.sh must run as root" >&2
	exit 1
fi

if [ "$("$NPM_BIN" prefix -g)" != /usr/local ] || [ "$("$NPM_BIN" root -g)" != /usr/local/lib/node_modules ]; then
	echo "npm global tooling must use /usr/local" >&2
	exit 1
fi

"$NPM_BIN" install -g --force "${packages[@]}"

# corepack and pnpm both own the pnpm/pnpx shims; install pnpm last so npm's
# current pnpm package remains the command users execute.
"$NPM_BIN" install -g --force pnpm@latest

install -d -o root -g root -m 0755 /usr/local/share/pnpm/global /usr/local/share/pnpm/store /usr/local/bin
"$PNPM_BIN" config set --global global-dir /usr/local/share/pnpm/global
"$PNPM_BIN" config set --global global-bin-dir /usr/local/bin
"$PNPM_BIN" config set --global store-dir /usr/local/share/pnpm/store

CLAUDE_INSTALL="$("$NPM_BIN" root -g)/@anthropic-ai/claude-code/install.cjs"
if [ -f "$CLAUDE_INSTALL" ]; then
	"$NODE_BIN" "$CLAUDE_INSTALL"
fi

if [ -n "$AI_TOOLS_APT_PACKAGES" ] && command -v "$APT_GET_BIN" >/dev/null 2>&1; then
	read -r -a apt_packages <<<"$AI_TOOLS_APT_PACKAGES"
	"$APT_GET_BIN" install --only-upgrade -y "${apt_packages[@]}"
fi
