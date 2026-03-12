#!/bin/sh

set -eu

BASE_DIR="${1:-.}"
SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
REPO_ROOT=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)

if [ ! -d "$BASE_DIR" ]; then
	echo "Base directory not found: $BASE_DIR" >&2
	exit 1
fi

find "$BASE_DIR" \
	\( -type d \( -name .git -o -name node_modules -o -name .pnpm-store -o -name dist -o -name build \) -prune \) -o \
	\( \
		-type d \( -name .claude -o -name .codex \) -o \
		-type f \( -name AGENTS.md -o -name CLAUDE.md -o -name codex.md \) \
	\) \
	-print | sort

check_claude_files() {
	find "$REPO_ROOT" \
		\( -type d \( -name .git -o -name node_modules -o -name .pnpm-store -o -name dist -o -name build -o -name bin -o -name scripts \) -prune \) -o \
		-type f -name CLAUDE.md -print | sort | while IFS= read -r claude_file; do
			claude_dir=$(dirname -- "$claude_file")
			agents_file="$claude_dir/AGENTS.md"
			claude_text=$(tr -d '\r' < "$claude_file")

			if [ ! -f "$agents_file" ]; then
				printf 'WARN missing sibling AGENTS.md: %s\n' "$claude_file" >&2
				continue
			fi

			if [ "$claude_text" != "@AGENTS.md" ]; then
				printf 'WARN non-pointer CLAUDE.md: %s\n' "$claude_file" >&2
			fi
		done
}

check_claude_files
