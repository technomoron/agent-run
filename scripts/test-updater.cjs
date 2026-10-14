const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test } = require('node:test');

test('timer cleanup selects normal users and invokes retention cleanup with a clean environment', { skip: process.platform === 'win32' }, (t) => {
	const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-cleanup-helper-'));
	t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
	const log = path.join(directory, 'calls');
	const quote = value => `'${value.replaceAll("'", "'\\''")}'`;
	function executable(name, body) {
		const file = path.join(directory, name);
		fs.writeFileSync(file, `#!/bin/bash\nset -eu\n${body}\n`, {mode: 0o755});
		return quote(file);
	}
	const id = executable('id', 'echo "${CLEANUP_TEST_UID:-0}"');
	const getent = executable('getent', `case "$2" in
bjorn) echo 'bjorn:x:1000:1000::/home/bjorn:/bin/bash' ;;
other) echo 'other:x:1001:1001::/home/other:/bin/bash' ;;
root) echo 'root:x:0:0::/root:/bin/bash' ;;
*) exit 2 ;;
esac`);
	const runuser = executable('runuser', `printf '%s\\n' "$*" >> "$CLEANUP_TEST_LOG"
if [ "$2" = "\${CLEANUP_TEST_FAIL_USER:-}" ]; then exit 1; fi`);
	const source = fs.readFileSync(path.join(__dirname, 'cleanup-agent-sessions.sh'), 'utf8')
		.replace('$(id -u)', `$(${id} -u)`)
		.replace('getent passwd', `${getent} passwd`)
		.replace('runuser -u', `${runuser} -u`);
	const script = path.join(directory, 'cleanup'); fs.writeFileSync(script, source);
	function run(overrides = {}) {
		fs.writeFileSync(log, '');
		const env = { ...process.env, CLEANUP_TEST_LOG: log, AI_TOOLS_BRAIN_USERS: 'bjorn', ...overrides };
		if (!Object.hasOwn(overrides, 'AI_TOOLS_CLEANUP_USERS')) delete env.AI_TOOLS_CLEANUP_USERS;
		return spawnSync('bash', [script], {env, encoding: 'utf8'});
	}
	assert.equal(run().status, 0);
	let calls = fs.readFileSync(log, 'utf8');
	assert.match(calls, /-u bjorn -- env -i HOME=\/home\/bjorn USER=bjorn LOGNAME=bjorn/);
	assert.match(calls, /cd "\$HOME" && exec "\$@"/);
	assert.match(calls, /--configdir \/home\/bjorn\/\.agent-run --clean-old all/);
	assert.doesNotMatch(calls, /--clean all/);
	assert.equal(run({AI_TOOLS_CLEANUP_USERS: ''}).status, 0);
	assert.equal(fs.readFileSync(log, 'utf8'), '');
	assert.equal(run({AI_TOOLS_CLEANUP_USERS: 'bjorn other', CLEANUP_TEST_FAIL_USER: 'bjorn'}).status, 1);
	assert.match(fs.readFileSync(log, 'utf8'), /-u other/);
	const refused = run({AI_TOOLS_CLEANUP_USERS: 'root unknown'});
	assert.equal(refused.status, 1); assert.match(refused.stderr, /system account/); assert.match(refused.stderr, /Unknown cleanup account/);
	assert.equal(fs.readFileSync(log, 'utf8'), '');
	assert.equal(run({CLEANUP_TEST_UID: '1000'}).status, 1);
	assert.equal(fs.readFileSync(log, 'utf8'), '');
	const service = fs.readFileSync(path.join(__dirname, '../ops/systemd/ai-tools-update.service'), 'utf8');
	assert.match(service, /ExecStartPost=\/usr\/local\/libexec\/agent-run\/cleanup-agent-sessions/);
});

