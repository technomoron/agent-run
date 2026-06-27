#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MODE="${1:-normal}"

if [ "$MODE" = "--" ]; then
	MODE="${2:-normal}"
fi

is_local_mode() {
	[ "$MODE" = "--local" ]
}

is_ci_mode() {
	[ "$MODE" = "--ci" ]
}

skip() {
	local message="$1"
	echo "Skip ${message}"
	if [ "$MODE" = "--strict-ready" ]; then
		exit 3
	fi
	exit 0
}

if [ ! -f "$ROOT/package.json" ]; then
	echo "Missing package.json at $ROOT" >&2
	exit 1
fi
PACKAGE_JSON="$ROOT/package.json"
if command -v cygpath >/dev/null 2>&1; then
	PACKAGE_JSON="$(cygpath -w "$PACKAGE_JSON")"
fi

REPO_ROOT="$(git -C "$ROOT" rev-parse --show-toplevel 2>/dev/null || true)"
if [ -z "$REPO_ROOT" ]; then
	echo "No git repo found for $ROOT" >&2
	exit 1
fi

if ! is_local_mode && ! is_ci_mode && [ -n "$(git -C "$REPO_ROOT" status --porcelain)" ]; then
	echo "Working tree is not clean in $REPO_ROOT. Commit or stash changes before release." >&2
	exit 1
fi

if ! is_local_mode && ! is_ci_mode; then
	BRANCH="$(git -C "$REPO_ROOT" rev-parse --abbrev-ref HEAD)"
	UPSTREAM="$(git -C "$REPO_ROOT" rev-parse --abbrev-ref --symbolic-full-name @{u} 2>/dev/null || true)"
	if [ -z "$UPSTREAM" ]; then
		echo "No upstream configured for ${BRANCH} in ${REPO_ROOT}. Set upstream before release." >&2
		exit 1
	fi

	if ! git -C "$REPO_ROOT" fetch --quiet; then
		echo "Failed to fetch remote updates for ${REPO_ROOT}. Check network/remote access." >&2
		exit 1
	fi

	set -- $(git -C "$REPO_ROOT" rev-list --left-right --count "${UPSTREAM}...HEAD")
	BEHIND="$1"
	AHEAD="$2"
	if [ "$BEHIND" -ne 0 ] || [ "$AHEAD" -ne 0 ]; then
		echo "Branch ${BRANCH} is not in sync with ${UPSTREAM} in ${REPO_ROOT} (behind ${BEHIND}, ahead ${AHEAD})." >&2
		echo "Pull/push until branch matches upstream before release." >&2
		exit 1
	fi
fi

NAME="$(node -p "require(process.argv[1]).name" "$PACKAGE_JSON")"
VERSION="$(node -p "require(process.argv[1]).version" "$PACKAGE_JSON")"
PRIVATE="$(node -p "Boolean(require(process.argv[1]).private)" "$PACKAGE_JSON")"

if [ "$PRIVATE" = "true" ]; then
	skip "${NAME}: private package."
fi

if ! is_ci_mode && git -C "$REPO_ROOT" rev-parse -q --verify "refs/tags/${NAME}@${VERSION}" >/dev/null; then
	skip "${NAME}: tag ${NAME}@${VERSION} already exists."
fi

if is_ci_mode && [ "${GITHUB_REF_TYPE:-}" = "tag" ]; then
	EXPECTED_TAG="${NAME}@${VERSION}"
	if [ "${GITHUB_REF_NAME:-}" != "$EXPECTED_TAG" ]; then
		echo "Workflow tag ${GITHUB_REF_NAME:-<missing>} does not match expected package tag ${EXPECTED_TAG}." >&2
		exit 1
	fi
fi

if is_ci_mode; then
	LAST_TAG="$(git -C "$REPO_ROOT" tag -l "${NAME}@*" --sort=-v:refname | grep -vx "${NAME}@${VERSION}" | head -n1 || true)"
else
	LAST_TAG="$(git -C "$REPO_ROOT" tag -l "${NAME}@*" --sort=-v:refname | head -n1 || true)"
fi
LAST_VERSION=""
if [ -n "$LAST_TAG" ]; then
	LAST_VERSION="${LAST_TAG##*@}"
fi

if [ -n "$LAST_VERSION" ]; then
	if ! node - "$VERSION" "$LAST_VERSION" <<'NODE'
const [current, previous] = process.argv.slice(2);
const normalize = (v) => v.replace(/^v/, '');
const parse = (v) => {
	const [main, pre] = normalize(v).split('-');
	const parts = main.split('.').map((n) => parseInt(n, 10) || 0);
	return { parts, pre: pre ? pre.split('.') : [] };
};
const compare = (a, b) => {
	for (let i = 0; i < 3; i += 1) {
		const ai = a.parts[i] || 0;
		const bi = b.parts[i] || 0;
		if (ai > bi) return 1;
		if (ai < bi) return -1;
	}
	if (!a.pre.length && !b.pre.length) return 0;
	if (!a.pre.length) return 1;
	if (!b.pre.length) return -1;
	const len = Math.max(a.pre.length, b.pre.length);
	for (let i = 0; i < len; i += 1) {
		const ai = a.pre[i];
		const bi = b.pre[i];
		if (ai === undefined) return -1;
		if (bi === undefined) return 1;
		const an = Number(ai);
		const bn = Number(bi);
		const aNum = String(an) === ai;
		const bNum = String(bn) === bi;
		if (aNum && bNum) {
			if (an > bn) return 1;
			if (an < bn) return -1;
			continue;
		}
		if (aNum && !bNum) return -1;
		if (!aNum && bNum) return 1;
		if (ai > bi) return 1;
		if (ai < bi) return -1;
	}
	return 0;
};
const result = compare(parse(current), parse(previous));
process.exit(result > 0 ? 0 : 1);
NODE
	then
		skip "${NAME}: version ${VERSION} is not newer than ${LAST_VERSION}."
	fi
fi

BASE_REF="$LAST_TAG"
if [ -z "$BASE_REF" ]; then
	BASE_REF="$(git -C "$REPO_ROOT" rev-list --max-parents=0 HEAD | head -n1)"
fi

if ! git -C "$REPO_ROOT" diff --name-only "$BASE_REF"..HEAD -- . | grep -q .; then
	skip "${NAME}: no changes since ${LAST_TAG:-initial commit}."
fi

CHANGES_FILE="$ROOT/CHANGES"
if [ ! -f "$CHANGES_FILE" ]; then
	echo "Missing CHANGES file for ${NAME}: ${CHANGES_FILE}" >&2
	exit 1
fi

if ! awk -v v="$VERSION" '
	$1 == "Version" {
		line = $0
		sub(/^Version[[:space:]]+/, "", line)
		ver = line
		sub(/[[:space:]]+\(.*/, "", ver)
		if (ver == v) {
			found = 1
		}
	}
	END { exit(found ? 0 : 1) }
' "$CHANGES_FILE"; then
	echo "${CHANGES_FILE} is missing 'Version ${VERSION} (<YYYY-MM-DD>)' for ${NAME}." >&2
	echo "Add the version section before release." >&2
	exit 1
fi

echo "Ready ${NAME}@${VERSION} from ${ROOT}"
