const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test } = require('node:test');
const { stringify } = require('yaml');
const { BrainStore } = require('../dist/brain/store');
const { initializeBrain } = require('../dist/brain/projects');
const { listSkills, getSkill } = require('../dist/brain/skills');
const { addTodo, updateTodo, listTodos, importTodos, getTodo } = require('../dist/brain/todos');
const { syncConnector } = require('../dist/brain/connectors');
const { gitPreview, syncGit } = require('../dist/brain/git');
const { renderProfile } = require('../dist/renderer');
const { resolveProfileResult } = require('../dist/project');
const { serveApiCore } = require('../dist/brain/server');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js');

function environment(t) {
	const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'brain-'));
	const cleanups = [];
	t.after(async () => { for (const cleanup of cleanups.reverse()) await cleanup(); fs.rmSync(directory, { recursive: true, force: true }); });
	const root = path.join(directory, 'config');
	const cwd = path.join(directory, 'source');
	fs.mkdirSync(cwd);
	initializeBrain(root, cwd);
	function project(name) {
		const source = path.join(directory, name);
		fs.mkdirSync(source);
		fs.writeFileSync(path.join(source, 'package.json'), JSON.stringify({ name }));
		const profile = path.join(root, 'projects', name);
		fs.mkdirSync(profile, { recursive: true });
		fs.writeFileSync(path.join(profile, 'config.yaml'), stringify({ name, roots: [source] }));
		fs.writeFileSync(path.join(profile, 'agent-run.jsonc'), '{}\n');
		return { cwd: source, directory: profile };
	}
	function store(cwd) { const value = new BrainStore(root, cwd); cleanups.push(() => value.close()); return value; }
	return { directory, root, cwd, project, store, cleanup: (fn) => cleanups.push(fn) };
}

test('global plus project/default scopes, authority, promotion, revisions, and rebuildable FTS', (t) => {
	const env = environment(t);
	const first = env.project('first');
	const second = env.project('second');
	const store = env.store(first.cwd);
	const fallback = env.store(env.cwd);
	const other = env.store(second.cwd);
	const global = store.remember({ scope: 'global', type: 'constraint', authority: 'user', title: 'Atomic refresh', content: 'Refresh replacements must be atomic.', recall: 'always' });
	const local = store.remember({ scope: 'project', type: 'observation', title: 'Project alpha', content: 'Need to investigate transactions.', applies_to: ['src/auth/**'] });
	fallback.remember({ scope: 'default', type: 'memory', title: 'Outside only', content: 'Use for experiments.' });
	assert.deepEqual(store.search('atomic').map((item) => item.id), [global.id]);
	assert.equal(store.search('Outside').length, 0);
	assert.equal(other.search('alpha').length, 0);
	assert.equal(fallback.search('alpha').length, 0);
	assert.throws(() => store.remember({ scope: 'default', type: 'memory', title: 'No', content: 'No' }), /not available/);
	assert.throws(() => store.remember({ scope: 'global', type: 'constraint', title: 'No', content: 'No' }), /Inferred knowledge/);
	assert.throws(() => store.remember({ scope: 'global', type: 'observation', title: 'No', content: 'No' }), /explicit user authority/);
	assert.deepEqual(store.context('unrelated', ['src/auth/refresh.ts']).items.map((item) => item.id), [global.id, local.id]);
	const promoted = store.promote(local.id, 'global', local.revision);
	assert.equal(promoted.promoted_from, local.id);
	assert.equal(other.search('alpha')[0].id, promoted.id);
	const deprecated = store.deprecate(local.id, local.revision, 'Resolved');
	assert.equal(deprecated.status, 'deprecated');
	assert.throws(() => store.deprecate(local.id, local.revision), /changed/);
	assert.equal(store.search('alpha').some((item) => item.id === local.id), false);
	assert.equal(store.search('alpha', { includeDeprecated: true }).length, 2);
	assert.doesNotThrow(() => store.search('" OR * ) NOT [broken]'));
	fs.writeFileSync(path.join(first.directory, 'observations', 'manual.md'), '# Manual edit\n\nNewword from a human.\n');
	assert.equal(store.search('Newword').length, 1);
});

