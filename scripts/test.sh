#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

fail() {
	echo "FAIL $*" >&2
	exit 1
}

assert_file() {
	[ -f "$1" ] || fail "missing file: $1"
}

assert_no_file() {
	[ ! -f "$1" ] || fail "unexpected file: $1"
}

assert_no_dir() {
	[ ! -d "$1" ] || fail "unexpected directory: $1"
}

assert_dir() {
	[ -d "$1" ] || fail "missing directory: $1"
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

assert_executable() {
	[ -x "$1" ] || fail "expected executable: $1"
}

assert_tool_shim() {
	if [ -x "$1" ]; then
		return
	fi
	if [ -f "$1.cmd" ]; then
		return
	fi
	fail "expected tool shim: $1"
}

run_tool_shim() {
	local shim="$1"
	shift
	if [ -x "$shim" ]; then
		"$shim" "$@"
		return
	fi
	if [ -f "$shim.cmd" ]; then
		"$shim.cmd" "$@"
		return
	fi
	fail "expected tool shim: $shim"
}

EXAMPLE="$TMP_DIR/basic-config"
cp -R "$ROOT/examples/basic-config" "$EXAMPLE"

PROJECT="$EXAMPLE/project"
AGENT_DIR="$EXAMPLE/agent-config/starter/basic-project"
LIVE_DIR="$AGENT_DIR/live"
CODEX_SKILLS_DIR="$LIVE_DIR/memories/codex-home/skills"
BIN="$ROOT/dist/agent-run.js"
EXPECTED_EXAMPLE="$EXAMPLE"
EXPECTED_AGENT_DIR="$AGENT_DIR"
EXPECTED_PROJECT="$PROJECT"
if command -v cygpath >/dev/null 2>&1; then
	EXPECTED_PATH_SEP="\\"
	EXPECTED_EXAMPLE="$(cygpath -w "$EXPECTED_EXAMPLE")"
	EXPECTED_AGENT_DIR="$(cygpath -w "$EXPECTED_AGENT_DIR")"
	EXPECTED_PROJECT="$(cygpath -w "$EXPECTED_PROJECT")"
	EXPECTED_MEMORY_DIR="$EXPECTED_EXAMPLE\\agent-config\\notes\\memory"
	EXPECTED_REVIEW_FILE="$EXPECTED_AGENT_DIR\\reviews\\REVIEW.md"
	EXPECTED_LIVE_DIR="$EXPECTED_AGENT_DIR\\live"
	EXPECTED_CODEX_SKILLS_DIR="$EXPECTED_LIVE_DIR\\memories\\codex-home\\skills"
	EXPECTED_AGENT_CONFIG_FILE="$EXPECTED_AGENT_DIR\\agent-run.jsonc"
	EXPECTED_LOCAL_FILE="$EXPECTED_AGENT_DIR\\local.md.njk"
	EXPECTED_GLOBAL_SNIPPET="$EXPECTED_EXAMPLE\\agent-config\\global\\snippets\\git-rules.md.njk"
else
	EXPECTED_PATH_SEP="/"
	EXPECTED_MEMORY_DIR="$EXPECTED_EXAMPLE/agent-config/notes/memory"
	EXPECTED_REVIEW_FILE="$EXPECTED_AGENT_DIR/reviews/REVIEW.md"
	EXPECTED_LIVE_DIR="$EXPECTED_AGENT_DIR/live"
	EXPECTED_CODEX_SKILLS_DIR="$EXPECTED_LIVE_DIR/memories/codex-home/skills"
	EXPECTED_AGENT_CONFIG_FILE="$EXPECTED_AGENT_DIR/agent-run.jsonc"
	EXPECTED_LOCAL_FILE="$EXPECTED_AGENT_DIR/local.md.njk"
	EXPECTED_GLOBAL_SNIPPET="$EXPECTED_EXAMPLE/agent-config/global/snippets/git-rules.md.njk"
fi
PACKAGE_JSON="$ROOT/package.json"
if command -v cygpath >/dev/null 2>&1; then
	PACKAGE_JSON="$(cygpath -w "$PACKAGE_JSON")"
fi
PACKAGE_VERSION="$(node -p "require(process.argv[1]).version" "$PACKAGE_JSON")"

node "$BIN" --version >"$TMP_DIR/version.out"
assert_contains "$TMP_DIR/version.out" "agent-run $PACKAGE_VERSION"
node "$BIN" --help >"$TMP_DIR/help.out"
assert_contains "$TMP_DIR/help.out" "agent-run $PACKAGE_VERSION"
assert_contains "$TMP_DIR/help.out" "-V, --version"

bash -n "$ROOT/scripts/update-ai-tools.sh"
bash -n "$ROOT/scripts/agent-config-login-warning.sh"
bash -n "$ROOT/scripts/install-systemd-jobs.sh"
assert_file "$ROOT/ops/systemd/ai-tools-update.service"
assert_file "$ROOT/ops/systemd/ai-tools-update.timer"
"$ROOT/scripts/install-systemd-jobs.sh" --dry-run --ai-tools >"$TMP_DIR/install-ai-tools.out"
assert_contains "$TMP_DIR/install-ai-tools.out" "ai-tools-update.timer"

CONFIG_SOURCE="$TMP_DIR/agent-config-source"
CONFIG_TARGET="$TMP_DIR/synced-agent-config"
mkdir -p "$CONFIG_SOURCE"
git -C "$CONFIG_SOURCE" init -b main >/dev/null
git -C "$CONFIG_SOURCE" config user.email test@example.com
git -C "$CONFIG_SOURCE" config user.name "Agent Run Test"
printf 'agent config\n' >"$CONFIG_SOURCE/README.md"
git -C "$CONFIG_SOURCE" add README.md
git -C "$CONFIG_SOURCE" commit -m "Initial config" >/dev/null
git clone "$CONFIG_SOURCE" "$CONFIG_TARGET" >/dev/null 2>&1
assert_dir "$CONFIG_TARGET/.git"
printf 'dirty\n' >"$CONFIG_TARGET/dirty.txt"
AGENT_CONFIG_TARGET="$CONFIG_TARGET" "$ROOT/scripts/agent-config-login-warning.sh" >"$TMP_DIR/login-warning.out"
assert_contains "$TMP_DIR/login-warning.out" "WARNING: ~/.agent-config HAS UNCOMMITTED LOCAL CHANGES"
assert_contains "$TMP_DIR/login-warning.out" "?? dirty.txt"
rm "$CONFIG_TARGET/dirty.txt"
AGENT_CONFIG_TARGET="$CONFIG_TARGET" "$ROOT/scripts/agent-config-login-warning.sh" >"$TMP_DIR/login-warning-clean.out"
[ ! -s "$TMP_DIR/login-warning-clean.out" ] || fail "expected clean agent config warning to stay quiet"

FAKE_GUARD_BIN="$TMP_DIR/fake-guard-bin"
FAKE_REAL_BIN="$TMP_DIR/fake-real-bin"
mkdir -p "$FAKE_GUARD_BIN" "$FAKE_REAL_BIN"
cat >"$FAKE_GUARD_BIN/codex" <<'SH'
#!/usr/bin/env bash
echo "Run agent-run instead." >&2
exit 1
SH
cat >"$FAKE_REAL_BIN/codex" <<'SH'
#!/usr/bin/env bash
echo "codex-cli fake"
SH
chmod +x "$FAKE_GUARD_BIN/codex" "$FAKE_REAL_BIN/codex"
cat >"$FAKE_GUARD_BIN/codex.cmd" <<'BAT'
@echo off
echo Run agent-run instead. 1>&2
exit /b 1
BAT
cat >"$FAKE_REAL_BIN/codex.cmd" <<'BAT'
@echo off
echo codex-cli fake
BAT
PATH="$FAKE_GUARD_BIN:$FAKE_REAL_BIN:$PATH" node "$BIN" codex --none --version >"$TMP_DIR/codex-version.out"
assert_contains "$TMP_DIR/codex-version.out" "codex-cli fake"

SKELETON_INIT="$TMP_DIR/copied-agent-config"
node "$BIN" --init "$SKELETON_INIT" >"$TMP_DIR/init-config.out"
assert_contains "$TMP_DIR/init-config.out" "OK copied starter config to"
assert_file "$SKELETON_INIT/.gitignore"
assert_file "$SKELETON_INIT/global/agents/code.md.njk"
assert_file "$SKELETON_INIT/global/tool-templates/AGENTS.md.njk"
assert_file "$SKELETON_INIT/global/skills/triage/SKILL.md.njk"
assert_file "$SKELETON_INIT/skills/personal-memory.md"
assert_file "$SKELETON_INIT/starter/basic-project/agent-run.jsonc"
assert_file "$SKELETON_INIT/starter/basic-project/overrides/codex-config.toml.njk"
assert_contains "$SKELETON_INIT/skills/personal-memory.md" "Read \`./notes/memory/README.md\` first."
assert_contains "$SKELETON_INIT/.gitignore" "**/live/"

printf 'local edit\n' >"$SKELETON_INIT/starter/basic-project/local.md.njk"
node "$BIN" --init "$SKELETON_INIT" >/dev/null
assert_contains "$SKELETON_INIT/starter/basic-project/local.md.njk" "local edit"

DEFAULT_CODE_ROOT="$TMP_DIR/code"
DEFAULT_PROJECT="$DEFAULT_CODE_ROOT/acme/widget"
DEFAULT_CONFIG_ROOT="$DEFAULT_CODE_ROOT/agent-config"
DEFAULT_AGENT_DIR="$DEFAULT_CONFIG_ROOT/acme/widget"
mkdir -p "$DEFAULT_PROJECT"
cat >"$DEFAULT_PROJECT/package.json" <<'JSON'
{
  "name": "@acme/widget",
  "private": true
}
JSON
node "$BIN" init "$DEFAULT_PROJECT" >"$TMP_DIR/default-code-root-init.out"
assert_contains "$TMP_DIR/default-code-root-init.out" "OK profile acme/widget"
assert_file "$DEFAULT_CONFIG_ROOT/.gitignore"
assert_file "$DEFAULT_AGENT_DIR/agent-run.jsonc"
assert_file "$DEFAULT_AGENT_DIR/local.md.njk"
assert_file "$DEFAULT_AGENT_DIR/live/AGENTS.md"
assert_no_dir "$TMP_DIR/.agent-config"
rm "$DEFAULT_AGENT_DIR/live/AGENTS.md"
node "$BIN" update --all "$DEFAULT_CONFIG_ROOT" >"$TMP_DIR/default-code-root-update-all.out"
assert_contains "$TMP_DIR/default-code-root-update-all.out" "OK acme/widget"
assert_file "$DEFAULT_AGENT_DIR/live/AGENTS.md"

node "$BIN" update "$PROJECT" >"$TMP_DIR/update.out"
assert_contains "$TMP_DIR/update.out" "OK profile starter/basic-project"

assert_file "$LIVE_DIR/AGENTS.md"
assert_file "$LIVE_DIR/CLAUDE.md"
assert_file "$LIVE_DIR/.claude/CLAUDE.md"
assert_file "$LIVE_DIR/config.toml"
assert_contains "$LIVE_DIR/config.toml" 'sandbox_mode = "danger-full-access"'
assert_file "$LIVE_DIR/.claude/agent-run-settings.json"
assert_file "$CODEX_SKILLS_DIR/triage/SKILL.md"
assert_file "$LIVE_DIR/.claude/skills/triage/SKILL.md"
assert_dir "$AGENT_DIR/reviews"
assert_dir "$LIVE_DIR/memories"
assert_dir "$LIVE_DIR/memories/codex-home"
assert_dir "$AGENT_DIR/overrides"
assert_dir "$LIVE_DIR/bin"

TEST_HOME="$TMP_DIR/home"
mkdir -p "$TEST_HOME/.codex"
printf '{"token":"shared"}\n' >"$TEST_HOME/.codex/auth.json"
HOME="$TEST_HOME" USERPROFILE="$TEST_HOME" node "$BIN" update "$PROJECT" >"$TMP_DIR/update-auth.out"
assert_contains "$TMP_DIR/update-auth.out" "OK profile starter/basic-project"
PROFILE_AUTH="$LIVE_DIR/memories/codex-home/auth.json"
if [ -L "$PROFILE_AUTH" ]; then
	LINK_TARGET="$(readlink "$PROFILE_AUTH")"
	EXPECTED_AUTH="$TEST_HOME/.codex/auth.json"
	if command -v cygpath >/dev/null 2>&1; then
		LINK_TARGET="$(cygpath -u "$LINK_TARGET")"
		EXPECTED_AUTH="$(cygpath -u "$EXPECTED_AUTH")"
	fi
	[ "$LINK_TARGET" = "$EXPECTED_AUTH" ] || fail "expected profile auth.json to link shared auth"
else
	assert_file "$PROFILE_AUTH"
	cmp -s "$PROFILE_AUTH" "$TEST_HOME/.codex/auth.json" || fail "expected profile auth.json to match shared auth"
fi

rm "$LIVE_DIR/AGENTS.md"
HOME="$TEST_HOME" USERPROFILE="$TEST_HOME" node "$BIN" update --all "$EXAMPLE/agent-config" >"$TMP_DIR/update-all.out"
assert_contains "$TMP_DIR/update-all.out" "OK starter/basic-project"
assert_contains "$TMP_DIR/update-all.out" "Updated profiles: 1"
assert_file "$LIVE_DIR/AGENTS.md"

node "$BIN" update "$PROJECT" >/dev/null

assert_contains "$LIVE_DIR/AGENTS.md" "Starter AGENTS for starter/basic-project"
assert_contains "$LIVE_DIR/AGENTS.md" "Starter Code Agent"
assert_contains "$LIVE_DIR/AGENTS.md" 'Use the project root at `'
assert_contains "$LIVE_DIR/AGENTS.md" 'Store durable notes in `'
assert_contains "$LIVE_DIR/AGENTS.md" "globalMemoryDir: \`$EXPECTED_MEMORY_DIR\`"
assert_contains "$LIVE_DIR/AGENTS.md" '`triage`: Use this profile-specific triage workflow'
assert_contains "$LIVE_DIR/AGENTS.md" "profileDir: \`$EXPECTED_AGENT_DIR\`"
assert_contains "$LIVE_DIR/AGENTS.md" "reviewConsolidatedFile: \`$EXPECTED_REVIEW_FILE\`"
assert_contains "$LIVE_DIR/CLAUDE.md" "Starter CLAUDE for starter/basic-project"
assert_contains "$LIVE_DIR/CLAUDE.md" "globalMemoryDir: \`$EXPECTED_MEMORY_DIR\`"
assert_contains "$LIVE_DIR/config.toml" "Starter profile Codex override"
assert_contains "$LIVE_DIR/config.toml" "$EXPECTED_MEMORY_DIR"
assert_contains "$LIVE_DIR/.claude/agent-run-settings.json" '"STARTER_OVERRIDE": "true"'
assert_contains "$LIVE_DIR/.claude/agent-run-settings.json" '"AGENT_GLOBAL_MEMORY_DIR":'
assert_contains "$LIVE_DIR/.claude/agent-run-settings.json" "$EXPECTED_MEMORY_DIR"
assert_contains "$LIVE_DIR/.claude/agent-run-settings.json" "\"AGENT_PROFILE_DIR\": \"$EXPECTED_AGENT_DIR\""
assert_contains "$LIVE_DIR/.claude/agent-run-settings.json" "Bash(pnpm test)"
assert_not_contains "$LIVE_DIR/.claude/agent-run-settings.json" "Bash(git *)"
assert_not_contains "$LIVE_DIR/.claude/agent-run-settings.json" "Bash(npm *)"
assert_contains "$CODEX_SKILLS_DIR/triage/SKILL.md" "Starter Triage"
assert_contains "$CODEX_SKILLS_DIR/release-package-check/SKILL.md" "instead of an external \`repo-check\` command"
assert_contains "$CODEX_SKILLS_DIR/code-review-organizer/SKILL.md" "$EXPECTED_REVIEW_FILE"
assert_contains "$LIVE_DIR/.claude/skills/commit-workflow/SKILL.md" "Use when preparing commits"
assert_contains "$EXAMPLE/agent-config/.gitignore" "**/live/"

assert_tool_shim "$LIVE_DIR/bin/git"
assert_tool_shim "$LIVE_DIR/bin/npm"
assert_tool_shim "$LIVE_DIR/bin/pnpm"
assert_tool_shim "$LIVE_DIR/bin/gh"

mkdir -p "$EXAMPLE/agent-config/notes/memory"
FAKE_TOOL_BIN="$TMP_DIR/fake-tool-bin"
mkdir -p "$FAKE_TOOL_BIN"
cat >"$FAKE_TOOL_BIN/codex" <<'SH'
#!/usr/bin/env bash
printf '%s\n' "$@" >"$AGENT_RUN_ARG_CAPTURE"
SH
cat >"$FAKE_TOOL_BIN/claude" <<'SH'
#!/usr/bin/env bash
printf '%s\n' "$@" >"$AGENT_RUN_ARG_CAPTURE"
SH
chmod +x "$FAKE_TOOL_BIN/codex" "$FAKE_TOOL_BIN/claude"
cat >"$FAKE_TOOL_BIN/codex.cmd" <<'BAT'
@echo off
bash "%~dp0codex" %*
BAT
cat >"$FAKE_TOOL_BIN/claude.cmd" <<'BAT'
@echo off
bash "%~dp0claude" %*
BAT

(cd "$PROJECT" && AGENT_RUN_ARG_CAPTURE="$TMP_DIR/codex-args.out" PATH="$FAKE_TOOL_BIN:$PATH" node "$BIN" codex --sandboxed --memory-check)
assert_contains "$TMP_DIR/codex-args.out" "--add-dir"
assert_contains "$TMP_DIR/codex-args.out" "$EXPECTED_MEMORY_DIR"
assert_contains "$TMP_DIR/codex-args.out" "-C"

(cd "$PROJECT" && AGENT_RUN_ARG_CAPTURE="$TMP_DIR/codex-show-args.out" PATH="$FAKE_TOOL_BIN:$PATH" node "$BIN" codex --show >"$TMP_DIR/codex-show.out")
assert_no_file "$TMP_DIR/codex-show-args.out"
assert_contains "$TMP_DIR/codex-show.out" "Agent: codex"
assert_contains "$TMP_DIR/codex-show.out" "Reads/includes:"
assert_contains "$TMP_DIR/codex-show.out" "$EXPECTED_AGENT_CONFIG_FILE"
assert_contains "$TMP_DIR/codex-show.out" "$EXPECTED_GLOBAL_SNIPPET"
assert_contains "$TMP_DIR/codex-show.out" "$EXPECTED_LOCAL_FILE"
assert_contains "$TMP_DIR/codex-show.out" "Generates:"
assert_contains "$TMP_DIR/codex-show.out" "$EXPECTED_LIVE_DIR${EXPECTED_PATH_SEP}AGENTS.md"
assert_contains "$TMP_DIR/codex-show.out" "$EXPECTED_LIVE_DIR${EXPECTED_PATH_SEP}config.toml"
assert_contains "$TMP_DIR/codex-show.out" "$EXPECTED_CODEX_SKILLS_DIR${EXPECTED_PATH_SEP}commit-workflow${EXPECTED_PATH_SEP}SKILL.md"
assert_contains "$TMP_DIR/codex-show.out" "$EXPECTED_CODEX_SKILLS_DIR${EXPECTED_PATH_SEP}release-package-check${EXPECTED_PATH_SEP}SKILL.md"
assert_contains "$TMP_DIR/codex-show.out" "$EXPECTED_CODEX_SKILLS_DIR${EXPECTED_PATH_SEP}code-review-organizer${EXPECTED_PATH_SEP}SKILL.md"
assert_not_contains "$TMP_DIR/codex-show.out" "$EXPECTED_LIVE_DIR${EXPECTED_PATH_SEP}.claude${EXPECTED_PATH_SEP}agent-run-settings.json"
assert_not_contains "$TMP_DIR/codex-show.out" "$EXPECTED_LIVE_DIR${EXPECTED_PATH_SEP}.claude${EXPECTED_PATH_SEP}skills${EXPECTED_PATH_SEP}commit-workflow${EXPECTED_PATH_SEP}SKILL.md"

(cd "$PROJECT" && AGENT_RUN_ARG_CAPTURE="$TMP_DIR/codex-generate-args.out" PATH="$FAKE_TOOL_BIN:$PATH" node "$BIN" codex --generate >"$TMP_DIR/codex-generate.out")
assert_no_file "$TMP_DIR/codex-generate-args.out"
assert_contains "$TMP_DIR/codex-generate.out" "OK profile"
assert_contains "$TMP_DIR/codex-generate.out" "Generated files:"
assert_file "$LIVE_DIR/AGENTS.md"
assert_file "$LIVE_DIR/CLAUDE.md"

(cd "$PROJECT" && AGENT_RUN_ARG_CAPTURE="$TMP_DIR/claude-args.out" PATH="$FAKE_TOOL_BIN:$PATH" node "$BIN" claude --memory-check)
assert_contains "$TMP_DIR/claude-args.out" "--add-dir"
assert_contains "$TMP_DIR/claude-args.out" "$EXPECTED_MEMORY_DIR"
assert_contains "$TMP_DIR/claude-args.out" "$EXPECTED_LIVE_DIR"

(cd "$PROJECT" && AGENT_RUN_ARG_CAPTURE="$TMP_DIR/claude-show-args.out" PATH="$FAKE_TOOL_BIN:$PATH" node "$BIN" claude --show >"$TMP_DIR/claude-show.out")
assert_no_file "$TMP_DIR/claude-show-args.out"
assert_contains "$TMP_DIR/claude-show.out" "Agent: claude"
assert_contains "$TMP_DIR/claude-show.out" "$EXPECTED_AGENT_CONFIG_FILE"
assert_contains "$TMP_DIR/claude-show.out" "$EXPECTED_LIVE_DIR${EXPECTED_PATH_SEP}CLAUDE.md"
assert_contains "$TMP_DIR/claude-show.out" "$EXPECTED_LIVE_DIR${EXPECTED_PATH_SEP}.claude${EXPECTED_PATH_SEP}CLAUDE.md"
assert_contains "$TMP_DIR/claude-show.out" "$EXPECTED_LIVE_DIR${EXPECTED_PATH_SEP}.claude${EXPECTED_PATH_SEP}agent-run-settings.json"
assert_contains "$TMP_DIR/claude-show.out" "$EXPECTED_LIVE_DIR${EXPECTED_PATH_SEP}.claude${EXPECTED_PATH_SEP}skills${EXPECTED_PATH_SEP}commit-workflow${EXPECTED_PATH_SEP}SKILL.md"
assert_contains "$TMP_DIR/claude-show.out" "$EXPECTED_LIVE_DIR${EXPECTED_PATH_SEP}.claude${EXPECTED_PATH_SEP}skills${EXPECTED_PATH_SEP}release-package-check${EXPECTED_PATH_SEP}SKILL.md"
assert_contains "$TMP_DIR/claude-show.out" "$EXPECTED_LIVE_DIR${EXPECTED_PATH_SEP}.claude${EXPECTED_PATH_SEP}skills${EXPECTED_PATH_SEP}code-review-organizer${EXPECTED_PATH_SEP}SKILL.md"
assert_not_contains "$TMP_DIR/claude-show.out" "$EXPECTED_LIVE_DIR${EXPECTED_PATH_SEP}config.toml"
assert_not_contains "$TMP_DIR/claude-show.out" "$EXPECTED_CODEX_SKILLS_DIR${EXPECTED_PATH_SEP}commit-workflow${EXPECTED_PATH_SEP}SKILL.md"

LEGACY_AGENT_DIR="$EXPECTED_LIVE_DIR" \
LEGACY_PROJECT_ROOT="$EXPECTED_PROJECT" \
LEGACY_MEMORY_DIR="$EXPECTED_MEMORY_DIR" \
	node >"$LIVE_DIR/.claude/settings.json" <<'NODE'
const settings = {
  env: {
    AGENT_DIR: process.env.LEGACY_AGENT_DIR,
    AGENT_RUN_PROJECT_ROOT: process.env.LEGACY_PROJECT_ROOT,
    AGENT_GLOBAL_MEMORY_DIR: process.env.LEGACY_MEMORY_DIR
  }
};
process.stdout.write(`${JSON.stringify(settings, null, 2)}\n`);
NODE
node "$BIN" update "$PROJECT" >/dev/null
assert_no_file "$LIVE_DIR/.claude/settings.json"

set +e
run_tool_shim "$LIVE_DIR/bin/git" commit >"$TMP_DIR/git.out" 2>&1
git_status=$?
run_tool_shim "$LIVE_DIR/bin/pnpm" publish >"$TMP_DIR/pnpm.out" 2>&1
pnpm_status=$?
run_tool_shim "$LIVE_DIR/bin/gh" release create v0.0.0 >"$TMP_DIR/gh.out" 2>&1
gh_status=$?
set -e
[ "$git_status" -eq 42 ] || fail "expected git commit shim to exit 42, got $git_status"
[ "$pnpm_status" -eq 42 ] || fail "expected pnpm publish shim to exit 42, got $pnpm_status"
[ "$gh_status" -eq 42 ] || fail "expected gh release shim to exit 42, got $gh_status"
assert_contains "$TMP_DIR/git.out" "blocked git commit"
assert_contains "$TMP_DIR/pnpm.out" "blocked pnpm publish"
assert_contains "$TMP_DIR/gh.out" "blocked gh release create"

mkdir -p "$LIVE_DIR/.agents/skills/code-review" "$LIVE_DIR/.claude/skills/code-review"
printf 'stale codex skill\n' >"$LIVE_DIR/.agents/skills/code-review/SKILL.md"
printf 'stale claude skill\n' >"$LIVE_DIR/.claude/skills/code-review/SKILL.md"
node "$BIN" update "$PROJECT" >/dev/null
assert_no_dir "$LIVE_DIR/.agents/skills/code-review"
assert_no_dir "$LIVE_DIR/.claude/skills/code-review"

mkdir -p "$LIVE_DIR/.agents/skills/commit-workflow"
printf 'stale codex skill\n' >"$LIVE_DIR/.agents/skills/commit-workflow/SKILL.md"
node "$BIN" update "$PROJECT" >/dev/null
assert_no_dir "$LIVE_DIR/.agents/skills/commit-workflow"

mkdir -p "$LIVE_DIR/reviews"
printf 'legacy review\n' >"$LIVE_DIR/reviews/legacy.md"
node "$BIN" update "$PROJECT" >/dev/null
assert_file "$AGENT_DIR/reviews/legacy.md"
assert_no_file "$LIVE_DIR/reviews/legacy.md"
mkdir -p "$LIVE_DIR/reviews"
printf 'different legacy review\n' >"$LIVE_DIR/reviews/legacy.md"
printf 'existing serialized review\n' >"$AGENT_DIR/reviews/legacy.1.md"
node "$BIN" update "$PROJECT" >/dev/null
assert_file "$AGENT_DIR/reviews/legacy.2.md"
assert_contains "$AGENT_DIR/reviews/legacy.2.md" "different legacy review"
assert_no_file "$LIVE_DIR/reviews/legacy.md"

node "$BIN" check "$PROJECT" >"$TMP_DIR/check.out"
assert_contains "$TMP_DIR/check.out" "OK no issues found"

node "$BIN" check --all "$PROJECT" >"$TMP_DIR/check-all.out"
assert_contains "$TMP_DIR/check-all.out" "OK $EXPECTED_PROJECT"
assert_contains "$TMP_DIR/check-all.out" "Summary: 0 error(s), 0 warning(s)"

printf '\nstale\n' >>"$LIVE_DIR/AGENTS.md"
set +e
node "$BIN" check "$PROJECT" >"$TMP_DIR/stale.out" 2>&1
stale_status=$?
set -e
[ "$stale_status" -ne 0 ] || fail "expected stale generated file check to fail"
assert_contains "$TMP_DIR/stale.out" "generated file is out of date"

node "$BIN" update "$PROJECT" >/dev/null
printf 'local agent file\n' >"$PROJECT/AGENTS.md"
set +e
node "$BIN" check "$PROJECT" >"$TMP_DIR/local-ai.out" 2>&1
local_ai_status=$?
set -e
[ "$local_ai_status" -ne 0 ] || fail "expected local AI file check to fail"
assert_contains "$TMP_DIR/local-ai.out" "local AI file in project"

(cd "$PROJECT" && AGENT_RUN_ARG_CAPTURE="$TMP_DIR/local-show-args.out" PATH="$FAKE_TOOL_BIN:$PATH" node "$BIN" codex --show >"$TMP_DIR/local-show.out")
assert_no_file "$TMP_DIR/local-show-args.out"
assert_contains "$TMP_DIR/local-show.out" "Agent: codex"

set +e
(cd "$PROJECT" && AGENT_RUN_ARG_CAPTURE="$TMP_DIR/local-run-blocked-args.out" PATH="$FAKE_TOOL_BIN:$PATH" node "$BIN" codex --sandboxed >"$TMP_DIR/local-run-blocked.out" 2>&1)
local_run_blocked_status=$?
set -e
[ "$local_run_blocked_status" -ne 0 ] || fail "expected local AI file run to fail without --local"
assert_contains "$TMP_DIR/local-run-blocked.out" "found local AI files"

(cd "$PROJECT" && AGENT_RUN_ARG_CAPTURE="$TMP_DIR/local-run-allowed-args.out" PATH="$FAKE_TOOL_BIN:$PATH" node "$BIN" codex --local --sandboxed >"$TMP_DIR/local-run-allowed.out" 2>&1)
assert_contains "$TMP_DIR/local-run-allowed.out" "WARNING: local AI files found"
assert_file "$TMP_DIR/local-run-allowed-args.out"
rm "$PROJECT/AGENTS.md"

node "$BIN" check "$PROJECT" >/dev/null

node --input-type=module <<'EOF'
import assert from 'node:assert/strict';
import path from 'node:path';
import { defaultConfigRootSearchCandidates, parseInvocation } from './dist/agent-run.js';

assert.deepEqual(
	parseInvocation('agent-run', ['codex', '--sandboxed', '--network', 'hello']),
	parseInvocation('agent-run', ['--sandboxed', '--network', 'codex', 'hello'])
);

assert.deepEqual(parseInvocation('agent-run', ['--create', 'claude', 'hello']), {
	args: ['hello'],
	command: 'claude',
	wrapperArgs: {
		none: false,
		create: true,
		local: false,
		show: false,
		generate: false,
		codexSandboxMode: null,
		codexNetwork: false
	}
});

assert.equal(parseInvocation('agent-run', ['--local', 'codex']).wrapperArgs.local, true);
assert.equal(parseInvocation('agent-run', ['codex', '--show']).wrapperArgs.show, true);
assert.equal(parseInvocation('agent-run', ['codex', '--generate']).wrapperArgs.generate, true);
assert.equal(parseInvocation('agent-run', ['--all', 'check', '.']).command, 'check');
assert.deepEqual(parseInvocation('agent-run', ['update', '--all', '/tmp/agent-config']), {
	all: true,
	command: 'update',
	targetPath: path.resolve('/tmp/agent-config')
});
assert.deepEqual(parseInvocation('agent-run', ['--init', '/tmp/agent-config']), {
	command: 'init-config',
	targetPath: path.resolve('/tmp/agent-config')
});
assert.deepEqual(defaultConfigRootSearchCandidates(undefined, { platform: 'win32', homeDir: 'C:\\Users\\alice' }), [
	'C:\\Users\\alice\\Documents\\code\\agent-config',
	'C:\\Users\\alice\\Documents\\code\\agent-configs',
	'C:\\Users\\alice\\Desktop\\code\\agent-config',
	'C:\\Users\\alice\\Desktop\\code\\agent-configs',
	'C:\\code\\agent-config',
	'C:\\code\\agent-configs'
]);
assert.deepEqual(defaultConfigRootSearchCandidates(undefined, { platform: 'linux', homeDir: '/home/alice' }), [
	'/home/alice/code/agent-config',
	'/home/alice/code/agent-configs',
	'/home/alice/agent-config',
	'/home/alice/agent-configs',
	'/home/alice/.agent-config',
	'/home/alice/.agent-configs'
]);
EOF

echo "All tests passed"
