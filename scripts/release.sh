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
TAG="${NAME}@${VERSION}"

if git -C "$ROOT" rev-parse -q --verify "refs/tags/${TAG}" >/dev/null; then
	echo "Tag ${TAG} already exists."
	exit 0
fi

echo "Creating release tag ${TAG}"
git -C "$ROOT" tag -a "${TAG}" -m "Release ${NAME} ${VERSION}"

echo "Pushing ${TAG} to origin"
git -C "$ROOT" push origin "refs/tags/${TAG}"
echo "Triggered GitHub release workflow for ${TAG}"