test('skills inherit global and allow project overrides and explicit extension', (t) => {
	const env = environment(t);
	const project = env.project('skills');
	const store = env.store(project.cwd);
	const write = (directory, name, description, content, parent) => {
		const target = path.join(directory, 'skills', name);
		fs.mkdirSync(target, { recursive: true });
		fs.writeFileSync(path.join(target, 'SKILL.md'), `---\n${stringify({ name, description, ...(parent ? { extends: parent } : {}) })}---\n${content}\n`);
	};
	write(path.join(env.root, 'global'), 'check', 'Global check', 'Global instructions');
	write(project.directory, 'check', 'Project check', 'Project instructions', 'global:check');
	write(project.directory, 'check-extra', 'Another check', 'Additional instructions', 'global:check');
	assert.equal(listSkills(store).filter((item) => item.name === 'check').length, 1);
	assert.match(getSkill(store, 'check').content, /Global instructions[\s\S]*Project instructions/);
	assert.match(getSkill(store, 'check-extra').content, /Global instructions[\s\S]*Additional instructions/);
	assert.doesNotMatch(getSkill(store, 'check-extra').content, /Project instructions/);
	assert.equal('content' in listSkills(store)[0], false);
	assert.throws(() => getSkill(store, '../../secret'), /not found/);
});

test('todo imports deduplicate and concurrent revisions cannot overwrite task state', (t) => {
	const env = environment(t);
	const store = env.store(env.cwd);
	const task = { scope: 'default', title: 'Fix refresh', source: { type: 'github', external_id: 'acme/api#1' } };
	const created = addTodo(store, task);
	assert.equal(addTodo(store, task).id, created.id);
	const updated = updateTodo(store, created.id, created.revision, { status: 'doing' });
	assert.equal(updated.status, 'doing');
	assert.throws(() => updateTodo(store, created.id, created.revision, { status: 'done' }), /changed/);
	assert.equal(listTodos(store).length, 1);
});

test('symlinks, escaping paths, and mismatched scopes are rejected', (t) => {
	const env = environment(t);
	const store = env.store(env.cwd);
	assert.throws(() => store.atomicWrite('../escape.md', 'bad'), /escapes/);
	if (process.platform !== 'win32') {
		fs.rmdirSync(path.join(env.root, 'default', 'memory'));
		fs.symlinkSync(env.cwd, path.join(env.root, 'default', 'memory'));
		assert.throws(() => store.remember({ scope: 'default', type: 'memory', title: 'x', content: 'x' }), /Symlinks/);
		fs.unlinkSync(path.join(env.root, 'default', 'memory'));
	}
	const item = store.remember({ scope: 'default', type: 'memory', title: 'x', content: 'x' });
	const file = path.join(env.root, item.source);
	fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('scope: default', 'scope: project'));
	assert.throws(() => store.search('x'), /scope does not match/);
});

test('project registration and default scope feed every native MCP renderer', (t) => {
	const env = environment(t);
	const project = env.project('rendered');
	assert.equal(resolveProfileResult(project.cwd, env.root).profile, 'projects/rendered');
	assert.equal(resolveProfileResult(env.cwd, env.root).profile, 'default');
	for (const agent of ['codex', 'claude', 'gemini', 'grok']) {
		const rendered = renderProfile(project.cwd, project.directory, true, agent, undefined, { configRoot: env.root, profile: 'projects/rendered' });
		assert.equal(rendered.context.mcpServers['agent-brain'].command, process.execPath);
		assert.ok(rendered.runtimes[agent].files.some((file) => file.content.includes('agent-brain')));
		assert.ok(rendered.context.renderedAgentSections.some((section) => section.includes('get_context')));
	}
});

async function client(t, env, extra = []) {
	const transport = new StdioClientTransport({ command: process.execPath, args: [path.resolve(__dirname, '../dist/agent-run.js'), 'mcp', '--configdir', env.root, '--cwd', env.cwd, ...extra],
		env: { ...process.env, XDG_RUNTIME_DIR: path.join(env.root, 'runtime') }, stderr: 'pipe' });
	const client = new Client({ name: 'brain-integration-test', version: '1.0.0' });
	env.cleanup(() => client.close());
	await client.connect(transport);
	return client;
}

