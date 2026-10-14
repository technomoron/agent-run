const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { DatabaseSync } = require('node:sqlite');
const { spawnSync } = require('node:child_process');
const { cleanSessions } = require('../dist/runtime/clean-sessions');
const { parseInvocation } = require('../dist/cli');

const oldId = '11111111-1111-4111-8111-111111111111';
const newId = '22222222-2222-4222-8222-222222222222';
const week = 7 * 86400000;
function setup(t) {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), 'session-cleanup-'));
	const before = { ...process.env };
	const home = path.join(root, 'home');
	const config = path.join(root, 'config');
	fs.mkdirSync(home); fs.mkdirSync(config);
	Object.assign(process.env, { HOME: home, USERPROFILE: home, CODEX_HOME: path.join(home, '.codex'), CLAUDE_CONFIG_DIR: path.join(home, '.claude'), GEMINI_CLI_HOME: home, GROK_HOME: path.join(home, '.grok') });
	delete process.env.CODEX_THREAD_ID; delete process.env.CODEX_SESSION_ID;
	t.after(() => { for (const key of Object.keys(process.env)) if (!(key in before)) delete process.env[key]; Object.assign(process.env, before); fs.rmSync(root, { recursive: true, force: true }); });
	const now = Date.now();
	function write(relative, content = '{}', age = week + 1000) {
		const file = path.join(home, relative);
		fs.mkdirSync(path.dirname(file), { recursive: true });
		fs.writeFileSync(file, content);
		fs.utimesSync(file, new Date(now - age), new Date(now - age));
		return file;
	}
	return { root, home, config, now, write };
}

test('--clean accepts all, comma and space selections and rejects invalid selections before touching sessions', (t) => {
	const env = setup(t);
	assert.deepEqual(parseInvocation('agent-run', ['--clean', 'all']), { command: 'clean', agents: ['codex', 'claude', 'gemini', 'grok'] });
	assert.deepEqual(parseInvocation('agent-run', ['--clean=claude,gemini', 'claude']), { command: 'clean', agents: ['claude', 'gemini'] });
	for (const args of [['--clean'], ['--clean', 'all,codex'], ['--clean', 'unknown'], ['codex', '--clean', 'all']]) {
		const result = spawnSync(process.execPath, [path.resolve(__dirname, '../dist/agent-run.js'), ...args], { encoding: 'utf8' });
		assert.equal(result.status, 1, result.stdout);
		assert.match(result.stderr, /--clean/);
	}
});

test('retention uses last modification, keeps the seven-day boundary and removes Claude companion data and index entries', (t) => {
	const env = setup(t);
	const transcript = env.write(`.claude/projects/project/${oldId}.jsonl`);
	const snapshot = env.write(`.claude/file-history/${oldId}/snapshot`);
	const recent = env.write(`.claude/projects/project/${newId}.jsonl`, '{}', week);
	const history = env.write('.claude/history.jsonl', `${JSON.stringify({sessionId: oldId})}\n${JSON.stringify({sessionId: newId})}\ninvalid preserved\n`);
	const index = env.write('.claude/projects/project/sessions-index.json', JSON.stringify({ version: 1, entries: [{sessionId: oldId}, {sessionId: newId}] }));
	const auth = env.write('.claude/auth.json');
	const result = cleanSessions(env.config, ['claude'], false, env.now);
	assert.equal(result[0].removed, 1); assert.deepEqual(result[0].errors, []);
	assert.ok(!fs.existsSync(transcript)); assert.ok(!fs.existsSync(snapshot));
	assert.ok(fs.existsSync(recent)); assert.ok(fs.existsSync(auth));
	assert.equal(fs.readFileSync(history, 'utf8'), `${JSON.stringify({sessionId: newId})}\ninvalid preserved\n`);
	assert.deepEqual(JSON.parse(fs.readFileSync(index)).entries, [{sessionId: newId}]);
});

test('all removes recent Gemini chats across profiles without removing configuration, memory or unselected agents', (t) => {
	const env = setup(t);
	const chat = env.write('.gemini/tmp/project/chats/session-new.json', '{}', 0);
	const claude = env.write(`.claude/projects/project/${oldId}.jsonl`);
	const settings = env.write('.gemini/settings.json');
	const memory = env.write('.gemini/GEMINI.md');
	const profile = path.join(env.config, 'projects', 'test');
	fs.mkdirSync(profile, {recursive: true}); fs.writeFileSync(path.join(profile, 'agent-run.jsonc'), '{}');
	const privateChat = path.join(profile, 'live/gemini/home/.gemini/tmp/project/chats/session.json');
	fs.mkdirSync(path.dirname(privateChat), {recursive: true}); fs.writeFileSync(privateChat, '{}');
	const result = cleanSessions(env.config, ['gemini'], true);
	assert.equal(result[0].removed, 2); assert.deepEqual(result[0].errors, []);
	for (const file of [chat, privateChat]) assert.ok(!fs.existsSync(file));
	for (const file of [settings, memory, claude]) assert.ok(fs.existsSync(file));
});

