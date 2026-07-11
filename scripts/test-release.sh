#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WORKFLOW="$ROOT/.github/workflows/release-agent-run.yml"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

fail() {
	echo "FAIL $*" >&2
	exit 1
}

assert_contains() {
	local file="$1"
	local expected="$2"
	grep -Fq -- "$expected" "$file" || fail "expected '$expected' in $file"
}

assert_not_contains() {
	local file="$1"
	local unexpected="$2"
	! grep -Fq -- "$unexpected" "$file" || fail "did not expect '$unexpected' in $file"
}

bash -n "$ROOT/scripts/release.sh"
bash -n "$ROOT/scripts/release-check.sh"
bash -n "$ROOT/scripts/release-verify.sh"

git -C "$ROOT" ls-files --error-unmatch pnpm-lock.yaml >/dev/null || fail "pnpm-lock.yaml must be tracked"
assert_contains "$WORKFLOW" "pnpm install --frozen-lockfile"
assert_not_contains "$WORKFLOW" "pnpm install --no-frozen-lockfile"
assert_not_contains "$ROOT/scripts/release.sh" "npm publish"
assert_contains "$WORKFLOW" "npm publish \"\${{ steps.pack.outputs.tarball }}\""
assert_contains "$WORKFLOW" "workflow_dispatch:"
assert_contains "$WORKFLOW" "ref: \${{ inputs.tag || github.ref }}"
assert_contains "$WORKFLOW" "github.event.repository.visibility"
assert_contains "$WORKFLOW" "Private source repository: publishing without npm provenance"
assert_contains "$WORKFLOW" "GITHUB_REF_TYPE: tag"
publish_steps="$(grep -Ec '^[[:space:]]*run: (npm|pnpm) publish' "$WORKFLOW")"
[ "$publish_steps" -eq 1 ] || fail "release workflow must have exactly one registry publish step"

mapfile -t action_refs < <(sed -n 's/^[[:space:]]*uses: \([^ ]*\).*/\1/p' "$WORKFLOW")
[ "${#action_refs[@]}" -gt 0 ] || fail "release workflow has no action references"
for action_ref in "${action_refs[@]}"; do
	[[ "$action_ref" =~ @[0-9a-f]{40}$ ]] || fail "action is not pinned to a commit: $action_ref"
done

node - "$ROOT/package.json" <<'NODE'
const pkg = require(process.argv[2]);
const match = /^pnpm@(.+)$/.exec(pkg.packageManager || '');
if (!match || pkg.devDependencies?.pnpm !== match[1]) {
	throw new Error('packageManager and devDependencies.pnpm must use the same exact version');
}
NODE

REMOTE="$TMP_DIR/remote.git"
REPO="$TMP_DIR/repo"
git init --bare --initial-branch=main "$REMOTE" >/dev/null
git init -b main "$REPO" >/dev/null
git -C "$REPO" config user.email test@example.com
git -C "$REPO" config user.name "Agent Run Release Test"
mkdir -p "$REPO/scripts"
cp "$ROOT/scripts/release.sh" "$ROOT/scripts/release-check.sh" "$REPO/scripts/"

cat >"$REPO/package.json" <<'JSON'
{
  "name": "@technomoron/release-fixture",
  "version": "0.99.21"
}
JSON
cat >"$REPO/CHANGES" <<'EOF_CHANGES'
Version 0.99.21 (2026-07-01)

* Initial fixture release.
EOF_CHANGES
git -C "$REPO" add package.json CHANGES scripts
git -C "$REPO" commit -m "Initial release" >/dev/null
git -C "$REPO" tag -a '@technomoron/release-fixture@0.99.21' -m 'Release 0.99.21'
git -C "$REPO" remote add origin "$REMOTE"
git -C "$REPO" push -u origin main '@technomoron/release-fixture@0.99.21' >/dev/null 2>&1

cat >"$REPO/package.json" <<'JSON'
{
  "name": "@technomoron/release-fixture",
  "version": "0.99.22"
}
JSON
cat >"$REPO/CHANGES" <<'EOF_CHANGES'
Version 0.99.22 (2026-07-10)

* Exercise the release workflow.

Version 0.99.21 (2026-07-01)

* Initial fixture release.
EOF_CHANGES
bash "$REPO/scripts/release-check.sh" --local >"$TMP_DIR/release-local-check.out" 2>&1
assert_contains "$TMP_DIR/release-local-check.out" "Ready @technomoron/release-fixture@0.99.22"
git -C "$REPO" add package.json CHANGES
git -C "$REPO" commit -m "Prepare release" >/dev/null
git -C "$REPO" push origin main >/dev/null 2>&1

TAG='@technomoron/release-fixture@0.99.22'
bash "$REPO/scripts/release.sh" >"$TMP_DIR/release-success.out" 2>&1
assert_contains "$TMP_DIR/release-success.out" "Triggered GitHub release workflow for $TAG"
[ "$(git -C "$REPO" cat-file -t "refs/tags/$TAG")" = "tag" ] || fail "release tag must be annotated"
git -C "$REPO" ls-remote --exit-code --tags origin "refs/tags/$TAG" >/dev/null || fail "release tag was not pushed"

bash "$REPO/scripts/release.sh" >"$TMP_DIR/release-existing.out" 2>&1
assert_contains "$TMP_DIR/release-existing.out" "tag $TAG already exists"

git -C "$REPO" push origin ":refs/tags/$TAG" >/dev/null 2>&1
git -C "$REPO" tag -d "$TAG" >/dev/null
cat >"$REMOTE/hooks/pre-receive" <<'HOOK'
#!/usr/bin/env bash
while read -r _old _new ref; do
	case "$ref" in
		refs/tags/*)
			echo "tag pushes disabled for test" >&2
			exit 1
			;;
	esac
done
HOOK
chmod +x "$REMOTE/hooks/pre-receive"

set +e
bash "$REPO/scripts/release.sh" >"$TMP_DIR/release-failed.out" 2>&1
status=$?
set -e
[ "$status" -ne 0 ] || fail "release must fail when the tag push is rejected"
assert_contains "$TMP_DIR/release-failed.out" "removing the local tag so the release can be retried"
if git -C "$REPO" rev-parse -q --verify "refs/tags/$TAG" >/dev/null; then
	fail "failed release left local tag $TAG"
fi
if git -C "$REPO" ls-remote --exit-code --tags origin "refs/tags/$TAG" >/dev/null 2>&1; then
	fail "rejected release unexpectedly created remote tag $TAG"
fi

echo "Release tests passed."