test('default MCP bridge initializes, writes, and retrieves knowledge through the apicore service', { skip: process.platform === 'win32' }, async (t) => {
	const env = environment(t);
	const service = await serveApiCore(env.root, path.join(env.root, 'runtime', 'agent-brain.sock'));
	env.cleanup(() => service.close());
	const connection = await client(t, env);
	const tools = await connection.listTools();
	assert.ok(tools.tools.some((tool) => tool.name === 'remember'));
	const created = await connection.callTool({ name: 'remember', arguments: { scope: 'default', type: 'memory', title: 'Protocol test', content: 'Find this uniqueprotocolword.' } });
	assert.equal(created.isError, undefined);
	const result = await connection.callTool({ name: 'search_knowledge', arguments: { query: 'uniqueprotocolword' } });
	assert.equal(JSON.parse(result.content[0].text).length, 1);
	const invalid = await connection.callTool({ name: 'remember', arguments: { scope: 'project', type: 'memory', title: 'Bad', content: 'Bad' } });
	assert.equal(invalid.isError, true);
});

test('apicore serves SDK MCP through a private Unix socket and stdio proxy', { skip: process.platform === 'win32' }, async (t) => {
	const env = environment(t);
	const directory = path.join(env.directory, 'socket');
	fs.mkdirSync(directory, { mode: 0o700 });
	const socket = path.join(directory, 'brain.sock');
	const service = await serveApiCore(env.root, socket);
	env.cleanup(() => service.close());
	assert.equal(fs.statSync(socket).mode & 0o777, 0o600);
	assert.equal(fs.statSync(socket).uid, process.getuid());
	await assert.rejects(() => serveApiCore(env.root, socket), /Socket already exists/);
	const connection = await client(t, env, ['--socket', socket]);
	const tools = await connection.listTools();
	assert.ok(tools.tools.some((tool) => tool.name === 'get_context'));
	const result = await connection.callTool({ name: 'brain_status', arguments: {} });
	assert.deepEqual(JSON.parse(result.content[0].text).scopes, ['global', 'default']);
	const other = env.project('socket-project');
	const projectConnection = await client(t, { ...env, cwd: other.cwd }, ['--socket', socket]);
	const projectStatus = await projectConnection.callTool({ name: 'brain_status', arguments: {} });
	assert.equal(JSON.parse(projectStatus.content[0].text).profile, 'projects/socket-project');
	const unrelated = environment(t);
	await assert.rejects(() => client(t, unrelated, ['--socket', socket]), /HTTP 409/);
});

test('missing service fails without starting a standalone brain server', (t) => {
	const env = environment(t);
	fs.rmSync(path.join(env.root, 'index'), { recursive: true });
	const result = spawnSync(process.execPath, [path.resolve(__dirname, '../dist/agent-run.js'), 'mcp', '--configdir', env.root, '--cwd', env.cwd], {
		encoding: 'utf8', env: { ...process.env, XDG_RUNTIME_DIR: path.join(env.root, 'runtime') }
	});
	assert.equal(result.status, 1);
	assert.match(result.stderr, /service is not running/);
	assert.equal(result.stdout, '');
	assert.equal(fs.existsSync(path.join(env.root, 'index')), false);
});

test('bridge rejects socket directories accessible to other users', { skip: process.platform === 'win32' }, async (t) => {
	const env = environment(t);
	const directory = path.join(env.directory, 'socket');
	fs.mkdirSync(directory, { mode: 0o700 });
	const socket = path.join(directory, 'brain.sock');
	const service = await serveApiCore(env.root, socket);
	env.cleanup(() => service.close());
	fs.chmodSync(directory, 0o755);
	const result = spawnSync(process.execPath, [path.resolve(__dirname, '../dist/agent-run.js'), 'mcp', '--configdir', env.root, '--socket', socket], { encoding: 'utf8' });
	assert.equal(result.status, 1);
	assert.match(result.stderr, /mode 0700/);
});

