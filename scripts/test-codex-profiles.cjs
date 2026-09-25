const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { sync: spawnSync } = require('cross-spawn');
const { spawn } = require('node:child_process');
const { parse } = require('smol-toml');
const { codexAdapter } = require('../dist/agents/codex');
const { defaultManifest } = require('../dist/defaults');
const { normalizeManifest } = require('../dist/manifest');
const { buildRenderContext, createNunjucksEnv } = require('../dist/templates');
const { syncRenderedProfile } = require('../dist/renderer');
const { codexSharedHome, codexProfileName, migrateCodexSessions } = require('../dist/runtime/codex-profile');

function setup(t) {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-run-profiles-'));
	t.after(() => fs.rmSync(root, { recursive: true, force: true }));
	const configRoot = path.join(root, 'config');
	fs.mkdirSync(configRoot);
	function generate(name) {
		const profile = `projects/${name}`;
		const profileDir = path.join(configRoot, profile);
		const project = path.join(root, name);
		fs.mkdirSync(project, { recursive: true });
		const env = createNunjucksEnv(configRoot);
		const manifest = normalizeManifest(defaultManifest(profile), profile);
		const context = buildRenderContext(project, profileDir, configRoot, manifest, env);
		context.skills = [{ name: 'same-name', description: `SKILL_${name}`, sourcePath: '', renderedContent: `---\nname: same-name\ndescription: SKILL_${name}\n---\nTest\n` }];
		context.mcpServers = { [`server_${name}`]: { transport: 'stdio', enabled: true, command: 'node', args: ['--version'], env: {}, headers: {} } };
		const runtime = codexAdapter.generate({ context, configRoot, env, agentsMd: `INSTRUCTIONS_${name}\nQuotes " and Unicode æ`, claudeMd: '' });
		const rendered = { agentDir: profileDir, configRoot, profile, context, files: runtime.files, skills: context.skills, runtimes: { codex: runtime } };
		syncRenderedProfile(rendered);
		return runtime;
	}
	return { root, generate };
}

test('shared home keeps project instructions, same-name skills and MCP in named profiles', (t) => {
	const { generate } = setup(t);
	const alpha = generate('alpha');
	const beta = generate('beta');
	assert.equal(codexSharedHome(alpha.context), codexSharedHome(beta.context));
	assert.notEqual(alpha.configFiles[1], beta.configFiles[1]);
	for (const [runtime, own, other] of [[alpha, 'alpha', 'beta'], [beta, 'beta', 'alpha']]) {
		const config = parse(fs.readFileSync(runtime.configFiles[1], 'utf8'));
		assert.match(config.developer_instructions, new RegExp(`INSTRUCTIONS_${own}`));
		assert.doesNotMatch(config.developer_instructions, new RegExp(`INSTRUCTIONS_${other}`));
		assert.deepEqual(Object.keys(config.mcp_servers), [`server_${own}`]);
		assert.equal(config.skills.config.length, 2);
		assert.deepEqual(config.skills.config.filter((skill) => skill.enabled).map((skill) => skill.path), [path.join(runtime.skillsDir, 'same-name', 'SKILL.md')]);
		const spawn = codexAdapter.spawn(runtime, { binary: 'codex', passthroughArgs: ['resume', '--last'], wrapperArgs: { sandboxMode: 'danger' } });
		assert.equal(spawn.env.CODEX_HOME, codexSharedHome(runtime.context));
		assert.deepEqual(spawn.args.slice(0, 2), ['--profile', codexProfileName(runtime.context)]);
		assert.deepEqual(spawn.args.slice(-2), ['resume', '--last']);
		assert.ok(!spawn.args.includes('--no-daemon'));
		assert.ok(!fs.existsSync(path.join(spawn.env.CODEX_HOME, 'AGENTS.md')));
	}
	generate('alpha');
	assert.ok(fs.existsSync(path.join(beta.skillsDir, 'same-name', 'SKILL.md')));
});

