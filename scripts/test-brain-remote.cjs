const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { BrainCredentials } = require('../dist/brain-remote');
function setup(t) {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), 'brain-remote-'));
	t.after(() => fs.rmSync(root, { recursive: true, force: true }));
	const config = {
		url: 'https://brain.example/mcp',
		clientId: 'desktop',
		redirectUrl: 'http://127.0.0.1:8123/callback',
		scope: 'read write repo:*'
	};
	return { root, config, credentials: new BrainCredentials(root, config) };
}
test('credentials are private, endpoint-bound and cannot follow symlinks', (t) => {
	const { root, config, credentials: c } = setup(t);
	c.saveTokens({
		access_token: 'private-test-token',
		token_type: 'Bearer',
		expires_in: 300,
		refresh_token: 'test-refresh'
	});
	assert.equal(c.tokens().access_token, 'private-test-token');
	if (process.platform !== 'win32') {
		assert.equal(fs.statSync(c.file).mode & 0o777, 0o600);
		assert.equal(fs.statSync(c.directory).mode & 0o777, 0o700);
		const original = c.file + '.original';
		fs.renameSync(c.file, original);
		fs.symlinkSync(original, c.file);
		assert.throws(() => c.tokens(), /private/);
	}
	assert.equal(
		new BrainCredentials(root, { ...config, url: 'https://other.example/mcp' }).tokens(),
		undefined
	);
});
test('concurrent clients refresh a rotated token only once and retry rejected access tokens', async (t) => {
	const { root, config, credentials: a } = setup(t),
		b = new BrainCredentials(root, config);
	a.saveTokens({
		access_token: 'expired',
		token_type: 'Bearer',
		expires_in: 0,
		refresh_token: 'original-refresh'
	});
	const original = global.fetch;
	let refreshes = 0;
	const issued = [];
	global.fetch = async (input, init) => {
		const url = String(input);
		if (url.includes('oauth-protected-resource'))
			return Response.json({ resource: config.url, authorization_servers: ['https://brain.example/oauth'] });
		if (url.includes('oauth-authorization-server'))
			return Response.json({
				issuer: 'https://brain.example/oauth',
				authorization_endpoint: 'https://brain.example/oauth/authorize',
				token_endpoint: 'https://brain.example/oauth/token',
				response_types_supported: ['code'],
				code_challenge_methods_supported: ['S256'],
				token_endpoint_auth_methods_supported: ['none']
			});
		if (url.endsWith('/oauth/token')) {
			refreshes++;
			const body = new URLSearchParams(init.body);
			assert.equal(body.get('refresh_token'), refreshes === 1 ? 'original-refresh' : 'rotated-1');
			await new Promise((resolve) => setTimeout(resolve, 50));
			return Response.json({
				access_token: 'issued-' + refreshes,
				token_type: 'Bearer',
				expires_in: 300,
				refresh_token: 'rotated-' + refreshes
			});
		}
		issued.push(new Headers(init.headers).get('Authorization'));
		return new Response(issued.length === 1 ? 'Rejected' : 'OK', { status: issued.length === 1 ? 401 : 200 });
	};
	t.after(() => (global.fetch = original));
	const tokens = await Promise.all([a.refresh(), b.refresh()]);
	assert.equal(refreshes, 1);
	assert.equal(tokens[0].access_token, tokens[1].access_token);
	assert.equal((await a.fetch(config.url, { method: 'POST' })).status, 200);
	assert.equal(refreshes, 2);
	assert.deepEqual(issued, ['Bearer issued-1', 'Bearer issued-2']);
	await assert.rejects(a.fetch('https://other.example/mcp'), /origin/);
});
test('missing login fails clearly without launching a browser or using local Brain', async (t) => {
	const { credentials } = setup(t);
	await assert.rejects(credentials.refresh(), /agent-run brain-login/);
});
test('all agent configurations select the remote repository without exposing credentials', (t) => {
	const { root, config } = setup(t),
		source = path.join(root, 'source'),
		profile = 'projects/customer/repository',
		profileDir = path.join(root, profile);
	fs.mkdirSync(source);
	const tree = require('../dist/config-tree'),
		manifest = require('../dist/manifest');
	tree.ensureConfigRootLayout(root);
	tree.ensureDefaultGlobalTemplates(root);
	manifest.ensureRootDefaultsFile(root);
	manifest.createProfileMarker(profileDir);
	fs.writeFileSync(path.join(root, 'brain.jsonc'), JSON.stringify({ enabled: true, remote: config }));
	const rendered = require('../dist/renderer').renderProfile(source, profileDir, true, null, undefined, {
		configRoot: root,
		profile
	});
	const mcp = rendered.context.mcpServers['agent-brain'];
	assert.equal(mcp.command, process.execPath);
	assert(
		mcp.args.includes('brain-remote.js') || mcp.args.some((a) => a.endsWith(path.sep + 'brain-remote.js'))
	);
	assert.deepEqual(mcp.args.slice(-2), ['--repository', 'customer/repository']);
	assert.deepEqual(mcp.headers, {});
	for (const adapter of ['codex', 'claude', 'gemini', 'grok']) {
		const runtime = rendered.runtimes[adapter];
		assert(runtime, adapter);
		assert(!JSON.stringify(runtime.files).includes('Authorization'));
	}
	fs.writeFileSync(path.join(root, 'brain.jsonc'), JSON.stringify({ enabled: true }));
	const local = require('../dist/renderer').renderProfile(source, profileDir, true, null, undefined, {
		configRoot: root,
		profile
	});
	assert.equal(local.context.mcpServers['agent-brain'].command, 'agent-brain');
});
test('refresh lock from an exited client is recovered', async (t) => {
	const { credentials } = setup(t);
	credentials.saveTokens({ access_token: 'valid-test-token', token_type: 'Bearer', expires_in: 300 });
	const child = require('node:child_process').spawnSync(
		process.execPath,
		['-e', 'process.stdout.write(String(process.pid))'],
		{ encoding: 'utf8' }
	);
	assert.equal(child.status, 0);
	const lock = path.join(credentials.directory, 'refresh.lock');
	fs.mkdirSync(lock, { mode: 0o700 });
	fs.writeFileSync(path.join(lock, 'owner'), child.stdout);
	assert.equal((await credentials.refresh()).access_token, 'valid-test-token');
	assert(!fs.existsSync(lock));
});
test('revoked refresh credentials are cleared so a fresh login can recover', async t => {
 const {credentials,config}=setup(t);credentials.saveTokens({access_token:'expired',token_type:'Bearer',expires_in:0,refresh_token:'revoked'});
 const original=global.fetch;t.after(()=>global.fetch=original);
 global.fetch=async input=>{
  const url=String(input);
  if(url.includes('oauth-protected-resource'))return Response.json({resource:config.url,authorization_servers:['https://brain.example/oauth']});
  if(url.includes('oauth-authorization-server'))return Response.json({issuer:'https://brain.example/oauth',authorization_endpoint:'https://brain.example/oauth/authorize',token_endpoint:'https://brain.example/oauth/token',response_types_supported:['code'],code_challenge_methods_supported:['S256'],token_endpoint_auth_methods_supported:['none']});
  return Response.json({error:'invalid_grant'},{status:400});
 };
 await assert.rejects(credentials.refresh(),/brain-login/);assert.equal(credentials.tokens(),undefined);
});
test('exit flush confirms pushes and warns on failures without throwing', async t => {
 const {root}=setup(t);
 fs.writeFileSync(path.join(root,'brain.jsonc'),JSON.stringify({enabled:true,remote:{url:'https://brain.example/mcp',clientId:'desktop',redirectUrl:'http://127.0.0.1:8123/callback',scope:'read write repo:*'}}));
 const remote=require('../dist/brain-remote'), original=remote.connectRemoteBrain;
 let closed=0, calls=0, output='';const write=process.stderr.write;
 t.after(()=>{remote.connectRemoteBrain=original;process.stderr.write=write;});
 process.stderr.write=(s)=>{output+=s;return true;};
 remote.connectRemoteBrain=async(configRoot,repo)=>{assert.equal(configRoot,root);assert.equal(repo,'owner/repo');return {callTool:async input=>{calls++;assert.equal(input.name,'brain_flush');return {content:[{type:'text',text:JSON.stringify({state:'synced',files:1})}]};},close:async()=>closed++};};
 const {flushBrainOnExit}=require('../dist/runtime/brain-flush');
 const context={configRoot:root,mcpServers:{'agent-brain':{enabled:true,args:['--repository','owner/repo']}}};
 await flushBrainOnExit(context);assert.equal(calls,1);assert.equal(closed,1);assert.match(output,/pushed/);
 remote.connectRemoteBrain=async()=>{throw Error('offline');};await flushBrainOnExit(context);assert.match(output,/WARNING.*changes remain on the server.*offline/);
 context.mcpServers['agent-brain'].args=[];await flushBrainOnExit(context);assert.equal(calls,1);
});
test('launcher awaits asynchronous exit cleanup and preserves nonzero status', t => {
 const {spawnSync}=require('node:child_process');const {root}=setup(t);const marker=path.join(root,'flushed');
 const code=`require(${JSON.stringify(path.resolve(__dirname,'../dist/process'))}).execCommand(process.execPath,['-e','process.exit(7)'],process.env,undefined,async code=>{await new Promise(r=>setTimeout(r,30));require('fs').writeFileSync(${JSON.stringify(marker)},'done');return code;});`;
 const result=spawnSync(process.execPath,['-e',code],{encoding:'utf8',timeout:10000});assert.equal(result.status,7,result.stderr);assert.equal(fs.readFileSync(marker,'utf8'),'done');
});
test('signal exits finish asynchronous cleanup before preserving the signal', {skip:process.platform==='win32'}, t => {
 const {spawnSync}=require('node:child_process');const {root}=setup(t);const marker=path.join(root,'signal-flushed');
 const code=`require(${JSON.stringify(path.resolve(__dirname,'../dist/process'))}).execCommand(process.execPath,['-e',"process.kill(process.pid,'SIGTERM')"],process.env,undefined,async code=>{await new Promise(r=>setTimeout(r,20));require('fs').writeFileSync(${JSON.stringify(marker)},'done');return code;});`;
 const result=spawnSync(process.execPath,['-e',code],{encoding:'utf8',timeout:10000});assert.equal(result.signal,'SIGTERM',result.stderr);assert.equal(fs.readFileSync(marker,'utf8'),'done');
});