test('create --quick detects a source root and does not write configuration into it', (t) => {
	const env = environment(t);
	const result = spawnSync(process.execPath, [path.resolve(__dirname, '../dist/agent-run.js'), 'create', 'created', '--quick', '--cwd', env.cwd, '--configdir', env.root], { encoding: 'utf8' });
	assert.equal(result.status, 0, result.stderr);
	assert.deepEqual(fs.readdirSync(env.cwd), []);
	assert.equal(resolveProfileResult(env.cwd, env.root).profile, 'projects/created');
	for (const folder of ['skills', 'preferences', 'constraints', 'conventions', 'reviews', 'memory', 'todo', 'templates']) {
		assert.ok(fs.statSync(path.join(env.root, 'projects/created', folder)).isDirectory(), folder);
	}
});

test('initialization creates scope directories and preserves existing knowledge and skills', (t) => {
	const env = environment(t);
	const project = env.project('layout');
	const store = env.store(project.cwd);
	const item = store.remember({ scope: 'project', type: 'constraint', authority: 'user', title: 'Keep data', content: 'Preserve existing files.' });
	const skill = path.join(env.root, 'global/skills/brain-memory/SKILL.md');
	fs.appendFileSync(skill, '\nUser customization.\n');
	const existingSkill = fs.readFileSync(skill, 'utf8');
	initializeBrain(env.root, project.cwd);
	for (const scope of ['global', 'default', 'projects/layout']) {
		for (const folder of ['skills', 'preferences', 'constraints', 'conventions', 'reviews', 'memory', 'todo', 'templates', 'rules', 'decisions', 'specs', 'observations']) {
			assert.ok(fs.statSync(path.join(env.root, scope, folder)).isDirectory(), `${scope}/${folder}`);
		}
	}
	assert.equal(store.get(item.id).revision, item.revision);
	assert.equal(fs.readFileSync(skill, 'utf8'), existingSkill);
	for (const [type, folder] of [['preference', 'preferences'], ['convention', 'conventions'], ['spec', 'specs'], ['decision', 'decisions']]) {
		const written = store.remember({ scope: 'project', type, authority: 'user', title: type, content: 'Confirmed project knowledge.' });
		assert.equal(path.dirname(written.source), path.join('projects', 'layout', folder));
		assert.equal(store.get(written.id).type, type);
	}
});

test('namespaced project names survive registration and explicit profile selection', (t) => {
	const env = environment(t);
	fs.writeFileSync(path.join(env.cwd, 'package.json'), JSON.stringify({ name: '@acme/api' }));
	fs.writeFileSync(path.join(env.cwd, '.agent-run.env'), 'AGENT_RUN_PROFILE=acme/api\n');
	const result = spawnSync(process.execPath, [path.resolve(__dirname, '../dist/agent-run.js'), 'create', 'acme/api', '--quick', '--cwd', env.cwd, '--configdir', env.root], { encoding: 'utf8' });
	assert.equal(result.status, 0, result.stderr);
	const { listBrainProjects, projectConfigSchema } = require('../dist/brain/config');
	assert.equal(listBrainProjects(env.root)[0].name, 'acme/api');
	assert.equal(resolveProfileResult(env.cwd, env.root).profile, 'projects/acme/api');
	assert.throws(() => projectConfigSchema.parse({ name: 'acme/../escape', roots: [env.cwd] }));
});