test('cleanup does not follow session directory symlinks', { skip: process.platform === 'win32' }, (t) => {
	const env = setup(t);
	const outside = env.write('outside/session.json');
	const dir = path.join(env.home, '.gemini/tmp/project');
	fs.mkdirSync(dir, {recursive: true}); fs.symlinkSync(path.dirname(outside), path.join(dir, 'chats'));
	assert.equal(cleanSessions(env.config, ['gemini'], true)[0].removed, 0);
	assert.ok(fs.existsSync(outside));
});

test('Codex SQLite-only sessions and Grok directory sessions use native deletion and report missing executables', (t) => {
	const env = setup(t);
	const bin = path.join(env.root, 'bin'); fs.mkdirSync(bin);
	process.env.AGENT_RUN_REAL_PATH = bin;
	const codexHome = path.join(env.home, '.codex'); fs.mkdirSync(codexHome);
	const db = new DatabaseSync(path.join(codexHome, 'state_5.sqlite'));
	db.exec('CREATE TABLE threads (id TEXT PRIMARY KEY, updated_at INTEGER)');
	db.prepare('INSERT INTO threads VALUES (?, ?)').run(oldId, Math.floor((env.now - week - 1000) / 1000)); db.close();
	const grok = env.write(`.grok/sessions/project/${oldId}/chat_history.jsonl`);
	// Folder timestamps also contribute to activity; age them alongside their contents.
	fs.utimesSync(path.dirname(grok), new Date(env.now - week - 1000), new Date(env.now - week - 1000));
	const result = cleanSessions(env.config, ['codex', 'grok'], false, env.now);
	assert.equal(result[0].removed, 0); assert.match(result[0].errors.join('\n'), /no .* binary found in PATH/);
	assert.equal(result[1].removed, 0); assert.match(result[1].errors.join('\n'), /no .* binary found in PATH/);
	assert.ok(fs.existsSync(grok));
});

test('native deletion removes Codex database history and Grok logs with isolated homes and argv IDs', (t) => {
	const env = setup(t);
	const bin = path.join(env.root, 'bin'); fs.mkdirSync(bin);
	const log = path.join(env.root, 'deleted.jsonl');
	process.env.AGENT_RUN_REAL_PATH = bin;
	const script = path.join(bin, 'delete.cjs');
	fs.writeFileSync(script, `
const fs = require('node:fs');
const path = require('node:path');
const {DatabaseSync} = require('node:sqlite');
const agent = process.argv[2];
const args = process.argv.slice(3);
const id = args.at(-1);
fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify({agent,args})+'\\n');
if (agent === 'codex') {
  if (args[0] !== 'delete' || args[1] !== '--force' || args.length !== 3) throw new Error('Codex deletion requires --force without a terminal');
  const db = new DatabaseSync(path.join(process.env.CODEX_HOME, 'state_5.sqlite'));
  db.prepare('DELETE FROM threads WHERE id = ?').run(id); db.close();
} else {
  fs.rmSync(path.join(process.env.GROK_HOME, 'sessions/project', id), {recursive:true});
}
`);
	for (const agent of ['codex', 'grok']) {
		if (process.platform === 'win32') {
			fs.writeFileSync(path.join(bin, agent + '.cmd'), `@echo off\r\n"${process.execPath}" "${script}" ${agent} %*\r\n`);
		} else {
			fs.writeFileSync(path.join(bin, agent), `#!/bin/sh\nexec '${process.execPath.replaceAll("'", "'\\''")}' '${script.replaceAll("'", "'\\''")}' ${agent} "$@"\n`, {mode:0o755});
		}
	}
	const codexHome = path.join(env.home, '.codex'); fs.mkdirSync(codexHome);
	const db = new DatabaseSync(path.join(codexHome, 'state_5.sqlite'));
	db.exec('CREATE TABLE threads (id TEXT PRIMARY KEY, updated_at INTEGER)');
	db.prepare('INSERT INTO threads VALUES (?, ?)').run(oldId, Math.floor((env.now - week - 1000) / 1000)); db.close();
	const grok = env.write(`.grok/sessions/project/${oldId}/chat_history.jsonl`);
	fs.utimesSync(path.dirname(grok), new Date(env.now-week-1000), new Date(env.now-week-1000));
	const result = cleanSessions(env.config, ['codex', 'grok'], false, env.now);
	assert.deepEqual(result.map(x=>({removed:x.removed,errors:x.errors})), [{removed:1,errors:[]},{removed:1,errors:[]}]);
	assert.ok(!fs.existsSync(grok));
	assert.deepEqual(fs.readFileSync(log, 'utf8').trim().split('\n').map(JSON.parse), [{agent:'codex',args:['delete','--force',oldId]},{agent:'grok',args:['sessions','delete',oldId]}]);
	const check = new DatabaseSync(path.join(codexHome, 'state_5.sqlite'), {readOnly:true});
	assert.equal(check.prepare('SELECT COUNT(*) AS count FROM threads').get().count,0); check.close();
});
