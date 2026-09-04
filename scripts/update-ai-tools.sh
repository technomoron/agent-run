#!/usr/bin/env bash
set -euo pipefail

export HOME="${HOME:-/root}"
export NPM_CONFIG_PREFIX="${NPM_CONFIG_PREFIX:-/usr/local}"
export PNPM_HOME="${PNPM_HOME:-/usr/local}"
export PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:${PATH:-}"

NPM_BIN="${AI_TOOLS_NPM_BIN:-/usr/bin/npm}"
NODE_BIN="${AI_TOOLS_NODE_BIN:-/usr/bin/node}"
APT_GET_BIN="${AI_TOOLS_APT_GET_BIN:-/usr/bin/apt-get}"

AI_TOOLS_NPM_PACKAGES="${AI_TOOLS_NPM_PACKAGES:-npm@latest pnpm@latest corepack@latest fallow@latest ripgrep@latest pm2@latest tsx@latest typescript@latest @openai/codex@latest @anthropic-ai/claude-code@latest @technomoron/agent-run@latest}"
AI_TOOLS_PNPM_PACKAGE="${AI_TOOLS_PNPM_PACKAGE:-pnpm@latest}"
AI_TOOLS_APT_PACKAGES="${AI_TOOLS_APT_PACKAGES:-gh}"
AI_TOOLS_CLEAN_BINS="${AI_TOOLS_CLEAN_BINS:-agent-run claude codex}"
AI_TOOLS_SYSTEM_BIN_DIRS="${AI_TOOLS_SYSTEM_BIN_DIRS:-/usr/local/bin /usr/bin}"

if [ "$(id -u)" -ne 0 ]; then
	echo "update-ai-tools.sh must run as root" >&2
	exit 1
fi

clean_tool_bins() {
	local bin_dir="$1"
	local bin_name
	local -a bin_names

	[ -d "$bin_dir" ] || return 0
	read -r -a bin_names <<<"$AI_TOOLS_CLEAN_BINS"
	for bin_name in "${bin_names[@]}"; do
		case "$bin_name" in
			agent-run|claude|codex)
				rm -f -- "$bin_dir/$bin_name"
				;;
			*)
				echo "Refusing to clean unexpected AI tool bin: $bin_name" >&2
				exit 1
				;;
		esac
	done
}

target_bin_dir="${NPM_CONFIG_PREFIX%/}/bin"
clean_tool_bins "$target_bin_dir"

if [ -n "$AI_TOOLS_NPM_PACKAGES" ]; then
	read -r -a npm_packages <<<"$AI_TOOLS_NPM_PACKAGES"
	"$NPM_BIN" install -g --force "${npm_packages[@]}"
fi

# corepack and pnpm both own the pnpm/pnpx shims; install pnpm last so npm's
# current pnpm package remains the command users execute.
if [ -n "$AI_TOOLS_PNPM_PACKAGE" ]; then
	read -r -a pnpm_packages <<<"$AI_TOOLS_PNPM_PACKAGE"
	"$NPM_BIN" install -g --force "${pnpm_packages[@]}"
fi

# Once the new launchers are installed, remove exact-name duplicates from the
# other conventional system prefix so PATH ordering cannot select a stale copy.
read -r -a system_bin_dirs <<<"$AI_TOOLS_SYSTEM_BIN_DIRS"
for system_bin_dir in "${system_bin_dirs[@]}"; do
	if [ "${system_bin_dir%/}" != "${target_bin_dir%/}" ]; then
		clean_tool_bins "$system_bin_dir"
	fi
done

CLAUDE_INSTALL="$("$NPM_BIN" root -g)/@anthropic-ai/claude-code/install.cjs"
if [ -f "$CLAUDE_INSTALL" ]; then
	"$NODE_BIN" "$CLAUDE_INSTALL"
fi

if [ -n "$AI_TOOLS_APT_PACKAGES" ] && command -v "$APT_GET_BIN" >/dev/null 2>&1; then
	read -r -a apt_packages <<<"$AI_TOOLS_APT_PACKAGES"
	"$APT_GET_BIN" install --only-upgrade -y "${apt_packages[@]}"
fi