test('canonical Markdown skills support existing templates without recreating duplicate sources', (t) => {
	const env = environment(t);
	const project = env.project('markdown-skills');
	const template = path.join(env.root, 'global/skills/commit-workflow/SKILL.md.njk');
	fs.renameSync(template, template.slice(0, -4));
	require('../dist/config-tree').ensureDefaultGlobalTemplates(env.root);
	assert.equal(fs.existsSync(template), false);
	const rendered = renderProfile(project.cwd, project.directory, true, 'codex', undefined, { configRoot: env.root, profile: 'projects/markdown-skills' });
	const native = rendered.context.skills.find((item) => item.name === 'commit-workflow');
	assert.ok(native.sourcePath.endsWith('/SKILL.md'));
	assert.doesNotMatch(native.renderedContent, /\{%|\{\{/);
	assert.doesNotMatch(getSkill(env.store(project.cwd), 'commit-workflow').content, /\{%|\{\{/);
});

test('manual goal-format metadata and legacy notes are searchable; deleting the index preserves knowledge', (t) => {
	const env = environment(t);
	const memory = path.join(env.root, 'default', 'notes', 'memory');
	fs.mkdirSync(memory, { recursive: true });
	fs.writeFileSync(path.join(memory, 'README.md'), '# Old notes\n\nLegacyword persists.\n');
	const constraints = path.join(env.root, 'default', 'constraints');
	fs.mkdirSync(constraints, { recursive: true });
	fs.writeFileSync(path.join(constraints, 'auth.md'), '---\nid: auth-rule\ntype: constraint\nscope: default\nauthority: user\nrecall: always\ncreated: 2026-09-06\n---\n\n# Single-use refresh\n\nTokenword invariant.\n');
	let store = new BrainStore(env.root, env.cwd);
	assert.equal(store.search('Legacyword').length, 1);
	assert.equal(store.search('Tokenword')[0].title, 'Single-use refresh');
	store.close();
	fs.rmSync(path.join(env.root, 'index'), { recursive: true });
	store = env.store(env.cwd);
	assert.equal(store.search('Tokenword').length, 1);
	assert.equal(store.search('Legacyword').length, 1);
});

test('legacy review metadata is preserved and addressed reviews remain historical', (t) => {
	const env = environment(t);
	const store = env.store(env.cwd);
	const text = '---\ndate: 2026-05-02\nscope: HEAD~5..HEAD\nstatus: addressed\n---\n\n# Prior review\n\nLegacyreviewword.\n';
	store.atomicWrite('default/reviews/old.md', text);
	assert.equal(store.search('Legacyreviewword').length, 0);
	assert.equal(store.search('Legacyreviewword', { includeDeprecated: true })[0].content, text.trim());
	assert.equal(fs.readFileSync(path.join(env.root, 'default/reviews/old.md'), 'utf8'), text);
});

test('remote task sync preserves local edits and reports conflicting changes', (t) => {
	const env = environment(t);
	const store = env.store(env.cwd);
	const remote = { scope: 'default', title: 'Original', description: 'Original body', source: { type: 'github', external_id: 'a/b#1' } };
	const first = importTodos(store, [remote]);
	const id = first.imported[0];
	const task = getTodo(store, id);
	updateTodo(store, id, task.revision, { description: 'Local body' });
	assert.deepEqual(importTodos(store, [{ ...remote, title: 'Remote title' }]).updated, [id]);
	assert.equal(getTodo(store, id).description, 'Local body');
	assert.deepEqual(importTodos(store, [{ ...remote, title: 'Remote title', description: 'Remote body' }]).conflicts, [id]);
	assert.equal(getTodo(store, id).description, 'Local body');
	assert.equal(importTodos(store, [{ ...remote, title: 'Remote title' }]).updated.length, 0);
});

test('GitHub connector paginates, excludes pull requests, and leaves local state untouched on network failure', async (t) => {
	const env = environment(t);
	const store = env.store(env.cwd);
	fs.writeFileSync(path.join(env.root, 'brain.jsonc'), JSON.stringify({ connectors: { issues: { type: 'github', repository: 'a/b' } } }));
	const original = global.fetch;
	t.after(() => { global.fetch = original; });
	let requests = 0;
	global.fetch = async (url, options) => {
		requests++;
		assert.equal(url.hostname, 'api.github.com');
		assert.equal(options.redirect, 'error');
		const rows = requests === 1 ? Array.from({ length: 100 }, (_, i) => ({ number: i + 1, title: `Issue ${i}`, body: '', state: 'open', html_url: `https://github.com/a/b/issues/${i + 1}`, labels: [], ...(i === 0 ? { pull_request: {} } : {}) })) : [];
		return new Response(JSON.stringify(rows), { status: 200 });
	};
	const result = await syncConnector(store, 'issues', 'default');
	assert.equal(requests, 2);
	assert.equal(result.imported.length, 99);
	global.fetch = async () => { throw new Error('secret-token'); };
	await assert.rejects(() => syncConnector(store, 'issues', 'default'), (error) => !error.message.includes('secret-token'));
	assert.equal(listTodos(store).length, 99);
});

test('Git save preview excludes runtime state, credentials, and native configuration', (t) => {
	const env = environment(t);
	const store = env.store(env.cwd);
	const knowledge = store.remember({ scope: 'default', type: 'memory', title: 'Portable', content: 'Keep this knowledge.' });
	store.atomicWrite('secrets/token.md', 'Do not sync');
	store.atomicWrite('default/live/private.md', 'Do not sync');
	const preview = gitPreview(store);
	assert.ok(preview.files.includes(knowledge.source));
	assert.ok(preview.files.every((file) => !/secrets|runtime|index|live|brain\.jsonc/.test(file)));
	assert.equal(syncGit(store, 'init').state, 'dirty');
	assert.throws(() => syncGit(store, 'save'), /commit message/);
});

test('registered subdirectories use the most specific root and stale write locks fail clearly', (t) => {
	const env = environment(t);
	const project = env.project('parent');
	const nested = path.join(project.cwd, 'subproject');
	fs.mkdirSync(nested);
	const config = path.join(env.root, 'projects', 'nested');
	fs.mkdirSync(config);
	fs.writeFileSync(path.join(config, 'config.yaml'), stringify({ name: 'nested', roots: [nested] }));
	fs.writeFileSync(path.join(config, 'agent-run.jsonc'), '{}');
	const store = env.store(nested);
	assert.equal(store.profile, 'projects/nested');
	assert.equal(store.projectRoot, nested);
	fs.writeFileSync(path.join(env.root, 'runtime', 'brain-write.lock'), '999999');
	assert.throws(() => store.remember({ scope: 'project', type: 'memory', title: 'x', content: 'x' }), /Another brain write/);
});

test('Git saves and pushes only eligible files, and refuses an unrelated staged change', (t) => {
	const env = environment(t);
	const store = env.store(env.cwd);
	const item = store.remember({ scope: 'default', type: 'memory', title: 'Portable', content: 'Portableword knowledge.' });
	store.atomicWrite('secrets/token.md', 'Never include this');
	const git = (cwd, args) => {
		const result = spawnSync('git', ['-C', cwd, ...args], { encoding: 'utf8', shell: false });
		assert.equal(result.status, 0, result.stderr);
		return result.stdout.trim();
	};
	syncGit(store, 'init');
	git(env.root, ['config', 'user.name', 'Test User']);
	git(env.root, ['config', 'user.email', 'test@example.test']);
	git(env.root, ['config', 'commit.gpgsign', 'false']);
	git(env.root, ['config', 'core.hooksPath', path.join(env.directory, 'no-hooks')]);
	syncGit(store, 'save', 'Save test knowledge');
	const tracked = git(env.root, ['ls-files']);
	assert.ok(tracked.includes(item.source.split(path.sep).join('/')));
	assert.doesNotMatch(tracked, /secrets|knowledge.sqlite|brain.jsonc|runtime/);
	const remote = path.join(env.directory, 'remote.git');
	fs.mkdirSync(remote);
	git(remote, ['init', '--bare', '--initial-branch=main']);
	git(env.root, ['remote', 'add', 'origin', remote]);
	git(env.root, ['config', 'branch.main.remote', 'origin']);
	git(env.root, ['config', 'branch.main.merge', 'refs/heads/main']);
	syncGit(store, 'push');
	assert.equal(git(remote, ['rev-parse', 'main']), git(env.root, ['rev-parse', 'HEAD']));
	syncGit(store, 'pull');
	fs.writeFileSync(path.join(env.root, 'unrelated.txt'), 'Unrelated user work');
	git(env.root, ['add', 'unrelated.txt']);
	assert.throws(() => syncGit(store, 'save', 'Another save'), /already has staged changes/);
});

test('Trello imports normalize completed and archived cards without persisting credentials', async (t) => {
	const env = environment(t);
	const store = env.store(env.cwd);
	fs.writeFileSync(path.join(env.root, 'brain.jsonc'), JSON.stringify({ connectors: { board: { type: 'trello', board: 'abc123', keyEnv: 'BRAIN_TEST_KEY', tokenEnv: 'BRAIN_TEST_TOKEN' } } }));
	const original = global.fetch;
	const oldKey = process.env.BRAIN_TEST_KEY;
	const oldToken = process.env.BRAIN_TEST_TOKEN;
	t.after(() => { global.fetch = original; if (oldKey === undefined) delete process.env.BRAIN_TEST_KEY; else process.env.BRAIN_TEST_KEY = oldKey; if (oldToken === undefined) delete process.env.BRAIN_TEST_TOKEN; else process.env.BRAIN_TEST_TOKEN = oldToken; });
	process.env.BRAIN_TEST_KEY = 'test-key';
	process.env.BRAIN_TEST_TOKEN = 'test-token';
	global.fetch = async (url) => {
		assert.equal(url.hostname, 'api.trello.com');
		assert.equal(url.searchParams.get('token'), 'test-token');
		return new Response(JSON.stringify([
			{ id: 'one', name: 'Complete', desc: '', closed: false, dueComplete: true, due: '2026-09-07T00:00:00Z', url: 'https://trello.com/c/one', labels: [] },
			{ id: 'two', name: 'Archived', desc: '', closed: true, dueComplete: false, due: null, url: 'https://trello.com/c/two', labels: [] }
		]));
	};
	const imported = await syncConnector(store, 'board', 'default');
	assert.equal(imported.imported.length, 2);
	assert.equal(getTodo(store, imported.imported[0]).status, 'done');
	assert.equal(getTodo(store, imported.imported[1]).status, 'cancelled');
	assert.doesNotMatch(JSON.stringify(listTodos(store)), /test-token|test-key/);
});

test('legacy migration preserves brain memory and moves loose memory into the canonical directory', (t) => {
	const env = environment(t);
	const profile = env.project('migration');
	const { describeLegacyProfileLayout, migrateProfileLayout } = require('../dist/config-tree');
	const memory = path.join(profile.directory, 'memory');
	fs.mkdirSync(memory);
	fs.writeFileSync(path.join(memory, 'kept.md'), '# Keep this knowledge\n');
	fs.writeFileSync(path.join(profile.directory, 'memory-old.md'), '# Loose knowledge\n');
	assert.deepEqual(describeLegacyProfileLayout(profile.directory, env.root), [path.join(profile.directory, 'memory-old.md')]);
	migrateProfileLayout(env.root, profile.directory, () => { throw new Error('No Git moves expected'); });
	assert.equal(fs.readFileSync(path.join(memory, 'kept.md'), 'utf8'), '# Keep this knowledge\n');
	assert.equal(fs.readFileSync(path.join(memory, 'memory-old.md'), 'utf8'), '# Loose knowledge\n');
	assert.equal(fs.existsSync(path.join(profile.directory, 'notes', 'memory')), false);
	assert.deepEqual(describeLegacyProfileLayout(profile.directory, env.root), []);
});

test('generated MCP command retains its socket when the client filters environment variables', { skip: process.platform === 'win32' }, async (t) => {
	const env = environment(t);
	const runtime = path.join(env.root, 'runtime');
	const service = await serveApiCore(env.root, path.join(runtime, 'agent-brain.sock'));
	env.cleanup(() => service.close());
	const original = process.env.XDG_RUNTIME_DIR;
	let rendered;
	try {
		process.env.XDG_RUNTIME_DIR = runtime;
		rendered = renderProfile(env.cwd, path.join(env.root, 'default'), true, 'codex', undefined, { configRoot: env.root, profile: 'default' });
	} finally {
		if (original === undefined) delete process.env.XDG_RUNTIME_DIR;
		else process.env.XDG_RUNTIME_DIR = original;
	}
	const mcp = rendered.context.mcpServers['agent-brain'];
	const connection = new Client({ name: 'rendered-command-test', version: '1.0.0' });
	env.cleanup(() => connection.close());
	await connection.connect(new StdioClientTransport({ command: mcp.command, args: mcp.args, stderr: 'pipe' }));
	const status = await connection.callTool({ name: 'brain_status', arguments: {} });
	assert.deepEqual(JSON.parse(status.content[0].text), { profile: null, scopes: ['global', 'default'] });
});

test('startup pull fast-forwards clean knowledge and preserves dirty or divergent history', (t) => {
	const env = environment(t);
	const store = env.store(env.cwd);
	const { pullOnStart } = require('../dist/brain/git');
	const git = (cwd, args) => {
		const result = spawnSync('git', ['-C', cwd, ...args], { encoding: 'utf8' });
		assert.equal(result.status, 0, result.stderr);
		return result.stdout.trim();
	};
	assert.match(pullOnStart(store), /uninitialized/);
	git(env.root, ['init', '--initial-branch=main']);
	git(env.root, ['config', 'user.name', 'Test']);
	git(env.root, ['config', 'user.email', 'test@example.com']);
	git(env.root, ['add', '.']);
	git(env.root, ['commit', '-m', 'Initial test data']);
	assert.match(pullOnStart(store), /no upstream/);
	const remote = path.join(env.directory, 'remote.git');
	git(env.directory, ['clone', '--bare', env.root, remote]);
	git(env.root, ['remote', 'add', 'origin', remote]);
	git(env.root, ['push', '-u', 'origin', 'main']);
	const other = path.join(env.directory, 'other');
	git(env.directory, ['clone', remote, other]);
	git(other, ['config', 'user.name', 'Test']);
	git(other, ['config', 'user.email', 'test@example.com']);
	fs.writeFileSync(path.join(other, 'remote-note.md'), '# Remote knowledge\n');
	git(other, ['add', '.']);
	git(other, ['commit', '-m', 'Remote test knowledge']);
	git(other, ['push']);
	fs.writeFileSync(path.join(env.root, 'unsaved.md'), 'Local edit');
	assert.match(pullOnStart(store), /dirty/);
	assert.equal(fs.existsSync(path.join(env.root, 'remote-note.md')), false);
	fs.unlinkSync(path.join(env.root, 'unsaved.md'));
	assert.equal(pullOnStart(store), 'Startup pull completed.');
	assert.equal(fs.readFileSync(path.join(env.root, 'remote-note.md'), 'utf8'), '# Remote knowledge\n');
	fs.writeFileSync(path.join(env.root, 'local-note.md'), 'Local commit');
	git(env.root, ['add', '.']);
	git(env.root, ['commit', '-m', 'Local test knowledge']);
	const head = git(env.root, ['rev-parse', 'HEAD']);
	fs.writeFileSync(path.join(other, 'remote-note.md'), '# Updated remote knowledge\n');
	git(other, ['commit', '-am', 'Update remote test knowledge']);
	git(other, ['push']);
	assert.match(pullOnStart(store), /failed; using local configuration/);
	assert.equal(git(env.root, ['rev-parse', 'HEAD']), head);
	assert.equal(git(env.root, ['status', '--porcelain']), '');
});

test('service helper manages only the named normal account', { skip: process.platform === 'win32' }, (t) => {
	const env = environment(t);
	const bin = path.join(env.directory, 'bin');
	fs.mkdirSync(bin);
	const log = path.join(env.directory, 'commands');
	const programs = {
		id: 'echo 0',
		getent: '[ "$2" = bjorn ] || exit 2; echo "bjorn:x:1000:1000::/home/bjorn:/bin/bash"',
		loginctl: 'printf "loginctl %s\\n" "$*" >> "$TEST_LOG"',
		systemctl: 'printf "systemctl %s\\n" "$*" >> "$TEST_LOG"',
		runuser: 'printf "runuser %s\\n" "$*" >> "$TEST_LOG"'
	};
	for (const [name, body] of Object.entries(programs)) fs.writeFileSync(path.join(bin, name), '#!/bin/sh\n' + body + '\n', { mode: 0o755 });
	const run = (...users) => spawnSync('bash', [path.resolve(__dirname, 'ensure-agent-brain.sh'), ...users], { encoding: 'utf8', env: { ...process.env, PATH: bin + path.delimiter + process.env.PATH, TEST_LOG: log } });
	assert.equal(run().status, 0);
	assert.equal(fs.existsSync(log), false);
	assert.equal(run('bjorn').status, 0);
	const commands = fs.readFileSync(log, 'utf8');
	assert.match(commands, /loginctl enable-linger bjorn/);
	assert.match(commands, /runuser -u bjorn .*systemctl --user restart agent-brain.service/);
	assert.match(commands, /systemctl --user is-active --quiet agent-brain.service/);
	assert.notEqual(run('unknown').status, 0);
});
