const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test } = require('node:test');
const { renderGuardShims } = require('../dist/guards');

test('Windows guards preserve PATH entries and reject missing or recursive commands', { skip: process.platform !== 'win32' }, (t) => {
	const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-run guards !'));
	t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
	const guardDir = path.join(directory, 'guards');
	const realDir = path.join(directory, 'real tools');
	const emptyDir = path.join(directory, 'empty');
	for (const dir of [guardDir, realDir, emptyDir]) fs.mkdirSync(dir);
	const guards = renderGuardShims({ guardrails: { blockPublish: true }, paths: { binDir: guardDir } });
	for (const guard of guards) fs.writeFileSync(guard.path, guard.content.replace(/\n/g, '\r\n'));
	for (const name of ['npm', 'pnpm']) {
		fs.writeFileSync(path.join(realDir, `${name}.cmd`), '@echo off\r\necho received:%*\r\nexit /b 23\r\n');
		const run = (searchPath, realPath) => {
			const env = { ...process.env };
			for (const key of Object.keys(env)) {
				if (['PATH', 'AGENT_RUN_REAL_PATH'].includes(key.toUpperCase())) delete env[key];
			}
			env.PATH = searchPath;
			if (realPath !== undefined) env.AGENT_RUN_REAL_PATH = realPath;
			return spawnSync(process.env.ComSpec || 'cmd.exe', ['/d', '/v:off', '/s', '/c', `""${path.join(guardDir, `${name}.cmd`)}" "hello world""`], {
				env, cwd: guardDir, encoding: 'utf8', windowsVerbatimArguments: true, timeout: 5000
			});
		};
		for (const [searchPath, realPath] of [
			[`${realDir};${guardDir}`, undefined],
			[`${guardDir};${realDir}`, undefined],
			[`${guardDir};${realDir}`, realDir]
		]) {
			const result = run(searchPath, realPath);
			assert.equal(result.status, 23, result.stderr || result.error?.message);
			assert.match(result.stdout, /received:"hello world"/);
		}
		const missing = run(emptyDir);
		assert.equal(missing.status, 127, missing.stderr || missing.error?.message);
		assert.match(missing.stderr, /cannot find the real/);
		for (const [searchPath, realPath] of [[`${emptyDir};${guardDir};${realDir}`, undefined], [realDir, guardDir]]) {
			const recursive = run(searchPath, realPath);
			assert.equal(recursive.status, 127, recursive.stderr || recursive.error?.message);
			assert.match(recursive.stderr, /refused recursive/);
		}
	}
});