test('session migration preserves originals and newer destination sessions without resurrecting archived sessions', (t) => {
	const { root } = setup(t);
	const legacy = path.join(root, 'legacy');
	const shared = path.join(root, 'shared');
	for (const dir of ['sessions/2026/09/25', 'archived_sessions']) fs.mkdirSync(path.join(legacy, dir), { recursive: true });
	fs.mkdirSync(path.join(shared, 'sessions/2026/09/25'), { recursive: true });
	fs.writeFileSync(path.join(legacy, 'sessions/2026/09/25/old.jsonl'), 'old\n');
	fs.writeFileSync(path.join(legacy, 'sessions/2026/09/25/newer.jsonl'), 'stale\n');
	fs.writeFileSync(path.join(shared, 'sessions/2026/09/25/newer.jsonl'), 'newer\n');
	fs.writeFileSync(path.join(legacy, 'archived_sessions/archived.jsonl'), 'archived\n');
	fs.writeFileSync(path.join(legacy, 'state_5.sqlite'), 'must not copy');
	migrateCodexSessions(legacy, shared);
	assert.equal(fs.readFileSync(path.join(shared, 'sessions/2026/09/25/old.jsonl'), 'utf8'), 'old\n');
	assert.equal(fs.readFileSync(path.join(shared, 'sessions/2026/09/25/newer.jsonl'), 'utf8'), 'newer\n');
	assert.equal(fs.readFileSync(path.join(shared, 'archived_sessions/archived.jsonl'), 'utf8'), 'archived\n');
	assert.ok(fs.existsSync(path.join(legacy, 'sessions/2026/09/25/old.jsonl')));
	assert.ok(!fs.existsSync(path.join(shared, 'state_5.sqlite')));
	fs.unlinkSync(path.join(shared, 'sessions/2026/09/25/old.jsonl'));
	migrateCodexSessions(legacy, shared);
	assert.ok(!fs.existsSync(path.join(shared, 'sessions/2026/09/25/old.jsonl')));
});

test('concurrent project generation publishes complete profiles and isolates newly added skills', async (t) => {
	const { root } = setup(t);
	const configRoot = path.join(root, 'parallel');
	const code = `
		const fs = require('node:fs'), path = require('node:path');
		const { codexAdapter } = require('./dist/agents/codex');
		const { defaultManifest } = require('./dist/defaults');
		const { normalizeManifest } = require('./dist/manifest');
		const { createNunjucksEnv, buildRenderContext } = require('./dist/templates');
		const { syncRenderedProfile } = require('./dist/renderer');
		const [configRoot, name] = process.argv.slice(1);
		const profile = 'projects/' + name;
		const agentDir = path.join(configRoot, profile);
		const env = createNunjucksEnv(configRoot);
		const context = buildRenderContext(configRoot, agentDir, configRoot, normalizeManifest(defaultManifest(profile), profile), env);
		context.skills = [{ name: 'shared', sourcePath: '', description: name, renderedContent: '---\\nname: shared\\ndescription: ' + name + '\\n---\\nTest\\n' }];
		for (let i = 0; i < 3; i++) {
			const runtime = codexAdapter.generate({ context, configRoot, env, agentsMd: name, claudeMd: '' });
			syncRenderedProfile({ agentDir, configRoot, profile, context, files: runtime.files, skills: context.skills, runtimes: { codex: runtime } });
		}
	`;
	await Promise.all(['one', 'two', 'three', 'four'].map((name) => new Promise((resolve, reject) => {
		const child = spawn(process.execPath, ['-e', code, configRoot, name], { cwd: path.resolve(__dirname, '..'), windowsHide: true });
		let stderr = '';
		child.stderr.on('data', (data) => { stderr += data; });
		child.on('error', reject);
		child.on('exit', (status) => status === 0 ? resolve() : reject(new Error(stderr)));
	})));
	const home = path.join(configRoot, 'runtime', 'codex');
	const profiles = fs.readdirSync(home).filter((file) => file.endsWith('.config.toml'));
	assert.equal(profiles.length, 4);
	for (const file of profiles) {
		const config = parse(fs.readFileSync(path.join(home, file), 'utf8'));
		assert.equal(config.skills.config.length, 4);
		const enabled = config.skills.config.filter((entry) => entry.enabled);
		assert.equal(enabled.length, 1);
		assert.ok(enabled[0].path.includes(file.replace('.config.toml', '')));
	}
	assert.ok(!fs.existsSync(path.join(home, '.agent-run-sync.lock')));
});

test('installed Codex loads both generated profiles without instruction or skill leakage', { skip: !process.env.AGENT_RUN_TEST_CODEX }, (t) => {
	const { generate } = setup(t);
	const alpha = generate('alpha');
	const beta = generate('beta');
	for (const [runtime, own, other] of [[alpha, 'alpha', 'beta'], [beta, 'beta', 'alpha']]) {
		const spec = codexAdapter.spawn(runtime, { binary: process.env.AGENT_RUN_TEST_CODEX, passthroughArgs: ['debug', 'prompt-input', 'diagnostic only'], wrapperArgs: { sandboxMode: 'danger' } });
		const result = spawnSync(spec.command, spec.args, { cwd: spec.cwd, env: spec.env, encoding: 'utf8', windowsHide: true, timeout: 30000 });
		assert.equal(result.status, 0, result.stderr || String(result.error));
		assert.match(result.stdout, new RegExp(`INSTRUCTIONS_${own}`));
		assert.doesNotMatch(result.stdout, new RegExp(`INSTRUCTIONS_${other}`));
		assert.match(result.stdout, new RegExp(`SKILL_${own}`));
		assert.doesNotMatch(result.stdout, new RegExp(`SKILL_${other}`));
		assert.doesNotMatch(result.stdout, /project is trusted/);
	}
});
