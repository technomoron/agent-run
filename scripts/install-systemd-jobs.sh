#!/usr/bin/env bash
set -euo pipefail

usage() {
	cat <<'USAGE'
Usage:
  install-systemd-jobs.sh [options]

Options:
  --ai-tools                  Install and enable ai-tools-update.timer.
  --all                       Install all repo-provided systemd jobs.
  --dry-run                   Print actions without writing system files.
  -h, --help                  Show this help.

Examples:
  sudo scripts/install-systemd-jobs.sh --ai-tools
  sudo scripts/install-systemd-jobs.sh --all
USAGE
}

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
INSTALL_LIB_DIR="${INSTALL_LIB_DIR:-/usr/local/lib/agent-run}"
SYSTEMD_DIR="${SYSTEMD_DIR:-/etc/systemd/system}"
ORIGINAL_ARGS=("$@")

INSTALL_AI_TOOLS=0
INSTALL_ALL=0
DRY_RUN=0

while [ "$#" -gt 0 ]; do
	case "$1" in
		--ai-tools)
			INSTALL_AI_TOOLS=1
			shift
			;;
		--all)
			INSTALL_ALL=1
			INSTALL_AI_TOOLS=1
			shift
			;;
		--dry-run)
			DRY_RUN=1
			shift
			;;
		-h|--help)
			usage
			exit 0
			;;
		*)
			echo "Unknown option: $1" >&2
			usage >&2
			exit 2
			;;
	esac
done

if [ "$INSTALL_AI_TOOLS" -eq 0 ]; then
	usage >&2
	exit 2
fi

if [ "$DRY_RUN" -eq 0 ] && [ "${EUID:-$(id -u)}" -ne 0 ]; then
	exec sudo "$0" "${ORIGINAL_ARGS[@]}"
fi

run() {
	if [ "$DRY_RUN" -eq 1 ]; then
		printf '+'
		printf ' %q' "$@"
		printf '\n'
		return 0
	fi
	"$@"
}

run install -d -m 0755 "$INSTALL_LIB_DIR" "$SYSTEMD_DIR"
run install -m 0755 "$ROOT/scripts/update-ai-tools.sh" "$INSTALL_LIB_DIR/update-ai-tools.sh"
run install -m 0644 "$ROOT/ops/systemd/ai-tools-update.service" "$SYSTEMD_DIR/ai-tools-update.service"
run install -m 0644 "$ROOT/ops/systemd/ai-tools-update.timer" "$SYSTEMD_DIR/ai-tools-update.timer"

if [ "$INSTALL_AI_TOOLS" -eq 1 ]; then
	run systemctl daemon-reload
	run systemctl enable --now ai-tools-update.timer
fi
