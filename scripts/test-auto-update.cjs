const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test } = require('node:test');
const root = path.resolve(__dirname, '..');
const cli = path.join(root, 'dist/agent-run.js');
const invoke = (args, options = {}) => spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8', ...options });

test('auto-update help and argument validation do not install or require a profile', () => {
 const help = invoke(['auto-update', '--help']);
 assert.equal(help.status, 0, help.stderr);
 assert.match(help.stdout, /hourly/);
 assert.match(help.stdout, /Gemini, Grok/);
 for (const args of [['auto-update', '--force'], ['auto-update', '/tmp/project']]) {
  const result = invoke(args);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /unknown auto-update option/);
 }
});

test('auto-update dry-run executes the packaged installer without writing system or profile files', { skip: process.platform !== 'linux' }, (t) => {
 const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'auto update '));
 t.after(() => fs.rmSync(temporary, { recursive: true, force: true }));
 const result = invoke(['--configdir', path.join(temporary, 'config'), 'auto-update', '--dry-run'], {
  env: { ...process.env, INSTALL_LIBEXEC_DIR: path.join(temporary, 'helpers'), SYSTEMD_DIR: path.join(temporary, 'system'), SYSTEMD_USER_DIR: path.join(temporary, 'users') }
 });
 assert.equal(result.status, 0, result.stderr);
 assert.match(result.stdout, /systemctl enable --now ai-tools-update\.timer/);
 assert.match(result.stdout, /scripts\/update-ai-tools\.sh/);
 assert.match(result.stdout, /cleanup-agent-sessions/);
 assert.deepEqual(fs.readdirSync(temporary), []);
});

test('auto-update rejects unsupported hosts before spawning an installer', () => {
 for (const platform of ['darwin', 'win32']) {
  const result = spawnSync(process.execPath, ['-e', `Object.defineProperty(process, 'platform', { value: ${JSON.stringify(platform)} }); require(${JSON.stringify(path.join(root, 'dist/auto-update'))}).autoUpdate(false);`], { encoding: 'utf8' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /requires Linux with systemd/);
 }
});

test('auto-update forwards exact installer arguments and propagates its failure', () => {
 const script = `
 Object.defineProperty(process, 'platform', { value: 'linux' });
 const fs = require('node:fs'); const originalExists = fs.existsSync;
 fs.existsSync = p => p === '/run/systemd/system' || originalExists(p);
 require('node:child_process').spawnSync = (command, args, options) => {
  require('node:assert/strict').equal(command, 'bash');
  require('node:assert/strict').deepEqual(args, [${JSON.stringify(path.join(root, 'scripts/install-systemd-jobs.sh'))}, '--ai-tools']);
  require('node:assert/strict').equal(options.shell, false);
  return { status: 17 };
 };
 require(${JSON.stringify(path.join(root, 'dist/auto-update'))}).autoUpdate(false);
 `;
 const result = spawnSync(process.execPath, ['-e', script], { encoding: 'utf8' });
 assert.equal(result.status, 17, result.stderr);
});
