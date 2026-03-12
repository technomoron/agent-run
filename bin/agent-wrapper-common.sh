#!/bin/sh

set -eu

SCRIPT_PATH=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)/$(basename -- "$0")
WRAPPER_ROOT=$(CDPATH= cd -- "$(dirname -- "$SCRIPT_PATH")/.." && pwd)

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
			debug_log "profile from unscoped package name: $pkg_name"
			printf '%s\n' "$pkg_name"
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
	config_root=$(default_config_root)

	debug_log "config path for $filename: $config_root/$profile/agent/$filename"
	printf '%s\n' "$config_root/$profile/agent/$filename"
}

resolve_agent_dir() {
	project_root=$(find_project_root)
	profile=$(resolve_profile "$project_root")
	config_root=$(default_config_root)

	debug_log "agent dir: $config_root/$profile/agent"
	printf '%s\n' "$config_root/$profile/agent"
}

default_config_root() {
	if [ -n "${AGENT_CONFIG_ROOT:-}" ]; then
		printf '%s\n' "$AGENT_CONFIG_ROOT"
		return 0
	fi

	if [ -d "$WRAPPER_ROOT/agents" ]; then
		printf '%s\n' "$WRAPPER_ROOT/agents"
		return 0
	fi

	printf '%s\n' "$HOME/work/agent-configs"
}

materialize_agent_runtime_dir() {
	agent_dir="$1"
	temp_dir=$(mktemp -d "${TMPDIR:-/tmp}/agent-wrapper.XXXXXX")
	mods_file="$agent_dir/AGENTS-MODS.md"
	legacy_agents_file="$agent_dir/AGENTS.md"

	if [ -f "$mods_file" ]; then
		node - "$mods_file" "$temp_dir/AGENTS.md" <<'NODE'
const fs = require('fs');
const path = require('path');

const sourceFile = path.resolve(process.argv[2]);
const outputFile = path.resolve(process.argv[3]);

function readLines(file) {
	return fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n').split('\n');
}

function renderFile(file, stack = []) {
	if (stack.includes(file)) {
		throw new Error(`Include cycle detected: ${[...stack, file].join(' -> ')}`);
	}

	const lines = readLines(file);
	const output = [];
	const nextStack = [...stack, file];
	let sawLeadingInclude = false;
	let insertedOverrideNote = false;
	let contentStarted = false;

	for (const line of lines) {
		const trimmed = line.trim();
		if (!contentStarted && trimmed === '') {
			continue;
		}

		if (trimmed.startsWith('@')) {
			const includePath = trimmed.slice(1).trim();
			if (!includePath) {
				continue;
			}
			const resolved = path.isAbsolute(includePath)
				? includePath
				: path.resolve(path.dirname(file), includePath);
			output.push(renderFile(resolved, nextStack));
			if (!contentStarted) {
				sawLeadingInclude = true;
			}
			continue;
		}

		if (sawLeadingInclude && !insertedOverrideNote) {
			output.push('');
			output.push('If anything below this point conflicts with anything included above,');
			output.push('the later instructions below take precedence.');
			output.push('');
			insertedOverrideNote = true;
		}

		output.push(line);
		contentStarted = true;
	}

	return output.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
}

const rendered = renderFile(sourceFile);
fs.writeFileSync(outputFile, rendered);
NODE
	elif [ -f "$legacy_agents_file" ]; then
		cp "$legacy_agents_file" "$temp_dir/AGENTS.md"
	else
		rm -rf "$temp_dir"
		return 1
	fi

	printf '@AGENTS.md\n' > "$temp_dir/CLAUDE.md"
	printf '%s\n' "$temp_dir"
}

warn_missing_config_dir() {
	config_file="$1"
	config_dir=$(dirname -- "$config_file")

	if [ ! -d "$config_dir" ]; then
		printf 'agent-wrapper: warning: project config dir missing: %s\n' "$config_dir" >&2
	fi
}
