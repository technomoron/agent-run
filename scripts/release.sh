#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PACKAGE_JSON="$ROOT/package.json"
if command -v cygpath >/dev/null 2>&1; then
	PACKAGE_JSON="$(cygpath -w "$PACKAGE_JSON")"
fi

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

NAME="$(node -p "require(process.argv[1]).name" "$PACKAGE_JSON")"
VERSION="$(node -p "require(process.argv[1]).version" "$PACKAGE_JSON")"
TAG="${NAME}@${VERSION}"

if git -C "$ROOT" rev-parse -q --verify "refs/tags/${TAG}" >/dev/null; then
	echo "Tag ${TAG} already exists."
	exit 0
fi

echo "Creating release tag ${TAG}"
git -C "$ROOT" tag -a "${TAG}" -m "Release ${NAME} ${VERSION}"

echo "Pushing ${TAG} to origin"
if ! git -C "$ROOT" push origin "refs/tags/${TAG}"; then
	echo "Failed to push ${TAG}; removing the local tag so the release can be retried." >&2
	if ! git -C "$ROOT" tag -d "${TAG}" >/dev/null; then
		echo "Failed to remove local tag ${TAG}; remove it manually before retrying." >&2
	fi
	exit 1
fi
echo "Triggered GitHub release workflow for ${TAG}"
