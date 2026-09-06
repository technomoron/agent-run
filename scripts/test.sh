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

assert_line_count() {
	local file="$1"
	local expected="$2"
	local count="$3"
	local actual
	actual="$(grep -Fxc -- "$expected" "$file" || true)"
	[ "$actual" -eq "$count" ] || fail "expected '$expected' $count time(s) in $file, got $actual"
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
CODEX_HOME_DIR="$LIVE_DIR/memories/codex-home"
CODEX_AGENTS_FILE="$CODEX_HOME_DIR/AGENTS.md"
CODEX_CONFIG_FILE="$CODEX_HOME_DIR/config.toml"
CODEX_SKILLS_DIR="$CODEX_HOME_DIR/skills"
GEMINI_RUNTIME_DIR="$LIVE_DIR/gemini"
GEMINI_HOME_DIR="$GEMINI_RUNTIME_DIR/home"
GEMINI_AGENTS_FILE="$GEMINI_RUNTIME_DIR/AGENTS.md"
GEMINI_SETTINGS_FILE="$GEMINI_RUNTIME_DIR/settings.json"
GEMINI_SKILLS_DIR="$GEMINI_HOME_DIR/.agents/skills"
GROK_RUNTIME_DIR="$LIVE_DIR/grok"
GROK_AGENTS_FILE="$GROK_RUNTIME_DIR/AGENTS.md"
GROK_CONFIG_FILE="$GROK_RUNTIME_DIR/config.toml"
GROK_SKILLS_DIR="$GROK_RUNTIME_DIR/skills"
BIN="$ROOT/dist/agent-run.js"

# Keep packaged example MCP servers disabled, but enable one in this isolated
# test tree so every adapter's active MCP serialization is exercised.
node - "$AGENT_DIR/agent-run.jsonc" <<'NODE'
const fs = require('node:fs');
const file = process.argv[2];
const manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
manifest.mcp.servers['example-stdio'].enabled = true;
fs.writeFileSync(file, `${JSON.stringify(manifest, null, 2)}\n`);
NODE

EXPECTED_EXAMPLE="$EXAMPLE"
EXPECTED_AGENT_DIR="$AGENT_DIR"
EXPECTED_PROJECT="$PROJECT"
if command -v cygpath >/dev/null 2>&1; then
	EXPECTED_PATH_SEP="\\"
	EXPECTED_EXAMPLE="$(cygpath -w "$EXPECTED_EXAMPLE")"
	EXPECTED_AGENT_DIR="$(cygpath -w "$EXPECTED_AGENT_DIR")"
	EXPECTED_PROJECT="$(cygpath -w "$EXPECTED_PROJECT")"
	EXPECTED_MEMORY_DIR="$EXPECTED_EXAMPLE\\agent-config\\notes\\memory"
	EXPECTED_PROJECT_MEMORY_DIR="$EXPECTED_AGENT_DIR\\notes\\memory"
	EXPECTED_REVIEW_FILE="$EXPECTED_AGENT_DIR\\reviews\\REVIEW.md"
	EXPECTED_LIVE_DIR="$EXPECTED_AGENT_DIR\\live"
	EXPECTED_CODEX_HOME_DIR="$EXPECTED_LIVE_DIR\\memories\\codex-home"
	EXPECTED_CODEX_AGENTS_FILE="$EXPECTED_CODEX_HOME_DIR\\AGENTS.md"
	EXPECTED_CODEX_CONFIG_FILE="$EXPECTED_CODEX_HOME_DIR\\config.toml"
	EXPECTED_CODEX_SKILLS_DIR="$EXPECTED_CODEX_HOME_DIR\\skills"
	EXPECTED_GEMINI_RUNTIME_DIR="$EXPECTED_LIVE_DIR\\gemini"
	EXPECTED_GEMINI_HOME_DIR="$EXPECTED_GEMINI_RUNTIME_DIR\\home"
	EXPECTED_GEMINI_AGENTS_FILE="$EXPECTED_GEMINI_RUNTIME_DIR\\AGENTS.md"
	EXPECTED_GEMINI_SETTINGS_FILE="$EXPECTED_GEMINI_RUNTIME_DIR\\settings.json"
	EXPECTED_GEMINI_SKILLS_DIR="$EXPECTED_GEMINI_HOME_DIR\\.agents\\skills"
	EXPECTED_GROK_RUNTIME_DIR="$EXPECTED_LIVE_DIR\\grok"
	EXPECTED_GROK_AGENTS_FILE="$EXPECTED_GROK_RUNTIME_DIR\\AGENTS.md"
	EXPECTED_GROK_CONFIG_FILE="$EXPECTED_GROK_RUNTIME_DIR\\config.toml"
	EXPECTED_GROK_SKILLS_DIR="$EXPECTED_GROK_RUNTIME_DIR\\skills"
	EXPECTED_AGENT_CONFIG_FILE="$EXPECTED_AGENT_DIR\\agent-run.jsonc"
	EXPECTED_ROOT_DEFAULTS_FILE="$EXPECTED_EXAMPLE\\agent-config\\agent-run.defaults.jsonc"
	EXPECTED_LOCAL_FILE="$EXPECTED_AGENT_DIR\\local.md.njk"
	EXPECTED_GLOBAL_SNIPPET="$EXPECTED_EXAMPLE\\agent-config\\global\\snippets\\git-rules.md.njk"
else
	EXPECTED_PATH_SEP="/"
	EXPECTED_MEMORY_DIR="$EXPECTED_EXAMPLE/agent-config/notes/memory"
	EXPECTED_PROJECT_MEMORY_DIR="$EXPECTED_AGENT_DIR/notes/memory"
	EXPECTED_REVIEW_FILE="$EXPECTED_AGENT_DIR/reviews/REVIEW.md"
	EXPECTED_LIVE_DIR="$EXPECTED_AGENT_DIR/live"
	EXPECTED_CODEX_HOME_DIR="$EXPECTED_LIVE_DIR/memories/codex-home"
	EXPECTED_CODEX_AGENTS_FILE="$EXPECTED_CODEX_HOME_DIR/AGENTS.md"
	EXPECTED_CODEX_CONFIG_FILE="$EXPECTED_CODEX_HOME_DIR/config.toml"
	EXPECTED_CODEX_SKILLS_DIR="$EXPECTED_CODEX_HOME_DIR/skills"
	EXPECTED_GEMINI_RUNTIME_DIR="$EXPECTED_LIVE_DIR/gemini"
	EXPECTED_GEMINI_HOME_DIR="$EXPECTED_GEMINI_RUNTIME_DIR/home"
	EXPECTED_GEMINI_AGENTS_FILE="$EXPECTED_GEMINI_RUNTIME_DIR/AGENTS.md"
	EXPECTED_GEMINI_SETTINGS_FILE="$EXPECTED_GEMINI_RUNTIME_DIR/settings.json"
	EXPECTED_GEMINI_SKILLS_DIR="$EXPECTED_GEMINI_HOME_DIR/.agents/skills"
	EXPECTED_GROK_RUNTIME_DIR="$EXPECTED_LIVE_DIR/grok"
	EXPECTED_GROK_AGENTS_FILE="$EXPECTED_GROK_RUNTIME_DIR/AGENTS.md"
	EXPECTED_GROK_CONFIG_FILE="$EXPECTED_GROK_RUNTIME_DIR/config.toml"
	EXPECTED_GROK_SKILLS_DIR="$EXPECTED_GROK_RUNTIME_DIR/skills"
	EXPECTED_AGENT_CONFIG_FILE="$EXPECTED_AGENT_DIR/agent-run.jsonc"
	EXPECTED_ROOT_DEFAULTS_FILE="$EXPECTED_EXAMPLE/agent-config/agent-run.defaults.jsonc"
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
assert_contains "$TMP_DIR/help.out" "gemini"
assert_contains "$TMP_DIR/help.out" "grok"
node "$BIN" status >"$TMP_DIR/status.out"
assert_contains "$TMP_DIR/status.out" "Native agent capabilities"
assert_contains "$TMP_DIR/status.out" "Codex"
assert_contains "$TMP_DIR/status.out" "Gemini"
assert_contains "$TMP_DIR/status.out" "Grok"
node "$BIN" migrate-config --help >"$TMP_DIR/migrate-help.out"
assert_contains "$TMP_DIR/migrate-help.out" "migrate-config [--yes] [config-root]"

bash -n "$ROOT/scripts/update-ai-tools.sh"
bash -n "$ROOT/scripts/ensure-agent-brain.sh"
bash -n "$ROOT/scripts/agent-config-login-warning.sh"
bash -n "$ROOT/scripts/install-systemd-jobs.sh"
assert_file "$ROOT/ops/systemd/ai-tools-update.service"
assert_file "$ROOT/ops/systemd/ai-tools-update.timer"
assert_contains "$ROOT/ops/systemd/ai-tools-update.service" "ExecStart=/usr/local/libexec/agent-run/update-ai-tools"
assert_not_contains "$ROOT/ops/systemd/ai-tools-update.service" "/etc/environment"
assert_not_contains "$ROOT/ops/systemd/ai-tools-update.service" "/etc/npmrc"
assert_not_contains "$ROOT/ops/systemd/ai-tools-update.service" "rm -"
assert_contains "$ROOT/scripts/update-ai-tools.sh" 'install -g --force "${packages[@]}"'
assert_contains "$ROOT/scripts/update-ai-tools.sh" 'install -g --force pnpm@latest'
assert_contains "$ROOT/scripts/update-ai-tools.sh" 'NPM_BIN=/usr/local/bin/npm'
assert_contains "$ROOT/scripts/update-ai-tools.sh" 'NODE_BIN=/usr/local/bin/node'
assert_contains "$ROOT/scripts/update-ai-tools.sh" 'PNPM_BIN=/usr/local/bin/pnpm'
assert_contains "$ROOT/scripts/update-ai-tools.sh" 'global-dir /usr/local/share/pnpm/global'
assert_contains "$ROOT/scripts/update-ai-tools.sh" 'global-bin-dir /usr/local/bin'
assert_contains "$ROOT/scripts/update-ai-tools.sh" 'store-dir /usr/local/share/pnpm/store'
assert_not_contains "$ROOT/scripts/update-ai-tools.sh" 'clean_tool_bins'
assert_contains "$ROOT/scripts/update-ai-tools.sh" '@google/gemini-cli@latest'
assert_contains "$ROOT/scripts/update-ai-tools.sh" '@xai-official/grok@latest'
"$ROOT/scripts/install-systemd-jobs.sh" --dry-run --ai-tools >"$TMP_DIR/install-ai-tools.out"
assert_contains "$TMP_DIR/install-ai-tools.out" "ai-tools-update.timer"
assert_contains "$TMP_DIR/install-ai-tools.out" "ensure-agent-brain"
assert_contains "$TMP_DIR/install-ai-tools.out" "agent-brain.service"

CONFIG_SOURCE="$TMP_DIR/agent-config-source"
CONFIG_TARGET="$TMP_DIR/synced-agent-config"
mkdir -p "$CONFIG_SOURCE"
: >"$CONFIG_SOURCE/.agent-run-test-repo"
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
(cd "$PROJECT" && node "$BIN" --configdir="$SKELETON_INIT" setup starter/basic-project >"$TMP_DIR/setup.out")
assert_contains "$TMP_DIR/setup.out" "OK installed default config tree at $SKELETON_INIT"
assert_file "$SKELETON_INIT/.gitignore"
assert_file "$SKELETON_INIT/agent-run.defaults.jsonc"
assert_file "$SKELETON_INIT/global/agents/code.md.njk"
assert_file "$SKELETON_INIT/global/tool-templates/gemini-settings.json.njk"
assert_file "$SKELETON_INIT/global/tool-templates/grok-config.toml.njk"
assert_file "$SKELETON_INIT/global/tool-templates/AGENTS.md.njk"
assert_file "$SKELETON_INIT/global/skills/triage/SKILL.md.njk"
assert_no_file "$SKELETON_INIT/install-systemd-jobs.sh"
assert_no_file "$SKELETON_INIT/update-ai-tools.sh"
assert_no_file "$SKELETON_INIT/ai-tools-update.service"
assert_no_file "$SKELETON_INIT/ai-tools-update.timer"
assert_no_file "$SKELETON_INIT/ensure-agent-brain.sh"
assert_no_file "$SKELETON_INIT/agent-brain.service"
assert_file "$SKELETON_INIT/skills/personal-memory.md"
assert_file "$SKELETON_INIT/starter/basic-project/agent-run.jsonc"
assert_file "$SKELETON_INIT/starter/basic-project/overrides/codex-config.toml.njk"
assert_file "$SKELETON_INIT/starter/basic-project/notes/memory/README.md"
assert_contains "$SKELETON_INIT/skills/personal-memory.md" "Read \`./notes/memory/README.md\` first."
assert_contains "$SKELETON_INIT/.gitignore" "**/live/"

printf 'local edit\n' >"$SKELETON_INIT/starter/basic-project/local.md.njk"
(cd "$PROJECT" && node "$BIN" --configdir="$SKELETON_INIT" setup starter/basic-project >/dev/null)
assert_contains "$SKELETON_INIT/starter/basic-project/local.md.njk" "local edit"

PLAIN_MIGRATION_ROOT="$TMP_DIR/plain-memory-config"
PLAIN_MIGRATION_PROFILE="$PLAIN_MIGRATION_ROOT/acme/plain-memory"
mkdir -p "$PLAIN_MIGRATION_PROFILE/memory" "$PLAIN_MIGRATION_PROFILE/memories/codex-home"
printf '{}\n' >"$PLAIN_MIGRATION_PROFILE/agent-run.jsonc"
printf 'plain decision\n' >"$PLAIN_MIGRATION_PROFILE/memory/decisions.md"
printf 'old runtime\n' >"$PLAIN_MIGRATION_PROFILE/memories/codex-home/history.jsonl"
node "$BIN" migrate-config --yes "$PLAIN_MIGRATION_ROOT" >"$TMP_DIR/plain-migration.out"
assert_file "$PLAIN_MIGRATION_PROFILE/notes/memory/decisions.md"
assert_no_file "$PLAIN_MIGRATION_PROFILE/memory/decisions.md"
assert_file "$PLAIN_MIGRATION_PROFILE/live/memories/codex-home/history.jsonl"
assert_no_file "$PLAIN_MIGRATION_PROFILE/memories/codex-home/history.jsonl"
assert_contains "$TMP_DIR/plain-migration.out" "Moved memory files: 1"

GIT_MIGRATION_ROOT="$TMP_DIR/git-memory-config"
GIT_MIGRATION_PROFILE="$GIT_MIGRATION_ROOT/acme/git-memory"
GIT_MIGRATION_PROJECT="$TMP_DIR/git-memory-project"
mkdir -p "$GIT_MIGRATION_PROFILE/memory" "$GIT_MIGRATION_PROJECT"
printf '{}\n' >"$GIT_MIGRATION_PROFILE/agent-run.jsonc"
printf 'tracked decision\n' >"$GIT_MIGRATION_PROFILE/memory/decisions.md"
printf '{"name":"git-memory-project","private":true}\n' >"$GIT_MIGRATION_PROJECT/package.json"
printf 'AGENT_CONFIG_DIR=%s\nAGENT_RUN_PROFILE=acme/git-memory\n' "$GIT_MIGRATION_ROOT" >"$GIT_MIGRATION_PROJECT/.agent-run.env"
git -C "$TMP_DIR" init -b main "$GIT_MIGRATION_ROOT" >/dev/null
: >"$GIT_MIGRATION_ROOT/.agent-run-test-repo"
git -C "$GIT_MIGRATION_ROOT" config user.email test@example.com
git -C "$GIT_MIGRATION_ROOT" config user.name "Agent Run Memory Test"
git -C "$GIT_MIGRATION_ROOT" add acme/git-memory/agent-run.jsonc acme/git-memory/memory/decisions.md
git -C "$GIT_MIGRATION_ROOT" commit -m "Add old memory layout" >/dev/null
set +e
node "$BIN" check "$GIT_MIGRATION_PROJECT" >"$TMP_DIR/git-migration-check.out" 2>&1
git_migration_check_status=$?
set -e
[ "$git_migration_check_status" -ne 0 ] || fail "expected check to report the old memory layout"
assert_contains "$TMP_DIR/git-migration-check.out" "old profile layout needs migration"
set +e
node "$BIN" update "$GIT_MIGRATION_PROJECT" >"$TMP_DIR/git-migration-required.out" 2>&1
git_migration_required_status=$?
set -e
[ "$git_migration_required_status" -ne 0 ] || fail "expected a non-interactive tracked memory migration to stop"
assert_contains "$TMP_DIR/git-migration-required.out" "migrate-config --yes"
assert_file "$GIT_MIGRATION_PROFILE/memory/decisions.md"
node "$BIN" migrate-config --yes "$GIT_MIGRATION_ROOT" >"$TMP_DIR/git-migration.out"
git -C "$GIT_MIGRATION_ROOT" status --short >"$TMP_DIR/git-migration-status.out"
assert_contains "$TMP_DIR/git-migration.out" "Staged Git moves: 1"
assert_contains "$TMP_DIR/git-migration-status.out" "R  acme/git-memory/memory/decisions.md -> acme/git-memory/notes/memory/decisions.md"
assert_file "$GIT_MIGRATION_PROFILE/notes/memory/decisions.md"
assert_no_file "$GIT_MIGRATION_PROFILE/memory/decisions.md"
node "$BIN" update "$GIT_MIGRATION_PROJECT" >/dev/null
assert_file "$GIT_MIGRATION_PROFILE/notes/memory/README.md"

NO_GIT_MIGRATION_ROOT="$TMP_DIR/no-git-memory-config"
NO_GIT_MIGRATION_PROFILE="$NO_GIT_MIGRATION_ROOT/acme/no-git-memory"
mkdir -p "$NO_GIT_MIGRATION_PROFILE/memory" "$TMP_DIR/empty-bin"
printf '{}\n' >"$NO_GIT_MIGRATION_PROFILE/agent-run.jsonc"
printf 'tracked but git unavailable\n' >"$NO_GIT_MIGRATION_PROFILE/memory/decisions.md"
git -C "$TMP_DIR" init -b main "$NO_GIT_MIGRATION_ROOT" >/dev/null
: >"$NO_GIT_MIGRATION_ROOT/.agent-run-test-repo"
git -C "$NO_GIT_MIGRATION_ROOT" config user.email test@example.com
git -C "$NO_GIT_MIGRATION_ROOT" config user.name "Agent Run No Git Test"
git -C "$NO_GIT_MIGRATION_ROOT" add acme/no-git-memory/agent-run.jsonc acme/no-git-memory/memory/decisions.md
git -C "$NO_GIT_MIGRATION_ROOT" commit -m "Add old memory layout" >/dev/null
AGENT_RUN_REAL_PATH="$TMP_DIR/empty-bin" node "$BIN" migrate-config "$NO_GIT_MIGRATION_ROOT" >"$TMP_DIR/no-git-migration.out"
assert_file "$NO_GIT_MIGRATION_PROFILE/notes/memory/decisions.md"
assert_no_file "$NO_GIT_MIGRATION_PROFILE/memory/decisions.md"
assert_not_contains "$TMP_DIR/no-git-migration.out" "Staged Git moves"

DEFAULT_CODE_ROOT="$TMP_DIR/code"
DEFAULT_PROJECT="$DEFAULT_CODE_ROOT/acme/widget"
DEFAULT_HOME="$TMP_DIR/default-home"
DEFAULT_CONFIG_ROOT="$DEFAULT_HOME/.agent-run"
DEFAULT_AGENT_DIR="$DEFAULT_CONFIG_ROOT/acme/widget"
mkdir -p "$DEFAULT_PROJECT"
cat >"$DEFAULT_PROJECT/package.json" <<'JSON'
{
  "name": "@acme/widget",
  "private": true
}
JSON
HOME="$DEFAULT_HOME" USERPROFILE="$DEFAULT_HOME" node "$BIN" generate "$DEFAULT_PROJECT" >"$TMP_DIR/default-code-root-init.out"
assert_contains "$TMP_DIR/default-code-root-init.out" "OK profile acme/widget"
assert_file "$DEFAULT_CONFIG_ROOT/.gitignore"
assert_file "$DEFAULT_CONFIG_ROOT/agent-run.defaults.jsonc"
assert_no_file "$DEFAULT_CONFIG_ROOT/install-systemd-jobs.sh"
assert_no_file "$DEFAULT_CONFIG_ROOT/update-ai-tools.sh"
assert_no_file "$DEFAULT_CONFIG_ROOT/ai-tools-update.service"
assert_no_file "$DEFAULT_CONFIG_ROOT/ai-tools-update.timer"
assert_no_file "$DEFAULT_CONFIG_ROOT/ensure-agent-brain.sh"
assert_no_file "$DEFAULT_CONFIG_ROOT/agent-brain.service"
assert_file "$DEFAULT_AGENT_DIR/agent-run.jsonc"
assert_contains "$DEFAULT_AGENT_DIR/agent-run.jsonc" "{}"
assert_no_file "$DEFAULT_AGENT_DIR/local.md.njk"
assert_no_dir "$DEFAULT_AGENT_DIR/overrides"
assert_file "$DEFAULT_AGENT_DIR/live/memories/codex-home/AGENTS.md"
assert_file "$DEFAULT_AGENT_DIR/live/gemini/AGENTS.md"
assert_file "$DEFAULT_AGENT_DIR/live/grok/AGENTS.md"
assert_file "$DEFAULT_AGENT_DIR/notes/memory/README.md"
assert_no_dir "$DEFAULT_CODE_ROOT/agent-config"
rm "$DEFAULT_AGENT_DIR/live/memories/codex-home/AGENTS.md"
node "$BIN" update --all "$DEFAULT_CONFIG_ROOT" >"$TMP_DIR/default-code-root-update-all.out"
assert_contains "$TMP_DIR/default-code-root-update-all.out" "OK acme/widget"
assert_file "$DEFAULT_AGENT_DIR/live/memories/codex-home/AGENTS.md"

PLAIN_PROJECT="$DEFAULT_CODE_ROOT/plain-owner/plain-project"
PLAIN_AGENT_DIR="$DEFAULT_CONFIG_ROOT/plain-owner/plain-project"
mkdir -p "$PLAIN_PROJECT"
HOME="$DEFAULT_HOME" USERPROFILE="$DEFAULT_HOME" node "$BIN" generate "$PLAIN_PROJECT" >"$TMP_DIR/plain-project-init.out"
assert_contains "$TMP_DIR/plain-project-init.out" "OK profile plain-owner/plain-project"
assert_file "$PLAIN_AGENT_DIR/agent-run.jsonc"
assert_file "$PLAIN_AGENT_DIR/live/memories/codex-home/AGENTS.md"
assert_file "$PLAIN_AGENT_DIR/live/gemini/AGENTS.md"
assert_file "$PLAIN_AGENT_DIR/live/grok/AGENTS.md"

UNCONFIGURED_PROJECT="$DEFAULT_CODE_ROOT/acme/unconfigured"
UNCONFIGURED_AGENT_DIR="$DEFAULT_CONFIG_ROOT/acme/unconfigured"
mkdir -p "$UNCONFIGURED_PROJECT"
printf '{"name":"@acme/unconfigured","private":true}\n' >"$UNCONFIGURED_PROJECT/package.json"
set +e
HOME="$DEFAULT_HOME" USERPROFILE="$DEFAULT_HOME" node "$BIN" update "$UNCONFIGURED_PROJECT" >"$TMP_DIR/unconfigured-update.out" 2>&1
unconfigured_update_status=$?
set -e
[ "$unconfigured_update_status" -ne 0 ] || fail "expected update to reject an unconfigured profile"
assert_contains "$TMP_DIR/unconfigured-update.out" "run \`agent-run generate\`"
assert_no_dir "$UNCONFIGURED_AGENT_DIR"

CREATE_HOME="$TMP_DIR/create-home"
CREATE_CODE_ROOT="$TMP_DIR/create-code"
CREATE_PROJECT="$CREATE_CODE_ROOT/acme/created"
CREATE_AGENT_DIR="$CREATE_HOME/.agent-run/acme/created"
mkdir -p "$CREATE_PROJECT"
printf '{"name":"@acme/created","private":true}\n' >"$CREATE_PROJECT/package.json"
(cd "$CREATE_PROJECT" && HOME="$CREATE_HOME" USERPROFILE="$CREATE_HOME" node "$BIN" codex --create --generate >"$TMP_DIR/create-generate.out")
assert_contains "$TMP_DIR/create-generate.out" "OK profile acme/created"
assert_file "$CREATE_AGENT_DIR/agent-run.jsonc"
assert_no_file "$CREATE_AGENT_DIR/local.md.njk"
assert_no_dir "$CREATE_AGENT_DIR/overrides"

node "$BIN" update "$PROJECT" >"$TMP_DIR/update.out"
assert_contains "$TMP_DIR/update.out" "OK profile starter/basic-project"

CONFIG_MTIME_BEFORE="$(node -p "require('node:fs').statSync(process.argv[1]).mtimeMs" "$CODEX_CONFIG_FILE")"
node "$BIN" update "$PROJECT" >/dev/null
CONFIG_MTIME_AFTER="$(node -p "require('node:fs').statSync(process.argv[1]).mtimeMs" "$CODEX_CONFIG_FILE")"
[ "$CONFIG_MTIME_BEFORE" = "$CONFIG_MTIME_AFTER" ] || fail "unchanged generated config timestamp changed"

assert_file "$CODEX_AGENTS_FILE"
assert_file "$LIVE_DIR/CLAUDE.md"
assert_file "$LIVE_DIR/.claude/mcp.json"
assert_no_file "$LIVE_DIR/.claude/CLAUDE.md"
assert_file "$CODEX_CONFIG_FILE"
assert_contains "$CODEX_CONFIG_FILE" 'approval_policy = "on-request"'
assert_contains "$CODEX_CONFIG_FILE" 'sandbox_mode = "workspace-write"'
assert_no_file "$LIVE_DIR/AGENTS.md"
assert_no_file "$LIVE_DIR/config.toml"
assert_file "$LIVE_DIR/.claude/agent-run-settings.json"
assert_file "$LIVE_DIR/.claude/.claude-plugin/plugin.json"
assert_contains "$LIVE_DIR/.claude/.claude-plugin/plugin.json" '"name": "agent-run-profile"'
assert_contains "$LIVE_DIR/.claude/.claude-plugin/plugin.json" '"author": {'
assert_file "$CODEX_SKILLS_DIR/triage/SKILL.md"
assert_file "$LIVE_DIR/.claude/skills/triage/SKILL.md"
assert_file "$GEMINI_AGENTS_FILE"
assert_file "$GEMINI_SETTINGS_FILE"
assert_file "$GEMINI_SKILLS_DIR/triage/SKILL.md"
assert_file "$GROK_AGENTS_FILE"
assert_file "$GROK_CONFIG_FILE"
assert_file "$GROK_SKILLS_DIR/triage/SKILL.md"
cmp -s "$CODEX_AGENTS_FILE" "$GEMINI_AGENTS_FILE" || fail "expected Gemini to use canonical AGENTS.md content"
cmp -s "$CODEX_AGENTS_FILE" "$GROK_AGENTS_FILE" || fail "expected Grok to use canonical AGENTS.md content"
assert_contains "$CODEX_CONFIG_FILE" '[mcp_servers.example-stdio]'
assert_contains "$LIVE_DIR/.claude/mcp.json" '"example-stdio"'
assert_contains "$GEMINI_SETTINGS_FILE" '"example-stdio"'
assert_contains "$GROK_CONFIG_FILE" '[mcp_servers.example-stdio]'
assert_contains "$GEMINI_SETTINGS_FILE" '"fileName": ['
assert_contains "$GEMINI_SETTINGS_FILE" '"AGENTS.md"'
assert_dir "$AGENT_DIR/reviews"
assert_file "$AGENT_DIR/notes/memory/README.md"
assert_dir "$LIVE_DIR/memories"
assert_dir "$LIVE_DIR/memories/codex-home"
assert_dir "$AGENT_DIR/overrides"
assert_dir "$LIVE_DIR/bin"

TEST_HOME="$TMP_DIR/home"
mkdir -p "$TEST_HOME/.codex" "$TEST_HOME/.gemini/skills/personal" "$TEST_HOME/.grok"
printf '{"token":"shared"}\n' >"$TEST_HOME/.codex/auth.json"
printf '{"refresh_token":"shared"}\n' >"$TEST_HOME/.gemini/oauth_creds.json"
printf '%s\n' '{}' >"$TEST_HOME/.gemini/settings.json"
printf '%s\n' '{"token":"shared"}' >"$TEST_HOME/.grok/auth.json"
printf '%s\n' '---' 'name: personal' 'description: Personal test skill.' '---' >"$TEST_HOME/.gemini/skills/personal/SKILL.md"
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
assert_file "$GEMINI_HOME_DIR/.gemini/oauth_creds.json"
assert_file "$GEMINI_HOME_DIR/.gemini/settings.json"
assert_file "$GEMINI_HOME_DIR/.gemini/skills/personal/SKILL.md"
assert_file "$GROK_RUNTIME_DIR/auth.json"

rm "$CODEX_AGENTS_FILE"
mkdir -p "$EXAMPLE/agent-config/orphaned/acme/old-profile"
printf '{}\n' >"$EXAMPLE/agent-config/orphaned/acme/old-profile/agent-run.jsonc"
HOME="$TEST_HOME" USERPROFILE="$TEST_HOME" node "$BIN" update --all "$EXAMPLE/agent-config" >"$TMP_DIR/update-all.out"
assert_contains "$TMP_DIR/update-all.out" "OK starter/basic-project"
assert_contains "$TMP_DIR/update-all.out" "Updated profiles: 1"
assert_file "$CODEX_AGENTS_FILE"

node "$BIN" update "$PROJECT" >/dev/null

assert_contains "$CODEX_AGENTS_FILE" "Starter AGENTS for starter/basic-project"
assert_contains "$CODEX_AGENTS_FILE" "Starter Code Agent"
assert_contains "$CODEX_AGENTS_FILE" 'Use the project root at `'
assert_contains "$CODEX_AGENTS_FILE" 'Store durable notes in `'
assert_contains "$CODEX_AGENTS_FILE" "globalMemoryDir: \`$EXPECTED_MEMORY_DIR\`"
assert_contains "$CODEX_AGENTS_FILE" "projectMemoryDir: \`$EXPECTED_PROJECT_MEMORY_DIR\`"
assert_contains "$CODEX_AGENTS_FILE" "Project memory is stored in $EXPECTED_PROJECT_MEMORY_DIR"
assert_contains "$CODEX_AGENTS_FILE" "\`triage\`: Use this profile-specific triage workflow"
assert_contains "$CODEX_AGENTS_FILE" "profileDir: \`$EXPECTED_AGENT_DIR\`"
assert_contains "$CODEX_AGENTS_FILE" "reviewConsolidatedFile: \`$EXPECTED_REVIEW_FILE\`"
assert_contains "$LIVE_DIR/CLAUDE.md" "Starter CLAUDE for starter/basic-project"
assert_contains "$LIVE_DIR/CLAUDE.md" "globalMemoryDir: \`$EXPECTED_MEMORY_DIR\`"
assert_contains "$LIVE_DIR/CLAUDE.md" "projectMemoryDir: \`$EXPECTED_PROJECT_MEMORY_DIR\`"
assert_contains "$CODEX_CONFIG_FILE" "Starter profile Codex override"
assert_not_contains "$CODEX_CONFIG_FILE" "$EXPECTED_MEMORY_DIR"
assert_contains "$CODEX_CONFIG_FILE" "$EXPECTED_PROJECT_MEMORY_DIR"
assert_not_contains "$CODEX_CONFIG_FILE" "\"$EXPECTED_AGENT_DIR\","
assert_contains "$LIVE_DIR/.claude/agent-run-settings.json" '"STARTER_OVERRIDE": "true"'
assert_contains "$LIVE_DIR/.claude/agent-run-settings.json" '"AGENT_GLOBAL_MEMORY_DIR":'
assert_contains "$LIVE_DIR/.claude/agent-run-settings.json" "$EXPECTED_MEMORY_DIR"
assert_contains "$LIVE_DIR/.claude/agent-run-settings.json" '"AGENT_PROJECT_MEMORY_DIR":'
assert_contains "$LIVE_DIR/.claude/agent-run-settings.json" "$EXPECTED_PROJECT_MEMORY_DIR"
assert_contains "$LIVE_DIR/.claude/agent-run-settings.json" "\"AGENT_PROFILE_DIR\": \"$EXPECTED_AGENT_DIR\""
assert_contains "$LIVE_DIR/.claude/agent-run-settings.json" "Bash(pnpm test)"
assert_not_contains "$LIVE_DIR/.claude/agent-run-settings.json" "Bash(pnpm run cleanbuild)"
assert_not_contains "$LIVE_DIR/.claude/agent-run-settings.json" "Bash(git *)"
assert_not_contains "$LIVE_DIR/.claude/agent-run-settings.json" "Bash(npm *)"
assert_contains "$CODEX_SKILLS_DIR/triage/SKILL.md" "Starter Triage"
assert_contains "$CODEX_SKILLS_DIR/release-package-check/SKILL.md" "instead of an external \`repo-check\` command"
assert_contains "$CODEX_SKILLS_DIR/release-package-check/SKILL.md" "full commit SHA"
assert_contains "$CODEX_SKILLS_DIR/code-review-organizer/SKILL.md" "$EXPECTED_REVIEW_FILE"
assert_contains "$LIVE_DIR/.claude/skills/commit-workflow/SKILL.md" "Use when preparing commits"
assert_contains "$EXAMPLE/agent-config/.gitignore" "**/live/"

assert_tool_shim "$LIVE_DIR/bin/git"
assert_tool_shim "$LIVE_DIR/bin/npm"
assert_tool_shim "$LIVE_DIR/bin/pnpm"
assert_tool_shim "$LIVE_DIR/bin/gh"
if [ -f "$LIVE_DIR/bin/git.cmd" ]; then
	for tool in git gh npm pnpm; do
		assert_contains "$LIVE_DIR/bin/$tool.cmd" '"%AGENT_RUN_COMMAND%" %*'
		assert_contains "$LIVE_DIR/bin/$tool.cmd" "refused recursive $tool guard resolution"
	done
fi

mkdir -p "$EXAMPLE/agent-config/notes/memory"
FAKE_TOOL_BIN="$TMP_DIR/fake-tool-bin"
mkdir -p "$FAKE_TOOL_BIN"
cat >"$FAKE_TOOL_BIN/codex" <<'SH'
#!/usr/bin/env bash
printf '%s\n' "$@" >"$AGENT_RUN_ARG_CAPTURE"
if [ -n "${AGENT_RUN_ENV_CAPTURE:-}" ]; then
	printf 'CODEX_HOME=%s\nPWD=%s\nAGENT_RUN_REAL_PATH=%s\nPATH=%s\n' \
		"${CODEX_HOME-<unset>}" "$PWD" "${AGENT_RUN_REAL_PATH-<unset>}" "$PATH" >"$AGENT_RUN_ENV_CAPTURE"
	printf 'AGENT_PROJECT_MEMORY_DIR=%s\n' "${AGENT_PROJECT_MEMORY_DIR-<unset>}" >>"$AGENT_RUN_ENV_CAPTURE"
fi
if [ -n "${AGENT_RUN_NESTED_GUARD_CAPTURE:-}" ]; then
	git --version >"$AGENT_RUN_NESTED_GUARD_CAPTURE"
fi
SH
cat >"$FAKE_TOOL_BIN/claude" <<'SH'
#!/usr/bin/env bash
printf '%s\n' "$@" >"$AGENT_RUN_ARG_CAPTURE"
if [ -n "${AGENT_RUN_ENV_CAPTURE:-}" ]; then
	printf 'CLAUDE_CONFIG_DIR=%s\nPWD=%s\nAGENT_PROJECT_MEMORY_DIR=%s\n' \
		"${CLAUDE_CONFIG_DIR-<unset>}" "$PWD" "${AGENT_PROJECT_MEMORY_DIR-<unset>}" >"$AGENT_RUN_ENV_CAPTURE"
fi
if [ -n "${AGENT_RUN_CREATE_LOCAL_SETTINGS:-}" ]; then
	mkdir -p .claude
	printf '{"permissions":{"allow":["Bash(pnpm test)"]}}\n' >.claude/settings.local.json
fi
SH
cat >"$FAKE_TOOL_BIN/gemini" <<'SH'
#!/usr/bin/env bash
printf '%s\n' "$@" >"$AGENT_RUN_ARG_CAPTURE"
if [ -n "${AGENT_RUN_ENV_CAPTURE:-}" ]; then
	printf 'GEMINI_CLI_HOME=%s\nGEMINI_CLI_SYSTEM_SETTINGS_PATH=%s\nPWD=%s\nAGENT_PROJECT_MEMORY_DIR=%s\n' \
		"${GEMINI_CLI_HOME-<unset>}" "${GEMINI_CLI_SYSTEM_SETTINGS_PATH-<unset>}" "$PWD" \
		"${AGENT_PROJECT_MEMORY_DIR-<unset>}" >"$AGENT_RUN_ENV_CAPTURE"
fi
SH
cat >"$FAKE_TOOL_BIN/grok" <<'SH'
#!/usr/bin/env bash
printf '%s\n' "$@" >"$AGENT_RUN_ARG_CAPTURE"
if [ -n "${AGENT_RUN_ENV_CAPTURE:-}" ]; then
	printf 'GROK_HOME=%s\nPWD=%s\nAGENT_PROJECT_MEMORY_DIR=%s\n' \
		"${GROK_HOME-<unset>}" "$PWD" "${AGENT_PROJECT_MEMORY_DIR-<unset>}" >"$AGENT_RUN_ENV_CAPTURE"
fi
SH
chmod +x "$FAKE_TOOL_BIN/codex" "$FAKE_TOOL_BIN/claude" "$FAKE_TOOL_BIN/gemini" "$FAKE_TOOL_BIN/grok"
cat >"$FAKE_TOOL_BIN/codex.cmd" <<'BAT'
@echo off
bash "%~dp0codex" %*
BAT
cat >"$FAKE_TOOL_BIN/claude.cmd" <<'BAT'
@echo off
bash "%~dp0claude" %*
BAT
cat >"$FAKE_TOOL_BIN/gemini.cmd" <<'BAT'
@echo off
bash "%~dp0gemini" %*
BAT
cat >"$FAKE_TOOL_BIN/grok.cmd" <<'BAT'
@echo off
bash "%~dp0grok" %*
BAT

(cd "$PROJECT" && AGENT_RUN_ARG_CAPTURE="$TMP_DIR/codex-args.out" AGENT_RUN_ENV_CAPTURE="$TMP_DIR/codex-env.out" PATH="$FAKE_TOOL_BIN:$PATH" node "$BIN" codex --memory-check)
assert_contains "$TMP_DIR/codex-args.out" "-a"
assert_contains "$TMP_DIR/codex-args.out" "on-request"
assert_contains "$TMP_DIR/codex-args.out" "-s"
assert_contains "$TMP_DIR/codex-args.out" "workspace-write"
assert_contains "$TMP_DIR/codex-args.out" "-C"
assert_not_contains "$TMP_DIR/codex-args.out" "system_prompt_file"
assert_line_count "$TMP_DIR/codex-args.out" "--add-dir" 1
assert_contains "$TMP_DIR/codex-args.out" "$EXPECTED_PROJECT_MEMORY_DIR"
assert_not_contains "$TMP_DIR/codex-args.out" "$EXPECTED_MEMORY_DIR"
assert_contains "$TMP_DIR/codex-env.out" "CODEX_HOME=$EXPECTED_CODEX_HOME_DIR"
assert_contains "$TMP_DIR/codex-env.out" "AGENT_PROJECT_MEMORY_DIR=$EXPECTED_PROJECT_MEMORY_DIR"

if [ -x "$LIVE_DIR/bin/git" ]; then
	OUTER_GUARD_BIN="$TMP_DIR/outer-guard-bin"
	NESTED_REAL_BIN="$TMP_DIR/nested-real-bin"
	mkdir -p "$OUTER_GUARD_BIN" "$NESTED_REAL_BIN"
	cp "$LIVE_DIR/bin/git" "$OUTER_GUARD_BIN/git"
	cat >"$NESTED_REAL_BIN/git" <<'SH'
#!/usr/bin/env bash
printf 'nested real git %s\n' "$*"
SH
	chmod +x "$OUTER_GUARD_BIN/git" "$NESTED_REAL_BIN/git"
	NESTED_REAL_PATH="$FAKE_TOOL_BIN:$NESTED_REAL_BIN:/usr/local/bin:/usr/bin:/bin"
	(
		cd "$PROJECT"
		AGENT_RUN_ARG_CAPTURE="$TMP_DIR/nested-codex-args.out" \
			AGENT_RUN_ENV_CAPTURE="$TMP_DIR/nested-codex-env.out" \
			AGENT_RUN_NESTED_GUARD_CAPTURE="$TMP_DIR/nested-git.out" \
			AGENT_RUN_REAL_PATH="$NESTED_REAL_PATH" \
			PATH="$OUTER_GUARD_BIN:$NESTED_REAL_PATH" \
			node "$BIN" codex --memory-check
	)
	assert_contains "$TMP_DIR/nested-codex-env.out" "AGENT_RUN_REAL_PATH=$NESTED_REAL_PATH"
	assert_contains "$TMP_DIR/nested-codex-env.out" "PATH=$LIVE_DIR/bin:$NESTED_REAL_PATH"
	assert_contains "$TMP_DIR/nested-git.out" "nested real git --version"
fi

(cd "$PROJECT" && AGENT_RUN_ARG_CAPTURE="$TMP_DIR/codex-yolo-args.out" PATH="$FAKE_TOOL_BIN:$PATH" node "$BIN" codex --yolo --memory-check)
assert_contains "$TMP_DIR/codex-yolo-args.out" "never"
assert_contains "$TMP_DIR/codex-yolo-args.out" "danger-full-access"
assert_not_contains "$TMP_DIR/codex-yolo-args.out" "on-request"

(cd "$PROJECT" && AGENT_RUN_ARG_CAPTURE="$TMP_DIR/codex-network-args.out" PATH="$FAKE_TOOL_BIN:$PATH" node "$BIN" codex --network --memory-check)
assert_contains "$TMP_DIR/codex-network-args.out" "sandbox_workspace_write.network_access=true"

(cd "$PROJECT" && AGENT_RUN_ARG_CAPTURE="$TMP_DIR/codex-show-args.out" PATH="$FAKE_TOOL_BIN:$PATH" node "$BIN" codex --show >"$TMP_DIR/codex-show.out")
assert_no_file "$TMP_DIR/codex-show-args.out"
assert_contains "$TMP_DIR/codex-show.out" "Agent: codex"
assert_contains "$TMP_DIR/codex-show.out" "Reads/includes:"
assert_contains "$TMP_DIR/codex-show.out" "$EXPECTED_AGENT_CONFIG_FILE"
assert_contains "$TMP_DIR/codex-show.out" "$EXPECTED_ROOT_DEFAULTS_FILE"
assert_contains "$TMP_DIR/codex-show.out" "$EXPECTED_GLOBAL_SNIPPET"
assert_contains "$TMP_DIR/codex-show.out" "$EXPECTED_LOCAL_FILE"
assert_contains "$TMP_DIR/codex-show.out" "Generates:"
assert_contains "$TMP_DIR/codex-show.out" "$EXPECTED_CODEX_AGENTS_FILE"
assert_contains "$TMP_DIR/codex-show.out" "$EXPECTED_CODEX_CONFIG_FILE"
assert_contains "$TMP_DIR/codex-show.out" "$EXPECTED_CODEX_SKILLS_DIR${EXPECTED_PATH_SEP}commit-workflow${EXPECTED_PATH_SEP}SKILL.md"
assert_contains "$TMP_DIR/codex-show.out" "$EXPECTED_CODEX_SKILLS_DIR${EXPECTED_PATH_SEP}release-package-check${EXPECTED_PATH_SEP}SKILL.md"
assert_contains "$TMP_DIR/codex-show.out" "$EXPECTED_CODEX_SKILLS_DIR${EXPECTED_PATH_SEP}code-review-organizer${EXPECTED_PATH_SEP}SKILL.md"
assert_not_contains "$TMP_DIR/codex-show.out" "$EXPECTED_LIVE_DIR${EXPECTED_PATH_SEP}.claude${EXPECTED_PATH_SEP}agent-run-settings.json"
assert_not_contains "$TMP_DIR/codex-show.out" "$EXPECTED_LIVE_DIR${EXPECTED_PATH_SEP}.claude${EXPECTED_PATH_SEP}skills${EXPECTED_PATH_SEP}commit-workflow${EXPECTED_PATH_SEP}SKILL.md"

(cd "$PROJECT" && AGENT_RUN_ARG_CAPTURE="$TMP_DIR/codex-generate-args.out" PATH="$FAKE_TOOL_BIN:$PATH" node "$BIN" codex --generate >"$TMP_DIR/codex-generate.out")
assert_no_file "$TMP_DIR/codex-generate-args.out"
assert_contains "$TMP_DIR/codex-generate.out" "OK profile"
assert_contains "$TMP_DIR/codex-generate.out" "Generated files:"
assert_file "$CODEX_AGENTS_FILE"
assert_file "$LIVE_DIR/CLAUDE.md"

USER_CLAUDE_CONFIG="$TMP_DIR/user-claude-config"
mkdir -p "$USER_CLAUDE_CONFIG"
(cd "$PROJECT" && CLAUDE_CONFIG_DIR="$USER_CLAUDE_CONFIG" AGENT_RUN_ARG_CAPTURE="$TMP_DIR/claude-args.out" AGENT_RUN_ENV_CAPTURE="$TMP_DIR/claude-env.out" PATH="$FAKE_TOOL_BIN:$PATH" node "$BIN" claude --memory-check)
assert_contains "$TMP_DIR/claude-args.out" "--append-system-prompt-file"
assert_contains "$TMP_DIR/claude-args.out" "$EXPECTED_LIVE_DIR${EXPECTED_PATH_SEP}CLAUDE.md"
assert_contains "$TMP_DIR/claude-args.out" "--plugin-dir"
assert_contains "$TMP_DIR/claude-args.out" "$EXPECTED_LIVE_DIR${EXPECTED_PATH_SEP}.claude"
assert_contains "$TMP_DIR/claude-args.out" "--mcp-config"
assert_contains "$TMP_DIR/claude-args.out" "$EXPECTED_LIVE_DIR${EXPECTED_PATH_SEP}.claude${EXPECTED_PATH_SEP}mcp.json"
assert_line_count "$TMP_DIR/claude-args.out" "--add-dir" 1
assert_contains "$TMP_DIR/claude-args.out" "$EXPECTED_PROJECT_MEMORY_DIR"
assert_not_contains "$TMP_DIR/claude-args.out" "$EXPECTED_MEMORY_DIR"
assert_not_contains "$TMP_DIR/claude-args.out" "--dangerously-skip-permissions"
assert_contains "$TMP_DIR/claude-env.out" "CLAUDE_CONFIG_DIR=$USER_CLAUDE_CONFIG"
assert_contains "$TMP_DIR/claude-env.out" "AGENT_PROJECT_MEMORY_DIR=$EXPECTED_PROJECT_MEMORY_DIR"

(cd "$PROJECT" && AGENT_WRAPPER_FORCE_PERMISSIVE=1 AGENT_RUN_ARG_CAPTURE="$TMP_DIR/claude-legacy-permissions-args.out" PATH="$FAKE_TOOL_BIN:$PATH" node "$BIN" claude --memory-check)
assert_not_contains "$TMP_DIR/claude-legacy-permissions-args.out" "--permission-mode"
assert_not_contains "$TMP_DIR/claude-legacy-permissions-args.out" "bypassPermissions"
assert_not_contains "$TMP_DIR/claude-legacy-permissions-args.out" "--dangerously-skip-permissions"

(cd "$PROJECT" && AGENT_RUN_CREATE_LOCAL_SETTINGS=1 AGENT_RUN_ARG_CAPTURE="$TMP_DIR/claude-local-settings-args.out" PATH="$FAKE_TOOL_BIN:$PATH" node "$BIN" claude --memory-check >"$TMP_DIR/claude-local-settings.out" 2>&1)
assert_no_dir "$PROJECT/.claude"
assert_contains "$TMP_DIR/claude-local-settings.out" "removed Claude's project-local settings"

(cd "$PROJECT" && AGENT_RUN_ARG_CAPTURE="$TMP_DIR/claude-yolo-args.out" PATH="$FAKE_TOOL_BIN:$PATH" node "$BIN" claude --yolo --memory-check)
assert_contains "$TMP_DIR/claude-yolo-args.out" "--dangerously-skip-permissions"
assert_contains "$TMP_DIR/claude-yolo-args.out" "--append-system-prompt-file"

(cd "$PROJECT" && AGENT_RUN_ARG_CAPTURE="$TMP_DIR/claude-none-yolo-args.out" PATH="$FAKE_TOOL_BIN:$PATH" node "$BIN" claude --none --yolo --memory-check)
assert_contains "$TMP_DIR/claude-none-yolo-args.out" "--dangerously-skip-permissions"
assert_not_contains "$TMP_DIR/claude-none-yolo-args.out" "--append-system-prompt-file"

set +e
(cd "$PROJECT" && PATH="$FAKE_TOOL_BIN:$PATH" node "$BIN" claude --sandboxed >"$TMP_DIR/claude-sandboxed.out" 2>&1)
claude_sandboxed_status=$?
set -e
[ "$claude_sandboxed_status" -ne 0 ] || fail "expected claude --sandboxed to fail"
assert_contains "$TMP_DIR/claude-sandboxed.out" "--sandboxed is not supported for agent-run claude"

(cd "$PROJECT" && AGENT_RUN_ARG_CAPTURE="$TMP_DIR/claude-show-args.out" PATH="$FAKE_TOOL_BIN:$PATH" node "$BIN" claude --show >"$TMP_DIR/claude-show.out")
assert_no_file "$TMP_DIR/claude-show-args.out"
assert_contains "$TMP_DIR/claude-show.out" "Agent: claude"
assert_contains "$TMP_DIR/claude-show.out" "$EXPECTED_AGENT_CONFIG_FILE"
assert_contains "$TMP_DIR/claude-show.out" "$EXPECTED_LIVE_DIR${EXPECTED_PATH_SEP}CLAUDE.md"
assert_not_contains "$TMP_DIR/claude-show.out" "$EXPECTED_LIVE_DIR${EXPECTED_PATH_SEP}.claude${EXPECTED_PATH_SEP}CLAUDE.md"
assert_contains "$TMP_DIR/claude-show.out" "$EXPECTED_LIVE_DIR${EXPECTED_PATH_SEP}.claude${EXPECTED_PATH_SEP}agent-run-settings.json"
assert_contains "$TMP_DIR/claude-show.out" "$EXPECTED_LIVE_DIR${EXPECTED_PATH_SEP}.claude${EXPECTED_PATH_SEP}.claude-plugin${EXPECTED_PATH_SEP}plugin.json"
assert_contains "$TMP_DIR/claude-show.out" "$EXPECTED_LIVE_DIR${EXPECTED_PATH_SEP}.claude${EXPECTED_PATH_SEP}skills${EXPECTED_PATH_SEP}commit-workflow${EXPECTED_PATH_SEP}SKILL.md"
assert_contains "$TMP_DIR/claude-show.out" "$EXPECTED_LIVE_DIR${EXPECTED_PATH_SEP}.claude${EXPECTED_PATH_SEP}skills${EXPECTED_PATH_SEP}release-package-check${EXPECTED_PATH_SEP}SKILL.md"
assert_contains "$TMP_DIR/claude-show.out" "$EXPECTED_LIVE_DIR${EXPECTED_PATH_SEP}.claude${EXPECTED_PATH_SEP}skills${EXPECTED_PATH_SEP}code-review-organizer${EXPECTED_PATH_SEP}SKILL.md"
assert_not_contains "$TMP_DIR/claude-show.out" "$EXPECTED_CODEX_CONFIG_FILE"
assert_not_contains "$TMP_DIR/claude-show.out" "$EXPECTED_CODEX_SKILLS_DIR${EXPECTED_PATH_SEP}commit-workflow${EXPECTED_PATH_SEP}SKILL.md"

(cd "$PROJECT" && AGENT_RUN_ARG_CAPTURE="$TMP_DIR/gemini-args.out" AGENT_RUN_ENV_CAPTURE="$TMP_DIR/gemini-env.out" PATH="$FAKE_TOOL_BIN:$PATH" node "$BIN" gemini -p "fix the failing tests")
assert_contains "$TMP_DIR/gemini-args.out" "-p"
assert_contains "$TMP_DIR/gemini-args.out" "fix the failing tests"
assert_not_contains "$TMP_DIR/gemini-args.out" "--yolo"
assert_contains "$TMP_DIR/gemini-env.out" "GEMINI_CLI_HOME=$EXPECTED_GEMINI_HOME_DIR"
assert_contains "$TMP_DIR/gemini-env.out" "GEMINI_CLI_SYSTEM_SETTINGS_PATH=$EXPECTED_GEMINI_SETTINGS_FILE"
assert_contains "$TMP_DIR/gemini-env.out" "PWD=$EXPECTED_PROJECT"
assert_contains "$TMP_DIR/gemini-env.out" "AGENT_PROJECT_MEMORY_DIR=$EXPECTED_PROJECT_MEMORY_DIR"

(cd "$PROJECT" && AGENT_RUN_ARG_CAPTURE="$TMP_DIR/gemini-yolo-args.out" PATH="$FAKE_TOOL_BIN:$PATH" node "$BIN" gemini --yolo -p hello)
assert_contains "$TMP_DIR/gemini-yolo-args.out" "--yolo"
(cd "$PROJECT" && AGENT_RUN_ARG_CAPTURE="$TMP_DIR/gemini-sandbox-args.out" PATH="$FAKE_TOOL_BIN:$PATH" node "$BIN" gemini --sandboxed -p hello)
assert_contains "$TMP_DIR/gemini-sandbox-args.out" "--sandbox"

(cd "$PROJECT" && AGENT_RUN_ARG_CAPTURE="$TMP_DIR/gemini-show-args.out" PATH="$FAKE_TOOL_BIN:$PATH" node "$BIN" gemini --show >"$TMP_DIR/gemini-show.out")
assert_no_file "$TMP_DIR/gemini-show-args.out"
assert_contains "$TMP_DIR/gemini-show.out" "Agent: gemini"
assert_contains "$TMP_DIR/gemini-show.out" "$EXPECTED_GEMINI_AGENTS_FILE"
assert_contains "$TMP_DIR/gemini-show.out" "$EXPECTED_GEMINI_SETTINGS_FILE"
assert_contains "$TMP_DIR/gemini-show.out" "$EXPECTED_GEMINI_SKILLS_DIR${EXPECTED_PATH_SEP}commit-workflow${EXPECTED_PATH_SEP}SKILL.md"
assert_not_contains "$TMP_DIR/gemini-show.out" "$EXPECTED_CODEX_CONFIG_FILE"

(cd "$PROJECT" && AGENT_RUN_ARG_CAPTURE="$TMP_DIR/grok-args.out" AGENT_RUN_ENV_CAPTURE="$TMP_DIR/grok-env.out" PATH="$FAKE_TOOL_BIN:$PATH" node "$BIN" grok -p "fix the failing tests")
assert_contains "$TMP_DIR/grok-args.out" "-p"
assert_contains "$TMP_DIR/grok-args.out" "fix the failing tests"
assert_not_contains "$TMP_DIR/grok-args.out" "--always-approve"
assert_contains "$TMP_DIR/grok-env.out" "GROK_HOME=$EXPECTED_GROK_RUNTIME_DIR"
assert_contains "$TMP_DIR/grok-env.out" "PWD=$EXPECTED_PROJECT"
assert_contains "$TMP_DIR/grok-env.out" "AGENT_PROJECT_MEMORY_DIR=$EXPECTED_PROJECT_MEMORY_DIR"

(cd "$PROJECT" && AGENT_RUN_ARG_CAPTURE="$TMP_DIR/grok-yolo-args.out" PATH="$FAKE_TOOL_BIN:$PATH" node "$BIN" grok --yolo -p hello)
assert_contains "$TMP_DIR/grok-yolo-args.out" "--always-approve"
(cd "$PROJECT" && AGENT_RUN_ARG_CAPTURE="$TMP_DIR/grok-sandbox-args.out" PATH="$FAKE_TOOL_BIN:$PATH" node "$BIN" grok --sandboxed -p hello)
assert_contains "$TMP_DIR/grok-sandbox-args.out" "--sandbox"
assert_contains "$TMP_DIR/grok-sandbox-args.out" "workspace"

(cd "$PROJECT" && AGENT_RUN_ARG_CAPTURE="$TMP_DIR/grok-show-args.out" PATH="$FAKE_TOOL_BIN:$PATH" node "$BIN" grok --show >"$TMP_DIR/grok-show.out")
assert_no_file "$TMP_DIR/grok-show-args.out"
assert_contains "$TMP_DIR/grok-show.out" "Agent: grok"
assert_contains "$TMP_DIR/grok-show.out" "$EXPECTED_GROK_AGENTS_FILE"
assert_contains "$TMP_DIR/grok-show.out" "$EXPECTED_GROK_CONFIG_FILE"
assert_contains "$TMP_DIR/grok-show.out" "$EXPECTED_GROK_SKILLS_DIR${EXPECTED_PATH_SEP}commit-workflow${EXPECTED_PATH_SEP}SKILL.md"
assert_not_contains "$TMP_DIR/grok-show.out" "$EXPECTED_CODEX_CONFIG_FILE"

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
run_tool_shim "$LIVE_DIR/bin/git" -C "$PROJECT" push >"$TMP_DIR/git.out" 2>&1
git_status=$?
run_tool_shim "$LIVE_DIR/bin/pnpm" --filter fixture publish >"$TMP_DIR/pnpm.out" 2>&1
pnpm_status=$?
run_tool_shim "$LIVE_DIR/bin/gh" --repo example/project release create v0.0.0 >"$TMP_DIR/gh.out" 2>&1
gh_status=$?
set -e
[ "$git_status" -eq 42 ] || fail "expected git push shim to exit 42, got $git_status"
[ "$pnpm_status" -eq 42 ] || fail "expected pnpm publish shim to exit 42, got $pnpm_status"
[ "$gh_status" -eq 42 ] || fail "expected gh release shim to exit 42, got $gh_status"
assert_contains "$TMP_DIR/git.out" "blocked git push"
assert_contains "$TMP_DIR/pnpm.out" "blocked pnpm publish"
assert_contains "$TMP_DIR/gh.out" "blocked gh release create"

GUARD_TEST_REPO="$TMP_DIR/guard-test-repo"
mkdir -p "$GUARD_TEST_REPO"
: >"$GUARD_TEST_REPO/.agent-run-test-repo"
run_tool_shim "$LIVE_DIR/bin/git" -C "$GUARD_TEST_REPO" init -b main >/dev/null
run_tool_shim "$LIVE_DIR/bin/git" -C "$GUARD_TEST_REPO" config user.email test@example.com
run_tool_shim "$LIVE_DIR/bin/git" -C "$GUARD_TEST_REPO" config user.name "Agent Run Test"
run_tool_shim "$LIVE_DIR/bin/git" -C "$GUARD_TEST_REPO" config commit.gpgsign false
run_tool_shim "$LIVE_DIR/bin/git" -C "$GUARD_TEST_REPO" config core.hooksPath "$TMP_DIR/no-hooks"
set +e
run_tool_shim "$LIVE_DIR/bin/git" -C "$GUARD_TEST_REPO" commit --allow-empty -m "Test repository commit" >"$TMP_DIR/git-test-repo.out" 2>&1
test_repo_commit_status=$?
run_tool_shim "$LIVE_DIR/bin/git" -C "$GUARD_TEST_REPO" tag v0.0.0 >"$TMP_DIR/git-test-repo-tag.out" 2>&1
test_repo_tag_status=$?
run_tool_shim "$LIVE_DIR/bin/git" -C "$TMP_DIR" commit --allow-empty -m "Outside a test repository" >"$TMP_DIR/git-unmarked.out" 2>&1
unmarked_commit_status=$?
set -e
[ "$test_repo_commit_status" -eq 0 ] || fail "expected a commit in a marked test repository to run, got $test_repo_commit_status"
[ "$test_repo_tag_status" -eq 0 ] || fail "expected a tag in a marked test repository to run, got $test_repo_tag_status"
[ "$unmarked_commit_status" -eq 42 ] || fail "expected a commit outside a marked test repository to stay blocked, got $unmarked_commit_status"
assert_contains "$TMP_DIR/git-unmarked.out" "blocked git commit"

if [ -x "$LIVE_DIR/bin/pnpm" ]; then
	FAKE_REAL_GUARD_BIN="$TMP_DIR/fake-real-guard-bin"
	mkdir -p "$FAKE_REAL_GUARD_BIN"
	for tool in git npm pnpm gh; do
		cat >"$FAKE_REAL_GUARD_BIN/$tool" <<'SH'
#!/usr/bin/env bash
printf 'real %s\n' "$(basename "$0") $*"
SH
		chmod +x "$FAKE_REAL_GUARD_BIN/$tool"
	done
	AGENT_RUN_REAL_PATH="$FAKE_REAL_GUARD_BIN:/usr/bin:/bin" \
		PATH="$LIVE_DIR/bin:$FAKE_REAL_GUARD_BIN:/usr/bin:/bin" \
		run_tool_shim "$LIVE_DIR/bin/pnpm" --version >"$TMP_DIR/pnpm-pass.out"
	assert_contains "$TMP_DIR/pnpm-pass.out" "real pnpm --version"
	for word in commit tag push; do
		AGENT_RUN_REAL_PATH="$FAKE_REAL_GUARD_BIN:/usr/bin:/bin" run_tool_shim "$LIVE_DIR/bin/git" log --grep "$word" >"$TMP_DIR/git-keyword.out"
		assert_contains "$TMP_DIR/git-keyword.out" "real git log --grep $word"
		AGENT_RUN_REAL_PATH="$FAKE_REAL_GUARD_BIN:/usr/bin:/bin" run_tool_shim "$LIVE_DIR/bin/git" -C "$word" -c "test.value=$word" log -- "$word" >"$TMP_DIR/git-option-value.out"
		assert_contains "$TMP_DIR/git-option-value.out" "real git -C $word -c test.value=$word log -- $word"
		AGENT_RUN_REAL_PATH="$FAKE_REAL_GUARD_BIN:/usr/bin:/bin" run_tool_shim "$LIVE_DIR/bin/git" --git-dir "$word" status >"$TMP_DIR/git-directory-value.out"
		assert_contains "$TMP_DIR/git-directory-value.out" "real git --git-dir $word status"
		set +e
		AGENT_RUN_REAL_PATH="$FAKE_REAL_GUARD_BIN:/usr/bin:/bin" run_tool_shim "$LIVE_DIR/bin/git" -C / -c test.value=push --no-pager "$word" >"$TMP_DIR/git-leading-options.out" 2>&1
		guard_status=$?
		set -e
		[ "$guard_status" -eq 42 ] || fail "expected git $word after leading options to stay blocked, got $guard_status"
	done
fi

MANIFEST_BACKUP="$TMP_DIR/basic-project-manifest.jsonc"
cp "$AGENT_DIR/agent-run.jsonc" "$MANIFEST_BACKUP"
node - "$AGENT_DIR/agent-run.jsonc" <<'NODE'
const fs = require('node:fs');
const file = process.argv[2];
const manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
manifest.tools ??= {};
manifest.tools.codex = false;
fs.writeFileSync(file, `${JSON.stringify(manifest, null, 2)}\n`);
NODE
node "$BIN" update "$PROJECT" >/dev/null
assert_no_file "$CODEX_AGENTS_FILE"
assert_no_file "$CODEX_CONFIG_FILE"
assert_no_file "$CODEX_SKILLS_DIR/triage/SKILL.md"
assert_file "$LIVE_DIR/CLAUDE.md"
set +e
(cd "$PROJECT" && node "$BIN" codex --show >"$TMP_DIR/codex-disabled.out" 2>&1)
codex_disabled_status=$?
set -e
[ "$codex_disabled_status" -ne 0 ] || fail "expected disabled Codex profile command to fail"
assert_contains "$TMP_DIR/codex-disabled.out" "codex is disabled for agent-run profile"

node - "$AGENT_DIR/agent-run.jsonc" <<'NODE'
const fs = require('node:fs');
const file = process.argv[2];
const manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
manifest.tools ??= {};
manifest.tools.codex = true;
manifest.tools.claude = false;
fs.writeFileSync(file, `${JSON.stringify(manifest, null, 2)}\n`);
NODE
node "$BIN" update "$PROJECT" >/dev/null
assert_file "$CODEX_AGENTS_FILE"
assert_no_file "$LIVE_DIR/CLAUDE.md"
assert_no_file "$LIVE_DIR/.claude/agent-run-settings.json"
assert_no_file "$LIVE_DIR/.claude/mcp.json"
assert_no_file "$LIVE_DIR/.claude/.claude-plugin/plugin.json"
assert_no_file "$LIVE_DIR/.claude/skills/triage/SKILL.md"
set +e
(cd "$PROJECT" && node "$BIN" claude --show >"$TMP_DIR/claude-disabled.out" 2>&1)
claude_disabled_status=$?
set -e
[ "$claude_disabled_status" -ne 0 ] || fail "expected disabled Claude profile command to fail"
assert_contains "$TMP_DIR/claude-disabled.out" "claude is disabled for agent-run profile"

node - "$AGENT_DIR/agent-run.jsonc" <<'NODE'
const fs = require('node:fs');
const file = process.argv[2];
const manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
manifest.tools.gemini = false;
manifest.tools.grok = false;
fs.writeFileSync(file, `${JSON.stringify(manifest, null, 2)}\n`);
NODE
node "$BIN" update "$PROJECT" >/dev/null
assert_no_file "$GEMINI_AGENTS_FILE"
assert_no_file "$GEMINI_SETTINGS_FILE"
assert_no_file "$GEMINI_SKILLS_DIR/triage/SKILL.md"
assert_no_file "$GROK_AGENTS_FILE"
assert_no_file "$GROK_CONFIG_FILE"
assert_no_file "$GROK_SKILLS_DIR/triage/SKILL.md"
set +e
(cd "$PROJECT" && node "$BIN" gemini --show >"$TMP_DIR/gemini-disabled.out" 2>&1)
gemini_disabled_status=$?
(cd "$PROJECT" && node "$BIN" grok --show >"$TMP_DIR/grok-disabled.out" 2>&1)
grok_disabled_status=$?
set -e
[ "$gemini_disabled_status" -ne 0 ] || fail "expected disabled Gemini profile command to fail"
[ "$grok_disabled_status" -ne 0 ] || fail "expected disabled Grok profile command to fail"
assert_contains "$TMP_DIR/gemini-disabled.out" "gemini is disabled for agent-run profile"
assert_contains "$TMP_DIR/grok-disabled.out" "grok is disabled for agent-run profile"

cp "$MANIFEST_BACKUP" "$AGENT_DIR/agent-run.jsonc"
node "$BIN" update "$PROJECT" >/dev/null
node - "$AGENT_DIR/agent-run.jsonc" <<'NODE'
const fs = require('node:fs');
const file = process.argv[2];
const manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
manifest.guardrails ??= {};
manifest.guardrails.blockGitWrite = false;
manifest.guardrails.blockPublish = false;
manifest.guardrails.blockGithubRelease = false;
fs.writeFileSync(file, `${JSON.stringify(manifest, null, 2)}\n`);
NODE
node "$BIN" update "$PROJECT" >/dev/null
for shim in git git.cmd npm npm.cmd pnpm pnpm.cmd gh gh.cmd; do
	assert_no_file "$LIVE_DIR/bin/$shim"
done
cp "$MANIFEST_BACKUP" "$AGENT_DIR/agent-run.jsonc"
node "$BIN" update "$PROJECT" >/dev/null

mkdir -p "$CODEX_SKILLS_DIR/removed-skill" "$CODEX_SKILLS_DIR/.system" "$LIVE_DIR/.claude/skills/removed-skill"
printf 'stale\n' >"$CODEX_SKILLS_DIR/removed-skill/SKILL.md"
printf 'preserve\n' >"$CODEX_SKILLS_DIR/.system/marker"
printf 'stale\n' >"$LIVE_DIR/.claude/skills/removed-skill/SKILL.md"
node "$BIN" update "$PROJECT" >/dev/null
assert_no_dir "$CODEX_SKILLS_DIR/removed-skill"
assert_no_dir "$LIVE_DIR/.claude/skills/removed-skill"
assert_file "$CODEX_SKILLS_DIR/.system/marker"

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

node - "$AGENT_DIR/agent-run.jsonc" <<'NODE'
const fs = require('node:fs');
const file = process.argv[2];
const manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
manifest.skills.install.push('../../outside-profile');
fs.writeFileSync(file, `${JSON.stringify(manifest, null, 2)}\n`);
NODE
set +e
node "$BIN" update "$PROJECT" >"$TMP_DIR/invalid-skill.out" 2>&1
invalid_skill_status=$?
set -e
[ "$invalid_skill_status" -ne 0 ] || fail "expected an invalid skill name to fail"
assert_contains "$TMP_DIR/invalid-skill.out" "invalid skill name"
cp "$MANIFEST_BACKUP" "$AGENT_DIR/agent-run.jsonc"
node "$BIN" update "$PROJECT" >/dev/null

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

EMPTY_SCAN_ROOT="$TMP_DIR/empty-scan"
mkdir -p "$EMPTY_SCAN_ROOT"
set +e
node "$BIN" check --all "$EMPTY_SCAN_ROOT" >"$TMP_DIR/empty-scan.out" 2>&1
empty_scan_status=$?
set -e
[ "$empty_scan_status" -ne 0 ] || fail "expected an empty source-tree scan to fail"
assert_contains "$TMP_DIR/empty-scan.out" "ERROR no source repos found"

DEEP_SCAN_ROOT="$TMP_DIR/deep-scan"
DEEP_SCAN_REPO="$DEEP_SCAN_ROOT/one/two/three/four/five/repo"
IGNORED_SCAN_REPO="$DEEP_SCAN_ROOT/ignored-repo"
mkdir -p "$DEEP_SCAN_REPO"
git -C "$DEEP_SCAN_REPO" init -b main >/dev/null
printf 'unconfigured local agent file\n' >"$DEEP_SCAN_REPO/AGENTS.md"
git -C "$DEEP_SCAN_ROOT" init -b main "$IGNORED_SCAN_REPO" >/dev/null
printf 'ignored test repository\n' >"$IGNORED_SCAN_REPO/.agent-run-ignore"
set +e
node "$BIN" check --all "$DEEP_SCAN_ROOT" >"$TMP_DIR/deep-scan.out" 2>&1
deep_scan_status=$?
set -e
[ "$deep_scan_status" -ne 0 ] || fail "expected the unconfigured deep repository scan to fail"
assert_contains "$TMP_DIR/deep-scan.out" "$DEEP_SCAN_REPO"
assert_contains "$TMP_DIR/deep-scan.out" "local AI file in project"
assert_not_contains "$TMP_DIR/deep-scan.out" "$IGNORED_SCAN_REPO"

printf '\nstale\n' >>"$CODEX_AGENTS_FILE"
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

node - "$AGENT_DIR/agent-run.jsonc" <<'NODE'
const fs = require('node:fs');
const file = process.argv[2];
const manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
manifest.guardrails ??= {};
manifest.guardrails.forbidRepoAiFiles = false;
fs.writeFileSync(file, `${JSON.stringify(manifest, null, 2)}\n`);
NODE
node "$BIN" update "$PROJECT" >/dev/null
node "$BIN" check "$PROJECT" >"$TMP_DIR/local-ai-allowed-check.out"
(cd "$PROJECT" && AGENT_RUN_ARG_CAPTURE="$TMP_DIR/local-manifest-allowed-args.out" PATH="$FAKE_TOOL_BIN:$PATH" node "$BIN" codex --sandboxed)
assert_file "$TMP_DIR/local-manifest-allowed-args.out"
cp "$MANIFEST_BACKUP" "$AGENT_DIR/agent-run.jsonc"
node "$BIN" update "$PROJECT" >/dev/null

(cd "$PROJECT" && AGENT_RUN_ARG_CAPTURE="$TMP_DIR/local-run-allowed-args.out" PATH="$FAKE_TOOL_BIN:$PATH" node "$BIN" codex --local --sandboxed >"$TMP_DIR/local-run-allowed.out" 2>&1)
assert_contains "$TMP_DIR/local-run-allowed.out" "WARNING: local AI files found"
assert_file "$TMP_DIR/local-run-allowed-args.out"
rm "$PROJECT/AGENTS.md"

node "$BIN" check "$PROJECT" >/dev/null

printf '{}\n' >"$PROJECT/.mcp.json"
mkdir "$PROJECT/.claude" "$PROJECT/.gemini" "$PROJECT/.grok"
printf 'local Gemini instructions\n' >"$PROJECT/GEMINI.md"
printf 'symlink target\n' >"$PROJECT/local-instructions-target"
linked_local_instructions=false
if ln -s local-instructions-target "$PROJECT/CLAUDE.local.md" 2>/dev/null; then
	linked_local_instructions=true
fi
set +e
node "$BIN" check "$PROJECT" >"$TMP_DIR/current-local-ai.out" 2>&1
current_local_ai_status=$?
set -e
[ "$current_local_ai_status" -ne 0 ] || fail "expected current local AI config names to fail checks"
assert_contains "$TMP_DIR/current-local-ai.out" ".mcp.json"
assert_contains "$TMP_DIR/current-local-ai.out" ".claude"
assert_contains "$TMP_DIR/current-local-ai.out" ".gemini"
assert_contains "$TMP_DIR/current-local-ai.out" ".grok"
assert_contains "$TMP_DIR/current-local-ai.out" "GEMINI.md"
if [ "$linked_local_instructions" = true ]; then
	assert_contains "$TMP_DIR/current-local-ai.out" "CLAUDE.local.md"
	rm "$PROJECT/CLAUDE.local.md"
fi
rm "$PROJECT/.mcp.json" "$PROJECT/GEMINI.md" "$PROJECT/local-instructions-target"
rmdir "$PROJECT/.claude" "$PROJECT/.gemini" "$PROJECT/.grok"

WORKSPACE_ROOT="$TMP_DIR/workspace-without-package"
WORKSPACE_CHILD="$WORKSPACE_ROOT/packages/widget"
mkdir -p "$WORKSPACE_CHILD"
printf 'packages:\n  - packages/*\n' >"$WORKSPACE_ROOT/pnpm-workspace.yaml"
printf '{"name":"widget","private":true}\n' >"$WORKSPACE_CHILD/package.json"

WORKTREE_SOURCE="$TMP_DIR/worktree-source"
WORKTREE_CHECKOUT="$TMP_DIR/worktree-checkout"
git -C "$TMP_DIR" init -b main "$WORKTREE_SOURCE" >/dev/null
: >"$WORKTREE_SOURCE/.agent-run-test-repo"
git -C "$WORKTREE_SOURCE" config user.email test@example.com
git -C "$WORKTREE_SOURCE" config user.name "Agent Run Worktree Test"
git -C "$WORKTREE_SOURCE" remote add origin https://github.com/example/worktree-profile.git
printf 'worktree fixture\n' >"$WORKTREE_SOURCE/README.md"
git -C "$WORKTREE_SOURCE" add README.md
git -C "$WORKTREE_SOURCE" commit -m "Initial worktree fixture" >/dev/null
git -C "$WORKTREE_SOURCE" worktree add -b test-worktree "$WORKTREE_CHECKOUT" >/dev/null
mkdir -p "$WORKTREE_CHECKOUT/nested/path"

LEGACY_CONFIG_ROOT="$TMP_DIR/legacy-parser-config"
LEGACY_PROJECT="$TMP_DIR/legacy-parser-project"
LEGACY_PROFILE_DIR="$LEGACY_CONFIG_ROOT/starter/legacy-parser"
cp -R "$EXAMPLE/agent-config" "$LEGACY_CONFIG_ROOT"
mkdir -p "$LEGACY_PROJECT" "$LEGACY_PROFILE_DIR"
cat >"$LEGACY_PROJECT/package.json" <<'JSON'
{"name":"legacy-parser-project","private":true}
JSON
cat >"$LEGACY_PROJECT/.agent-run.env" <<ENV
AGENT_CONFIG_DIR=$LEGACY_CONFIG_ROOT
AGENT_RUN_PROFILE=starter/legacy-parser
ENV
cat >"$LEGACY_PROFILE_DIR/agent-run.jsonc" <<'JSON'
{
  "profile": "starter/legacy-parser",
  "kind": "code",
  "agent": {
    "base": "global/agents/code.md.njk",
    "includes": ["{{ profile }}/AGENTS-MODS.md"]
  },
  "skills": { "install": [] },
  "tools": { "codex": true, "claude": true }
}
JSON
cat >"$LEGACY_PROFILE_DIR/AGENTS-MODS.md" <<'MARKDOWN'
# Legacy parser fixture

```text
@missing-fenced-include.md
```

    @missing-indented-include.md
MARKDOWN
node "$BIN" update "$LEGACY_PROJECT" >/dev/null
assert_contains "$LEGACY_PROFILE_DIR/live/memories/codex-home/AGENTS.md" "@missing-fenced-include.md"
assert_contains "$LEGACY_PROFILE_DIR/live/memories/codex-home/AGENTS.md" "@missing-indented-include.md"

if command -v cygpath >/dev/null 2>&1; then
	QUOTED_CONFIG_ROOT="$TMP_DIR/config with spaces"
	QUOTED_PROJECT="$TMP_DIR/project with spaces"
else
	QUOTED_CONFIG_ROOT="$TMP_DIR/config-\"quoted"
	QUOTED_PROJECT="$TMP_DIR/project-\"quoted"
fi
cp -R "$EXAMPLE/agent-config" "$QUOTED_CONFIG_ROOT"
mkdir -p "$QUOTED_PROJECT"
printf '{"name":"quoted-project","private":true}\n' >"$QUOTED_PROJECT/package.json"
cat >"$QUOTED_PROJECT/.agent-run.env" <<ENV
AGENT_CONFIG_DIR=$QUOTED_CONFIG_ROOT
AGENT_RUN_PROFILE=starter/basic-project
ENV
node "$BIN" update "$QUOTED_PROJECT" >/dev/null
QUOTED_SETTINGS="$QUOTED_CONFIG_ROOT/starter/basic-project/live/.claude/agent-run-settings.json"
QUOTED_CODEX_CONFIG="$QUOTED_CONFIG_ROOT/starter/basic-project/live/memories/codex-home/config.toml"
EXPECTED_QUOTED_PROJECT="$QUOTED_PROJECT" node - "$QUOTED_SETTINGS" "$QUOTED_CODEX_CONFIG" <<'NODE'
const fs = require('node:fs');
const settings = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
if (settings.env.AGENT_RUN_PROJECT_ROOT !== process.env.EXPECTED_QUOTED_PROJECT) {
	throw new Error('Claude settings did not preserve the quoted project path');
}
const config = fs.readFileSync(process.argv[3], 'utf8');
if (!config.includes(JSON.stringify(process.env.EXPECTED_QUOTED_PROJECT))) {
	throw new Error('Codex config did not safely quote the project path');
}
NODE

EDITOR_PROJECT="$TMP_DIR/editor-project"
FAKE_EDITOR="$TMP_DIR/editor app"
mkdir -p "$EDITOR_PROJECT"
cat >"$EDITOR_PROJECT/package.json" <<'JSON'
{"name":"editor-project","private":true}
JSON
cat >"$EDITOR_PROJECT/.agent-run.env" <<'ENV'
AGENT_CONFIG_DIR=../editor-config
AGENT_RUN_PROFILE=starter/editor-project
ENV
cat >"$FAKE_EDITOR" <<'SH'
#!/usr/bin/env bash
printf '%s\n' "$@" >"$AGENT_RUN_EDITOR_CAPTURE"
SH
chmod +x "$FAKE_EDITOR"
(cd "$EDITOR_PROJECT" && VISUAL="\"$FAKE_EDITOR\" --wait; touch $EDITOR_PROJECT/EDITOR_PWNED" AGENT_RUN_EDITOR_CAPTURE="$TMP_DIR/editor-args.out" node "$BIN" edit)
assert_no_file "$EDITOR_PROJECT/EDITOR_PWNED"
assert_contains "$TMP_DIR/editor-args.out" "--wait"
assert_contains "$TMP_DIR/editor-args.out" "touch"

TEST_WORKSPACE_CHILD="$WORKSPACE_CHILD" \
TEST_WORKSPACE_ROOT="$WORKSPACE_ROOT" \
TEST_WORKTREE_CHILD="$WORKTREE_CHECKOUT/nested/path" \
TEST_WORKTREE_ROOT="$WORKTREE_CHECKOUT" \
HOME="$DEFAULT_HOME" USERPROFILE="$DEFAULT_HOME" \
node --input-type=module <<'EOF'
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
	defaultConfigRoot,
	findProjectRoot,
	parseEditorCommand,
	parseInvocation,
	resolveProfile
} from './dist/agent-run.js';

