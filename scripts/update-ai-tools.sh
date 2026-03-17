#!/bin/sh

set -eu

TARGET_HOME=${TARGET_HOME:-/home/bjorn}
TARGET_USER=${TARGET_USER:-bjorn}
XDG_CONFIG_HOME=${XDG_CONFIG_HOME:-$TARGET_HOME/.config}
PATH=${PATH:-/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin}

export HOME="$TARGET_HOME"
export XDG_CONFIG_HOME
export PATH

PACKAGES='@openai/codex@latest @anthropic-ai/claude-code@latest'

printf 'Updating AI tools for %s using HOME=%s\n' "$TARGET_USER" "$HOME"
exec pnpm add -g $PACKAGES --reporter=append-only
