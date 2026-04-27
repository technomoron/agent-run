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

assert_dir() {
	[ -d "$1" ] || fail "missing directory: $1"
}

assert_contains() {
	local file="$1"
	local expected="$2"
	grep -Fq -- "$expected" "$file" || fail "expected '$expected' in $file"
}

assert_executable() {
	[ -x "$1" ] || fail "expected executable: $1"
}

EXAMPLE="$TMP_DIR/basic-config"
cp -R "$ROOT/examples/basic-config" "$EXAMPLE"

PROJECT="$EXAMPLE/project"
AGENT_DIR="$EXAMPLE/agent-config/starter/basic-project"
BIN="$ROOT/dist/agent-run.js"

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
PATH="$FAKE_GUARD_BIN:$FAKE_REAL_BIN:$PATH" node "$BIN" codex --none --version >"$TMP_DIR/codex-version.out"
assert_contains "$TMP_DIR/codex-version.out" "codex-cli fake"

SKELETON_INIT="$TMP_DIR/copied-agent-config"
node "$BIN" --init "$SKELETON_INIT" >"$TMP_DIR/init-config.out"
assert_contains "$TMP_DIR/init-config.out" "OK copied starter config to $SKELETON_INIT"
assert_file "$SKELETON_INIT/.gitignore"
assert_file "$SKELETON_INIT/global/agents/code.md.njk"
assert_file "$SKELETON_INIT/global/tool-templates/AGENTS.md.njk"
assert_file "$SKELETON_INIT/global/skills/triage/SKILL.md.njk"
assert_file "$SKELETON_INIT/skills/personal-memory.md"
assert_file "$SKELETON_INIT/starter/basic-project/agent-run.jsonc"
assert_file "$SKELETON_INIT/starter/basic-project/overrides/codex-config.toml.njk"
assert_contains "$SKELETON_INIT/skills/personal-memory.md" "Read \`./notes/memory/README.md\` first."

printf 'local edit\n' >"$SKELETON_INIT/starter/basic-project/local.md.njk"
node "$BIN" --init "$SKELETON_INIT" >/dev/null
assert_contains "$SKELETON_INIT/starter/basic-project/local.md.njk" "local edit"

node "$BIN" update "$PROJECT" >"$TMP_DIR/update.out"
assert_contains "$TMP_DIR/update.out" "OK profile starter/basic-project"

assert_file "$AGENT_DIR/AGENTS.md"
assert_file "$AGENT_DIR/CLAUDE.md"
assert_file "$AGENT_DIR/.claude/CLAUDE.md"
assert_file "$AGENT_DIR/config.toml"
assert_file "$AGENT_DIR/.claude/settings.json"
assert_file "$AGENT_DIR/.agents/skills/triage/SKILL.md"
assert_file "$AGENT_DIR/.claude/skills/triage/SKILL.md"
assert_dir "$AGENT_DIR/reviews"
assert_dir "$AGENT_DIR/memories"
assert_dir "$AGENT_DIR/memories/codex-home"
assert_dir "$AGENT_DIR/overrides"
assert_dir "$AGENT_DIR/bin"

assert_contains "$AGENT_DIR/AGENTS.md" "Starter AGENTS for starter/basic-project"
assert_contains "$AGENT_DIR/AGENTS.md" "Starter Code Agent"
assert_contains "$AGENT_DIR/AGENTS.md" 'Use the project root at `'
assert_contains "$AGENT_DIR/AGENTS.md" 'Store durable notes in `'
assert_contains "$AGENT_DIR/AGENTS.md" "globalMemoryDir: \`$EXAMPLE/agent-config/notes/memory\`"
assert_contains "$AGENT_DIR/AGENTS.md" '`triage`: Use this profile-specific triage workflow'
assert_contains "$AGENT_DIR/CLAUDE.md" "Starter CLAUDE for starter/basic-project"
assert_contains "$AGENT_DIR/CLAUDE.md" "globalMemoryDir: \`$EXAMPLE/agent-config/notes/memory\`"
assert_contains "$AGENT_DIR/config.toml" "Starter profile Codex override"
assert_contains "$AGENT_DIR/config.toml" "$EXAMPLE/agent-config/notes/memory"
assert_contains "$AGENT_DIR/.claude/settings.json" '"STARTER_OVERRIDE": "true"'
assert_contains "$AGENT_DIR/.claude/settings.json" '"AGENT_GLOBAL_MEMORY_DIR":'
assert_contains "$AGENT_DIR/.claude/settings.json" "$EXAMPLE/agent-config/notes/memory"
assert_contains "$AGENT_DIR/.agents/skills/triage/SKILL.md" "Starter Triage"
assert_contains "$AGENT_DIR/.claude/skills/commit-workflow/SKILL.md" "Use when preparing commits"
assert_contains "$EXAMPLE/agent-config/.gitignore" "**/AGENTS.md"

