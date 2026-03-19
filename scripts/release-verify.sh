#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MODE="--local"

for arg in "$@"; do
	case "$arg" in
		--local|--ci)
			MODE="$arg"
			;;
	esac
done

cd "$ROOT"

echo "Running tests"
pnpm test

echo "Running build"
pnpm build

echo "Running release checks (${MODE})"
bash "$ROOT/scripts/release-check.sh" "$MODE"

echo "Release verification completed."
