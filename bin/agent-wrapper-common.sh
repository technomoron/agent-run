#!/bin/sh

set -eu

SCRIPT_PATH=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)/$(basename -- "$0")

debug_log() {
	if [ "${AGENT_WRAPPER_DEBUG:-0}" = "1" ]; then
		printf 'agent-wrapper: %s\n' "$*" >&2
	fi
}

is_root_user() {
	[ "$(id -u)" -eq 0 ]
}

is_force_permissive() {
	[ "${AGENT_WRAPPER_FORCE_PERMISSIVE:-0}" = "1" ]
}

find_real_binary() {
	tool="$1"
	self_path="$2"

	if command -v which >/dev/null 2>&1; then
		candidates=$(which -a "$tool" 2>/dev/null || true)
		old_ifs=$IFS
		IFS='
'
		for candidate in $candidates; do
			[ -n "$candidate" ] || continue
			if [ ! -x "$candidate" ]; then
				debug_log "skip $tool candidate (not executable): $candidate"
				continue
			fi
			if [ -d "$candidate" ]; then
				debug_log "skip $tool candidate (is directory): $candidate"
				continue
			fi
			candidate_dir=$(CDPATH= cd -- "$(dirname -- "$candidate")" 2>/dev/null && pwd) || continue
			candidate_path="$candidate_dir/$(basename -- "$candidate")"
			if [ "$candidate_path" != "$self_path" ]; then
				debug_log "use $tool candidate from PATH: $candidate_path"
				IFS=$old_ifs
				printf '%s\n' "$candidate_path"
				return 0
			fi
			debug_log "skip $tool candidate (self): $candidate_path"
		done
		IFS=$old_ifs
	fi

	for candidate in "/usr/local/bin/$tool" "/opt/homebrew/bin/$tool" "/usr/bin/$tool"; do
		if [ -x "$candidate" ] && [ "$candidate" != "$self_path" ]; then
			debug_log "use $tool fallback candidate: $candidate"
			printf '%s\n' "$candidate"
			return 0
		fi
		debug_log "skip $tool fallback candidate: $candidate"
	done

	debug_log "no $tool binary found"
	return 1
}

find_project_root() {
	dir="$PWD"

	while [ "$dir" != "/" ]; do
		if [ -f "$dir/package.json" ] || [ -d "$dir/.git" ]; then
			debug_log "project root: $dir"
			printf '%s\n' "$dir"
			return 0
		fi
		dir=$(dirname -- "$dir")
	done

	debug_log "project root fallback: $PWD"
	printf '%s\n' "$PWD"
}

resolve_profile() {
	root="$1"

	if [ -f "$root/package.json" ] && command -v node >/dev/null 2>&1; then
		pkg_name=$(
			cd "$root" &&
			node -p "const pkg=require('./package.json'); typeof pkg.name === 'string' ? pkg.name : ''" 2>/dev/null
		)
		if [ -n "$pkg_name" ]; then
			if [ "${pkg_name#@}" != "$pkg_name" ]; then
				debug_log "profile from scoped package name: ${pkg_name#@}"
				printf '%s\n' "${pkg_name#@}"
				return 0
			fi
			debug_log "profile from unscoped package name: ."
			printf '.\n'
			return 0
		fi
	fi

	debug_log "profile from directory name: $(basename -- "$root")"
	printf '%s\n' "$(basename -- "$root")"
}

resolve_config_path() {
	filename="$1"
	project_root=$(find_project_root)
	profile=$(resolve_profile "$project_root")
	config_root="${AGENT_CONFIG_ROOT:-$HOME/work/agent-configs}"

	if [ "$profile" = "." ]; then
		debug_log "config path for $filename: $config_root/$filename"
		printf '%s\n' "$config_root/$filename"
		return 0
	fi

	debug_log "config path for $filename: $config_root/$profile/$filename"
	printf '%s\n' "$config_root/$profile/$filename"
}
