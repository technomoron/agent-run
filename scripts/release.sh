#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

cd "$ROOT"
set +e
bash "$ROOT/scripts/release-check.sh" --strict-ready
status=$?
set -e

if [ "$status" -eq 3 ]; then
	exit 0
fi
if [ "$status" -ne 0 ]; then
	exit "$status"
fi

NAME="$(node -p "require('$ROOT/package.json').name")"
VERSION="$(node -p "require('$ROOT/package.json').version")"

if [ -z "${npm_config_cache:-}" ] && [ -z "${NPM_CONFIG_CACHE:-}" ]; then
	export npm_config_cache="${TMPDIR:-/tmp}/agent-run-npm-cache"
fi

PUBLISH_ARGS=(publish --access public)

if echo "$VERSION" | grep -q "-"; then
	tag_name="$(echo "$VERSION" | sed 's/^[0-9.]*-\([A-Za-z0-9]*\).*/\1/')"
	PUBLISH_ARGS+=(--tag "$tag_name")
fi

echo "Publishing ${NAME}@${VERSION} from ${ROOT}"

unset npm_config_npm_globalconfig
unset npm_config_verify_deps_before_run
unset npm_config__jsr_registry
unset npm_config_only_built_dependencies
unset npm_config_global_bin_dir
npm "${PUBLISH_ARGS[@]}"

git -C "$ROOT" tag -a "${NAME}@${VERSION}" -m "Release ${NAME} ${VERSION}"
echo "Released ${NAME}@${VERSION}. Push tags with: git push --tags"