test('updater configures pnpm under sudo and limits install hooks', { skip: process.platform === 'win32' }, (t) => {
	const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-updater-'));
	t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
	const log = path.join(directory, 'calls');
	const quote = (value) => `'${value.replaceAll("'", "'\\''")}'`;
	function executable(name, script) {
		const file = path.join(directory, name);
		fs.writeFileSync(file, `#!/bin/bash\nset -eu\n${script}\n`, { mode: 0o755 });
		return quote(file);
	}
	const npm = executable('npm', `
case "$*" in
  'prefix -g') echo /usr/local ;;
  'root -g') echo /usr/local/lib/node_modules ;;
  *) printf 'npm sudo=%s %s\\n' "\${SUDO_USER-unset}" "$*" >> "$UPDATER_TEST_LOG" ;;
esac`);
	const pnpm = executable('pnpm', `
if [ "\${SUDO_USER+x}" = x ]; then
  echo ERR_PNPM_SUDO_NOT_SUPPORTED >&2
  exit 1
fi
printf 'pnpm %s\\n' "$*" >> "$UPDATER_TEST_LOG"`);
	const node = executable('node', 'exit 0');
	const install = executable('install', 'exit 0');
	const id = executable('id', 'echo "$UPDATER_TEST_UID"');
	executable('ensure-agent-brain', 'printf "brain %s\\n" "$*" >> "$UPDATER_TEST_LOG"');
	// Replace system executables in a private copy; never install packages or
	// write global configuration while exercising the updater's control flow.
	const source = fs.readFileSync(path.join(__dirname, 'update-ai-tools.sh'), 'utf8')
		.replace('NPM_BIN=/usr/local/bin/npm', `NPM_BIN=${npm}`)
		.replace('NODE_BIN=/usr/local/bin/node', `NODE_BIN=${node}`)
		.replace('PNPM_BIN=/usr/local/bin/pnpm', `PNPM_BIN=${pnpm}`)
		.replace('APT_GET_BIN=/usr/bin/apt-get', `APT_GET_BIN=${quote(path.join(directory, 'no-apt'))}`)
		.replace('$(id -u)', `$(${id} -u)`)
		.replace('\ninstall -d ', `\n${install} -d `);
	const script = path.join(directory, 'update-ai-tools');
	fs.writeFileSync(script, source);
	function run(args = [], uid = '0') {
		fs.writeFileSync(log, '');
		return spawnSync('bash', [script, ...args], { encoding: 'utf8', env: {
			...process.env, SUDO_USER: 'bjorn', UPDATER_TEST_UID: uid,
			UPDATER_TEST_LOG: log, AI_TOOLS_BRAIN_USERS: 'bjorn', AI_TOOLS_AGENT_RUN_PACKAGE: '@technomoron/agent-run@latest'
		} });
	}
	const result = run();
	assert.equal(result.status, 0, result.stderr);
	const calls = fs.readFileSync(log, 'utf8');
	assert.match(calls, /npm sudo=bjorn install -g --force .*--allow-scripts=@anthropic-ai\/claude-code,@xai-official\/grok,esbuild/);
	assert.match(calls, /pnpm@latest --allow-scripts=pnpm/);
	assert.doesNotMatch(calls, /dangerously-allow-all-scripts|allow-scripts=[^\n]*(?:keytar|node-pty)/);
	assert.equal(calls.split('\n').filter((line) => line.startsWith('pnpm ')).length, 3);
	for (const setting of ['global-dir /usr/local/share/pnpm/global', 'global-bin-dir /usr/local/bin', 'store-dir /usr/local/share/pnpm/store']) {
		assert.ok(calls.includes(`pnpm config set --global ${setting}`));
	}
	assert.match(calls, /brain bjorn/);
	assert.equal(run(['--agent-brain']).status, 0);
	const brainOnly = fs.readFileSync(log, 'utf8');
	assert.match(brainOnly, /npm sudo=bjorn install -g --force @technomoron\/agent-run@latest/);
	assert.match(brainOnly, /brain bjorn/);
	assert.doesNotMatch(brainOnly, /^pnpm /m);
	const nonRoot = run([], '1000');
	assert.notEqual(nonRoot.status, 0);
	assert.match(nonRoot.stderr, /must run as root/);
	assert.equal(fs.readFileSync(log, 'utf8'), '');
});