assert.deepEqual(parseEditorCommand('"/tmp/editor app" --wait "two words"'), [
	'/tmp/editor app',
	'--wait',
	'two words'
]);
assert.deepEqual(parseEditorCommand('editor --wait; touch marker'), ['editor', '--wait;', 'touch', 'marker']);
assert.throws(() => parseEditorCommand('editor "unterminated'));

assert.deepEqual(parseInvocation('agent-run', ['codex', '--', '--danger']), {
	args: ['--', '--danger'],
	command: 'codex',
	wrapperArgs: {
		none: false,
		create: false,
		local: false,
		show: false,
		generate: false,
		sandboxMode: null,
		codexNetwork: false
	}
});

assert.equal(findProjectRoot(process.env.TEST_WORKSPACE_CHILD), process.env.TEST_WORKSPACE_ROOT);
assert.equal(findProjectRoot(process.env.TEST_WORKTREE_CHILD), process.env.TEST_WORKTREE_ROOT);
assert.equal(resolveProfile(process.env.TEST_WORKTREE_ROOT), 'example/worktree-profile');
assert.equal(resolveProfile(path.join('/work', 'plain-owner', 'plain-project')), 'plain-owner/plain-project');

const packageProfileRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-run-package-profile-'));
fs.writeFileSync(
	path.join(packageProfileRoot, 'package.json'),
	JSON.stringify({ name: '@package-owner/package-project', repository: 'github:repo-owner/repo-project' })
);
assert.equal(resolveProfile(packageProfileRoot), 'repo-owner/repo-project');
fs.rmSync(packageProfileRoot, { recursive: true, force: true });