assert_executable "$AGENT_DIR/bin/git"
assert_executable "$AGENT_DIR/bin/npm"
assert_executable "$AGENT_DIR/bin/pnpm"
assert_executable "$AGENT_DIR/bin/gh"

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

(cd "$PROJECT" && AGENT_RUN_ARG_CAPTURE="$TMP_DIR/codex-args.out" PATH="$FAKE_TOOL_BIN:$PATH" node "$BIN" codex --sandboxed --memory-check)
assert_contains "$TMP_DIR/codex-args.out" "--add-dir"
assert_contains "$TMP_DIR/codex-args.out" "$EXAMPLE/agent-config/notes/memory"
assert_contains "$TMP_DIR/codex-args.out" "-C"

(cd "$PROJECT" && AGENT_RUN_ARG_CAPTURE="$TMP_DIR/claude-args.out" PATH="$FAKE_TOOL_BIN:$PATH" node "$BIN" claude --memory-check)
assert_contains "$TMP_DIR/claude-args.out" "--add-dir"
assert_contains "$TMP_DIR/claude-args.out" "$EXAMPLE/agent-config/notes/memory"
assert_contains "$TMP_DIR/claude-args.out" "$AGENT_DIR"

set +e
"$AGENT_DIR/bin/git" commit >"$TMP_DIR/git.out" 2>&1
git_status=$?
"$AGENT_DIR/bin/pnpm" publish >"$TMP_DIR/pnpm.out" 2>&1
pnpm_status=$?
"$AGENT_DIR/bin/gh" release create v0.0.0 >"$TMP_DIR/gh.out" 2>&1
gh_status=$?
set -e
[ "$git_status" -eq 42 ] || fail "expected git commit shim to exit 42, got $git_status"
[ "$pnpm_status" -eq 42 ] || fail "expected pnpm publish shim to exit 42, got $pnpm_status"
[ "$gh_status" -eq 42 ] || fail "expected gh release shim to exit 42, got $gh_status"
assert_contains "$TMP_DIR/git.out" "blocked git commit"
assert_contains "$TMP_DIR/pnpm.out" "blocked pnpm publish"
assert_contains "$TMP_DIR/gh.out" "blocked gh release create"

node "$BIN" check "$PROJECT" >"$TMP_DIR/check.out"
assert_contains "$TMP_DIR/check.out" "OK no issues found"

node "$BIN" check --all "$PROJECT" >"$TMP_DIR/check-all.out"
assert_contains "$TMP_DIR/check-all.out" "OK $PROJECT"
assert_contains "$TMP_DIR/check-all.out" "Summary: 0 error(s), 0 warning(s)"

printf '\nstale\n' >>"$AGENT_DIR/AGENTS.md"
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
rm "$PROJECT/AGENTS.md"

node "$BIN" check "$PROJECT" >/dev/null

node --input-type=module <<'EOF'
import assert from 'node:assert/strict';
import { parseInvocation } from './dist/agent-run.js';

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
		codexSandboxMode: null,
		codexNetwork: false
	}
});

assert.equal(parseInvocation('agent-run', ['--all', 'check', '.']).command, 'check');
assert.deepEqual(parseInvocation('agent-run', ['--init', '/tmp/agent-config']), {
	command: 'init-config',
	targetPath: '/tmp/agent-config'
});
EOF

echo "All tests passed"