assert.deepEqual(
	parseInvocation('agent-run', ['codex', '--sandboxed', '--network', 'hello']),
	parseInvocation('agent-run', ['--sandboxed', '--network', 'codex', 'hello'])
);

assert.equal(parseInvocation('agent-run', ['claude', '--yolo']).wrapperArgs.sandboxMode, 'danger');
assert.equal(parseInvocation('agent-run', ['codex', '--yolo']).wrapperArgs.sandboxMode, 'danger');
assert.equal(parseInvocation('agent-run', ['gemini', '--yolo']).wrapperArgs.sandboxMode, 'danger');
assert.equal(parseInvocation('agent-run', ['grok', '--sandboxed']).wrapperArgs.sandboxMode, 'sandboxed');
assert.deepEqual(parseInvocation('agent-run', ['claude', '--yolo', 'hello']).args, ['hello']);
assert.deepEqual(parseInvocation('agent-run', ['gemini', '-p', 'hello']).args, ['-p', 'hello']);
assert.deepEqual(parseInvocation('agent-run', ['grok', '-p', 'hello']).args, ['-p', 'hello']);
assert.deepEqual(parseInvocation('agent-run', ['status']), { command: 'status' });

assert.deepEqual(parseInvocation('agent-run', ['--create', 'claude', 'hello']), {
	args: ['hello'],
	command: 'claude',
	wrapperArgs: {
		none: false,
		create: true,
		local: false,
		show: false,
		generate: false,
		sandboxMode: null,
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
assert.deepEqual(parseInvocation('agent-run', ['setup', 'myorg/myrepo']), {
	command: 'setup',
	profile: 'myorg/myrepo'
});
assert.deepEqual(parseInvocation('agent-run', ['generate', '/tmp/project']), {
	command: 'generate',
	targetPath: path.resolve('/tmp/project')
});
assert.equal(defaultConfigRoot(), path.join(process.env.HOME, '.agent-run'));
EOF

node --test "$ROOT/scripts/test-brain.cjs" "$ROOT/scripts/test-windows-guards.cjs"

echo "All tests passed"
