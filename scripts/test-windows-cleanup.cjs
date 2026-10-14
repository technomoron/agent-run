const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test } = require('node:test');

const powershell = process.env.AGENT_RUN_TEST_POWERSHELL || (process.platform === 'win32' ? 'powershell.exe' : 'pwsh');
const available = spawnSync(powershell, ['-NoProfile', '-NonInteractive', '-Command', 'exit 0']).status === 0;
function setup(t) {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent cleanup test '));
	t.after(() => fs.rmSync(root, { recursive: true, force: true }));
	return root;
}

test('Windows cleanup installer registers hourly limited-user maintenance without executing cleanup', { skip: !available }, (t) => {
	const root = setup(t);
	let source = fs.readFileSync(path.join(__dirname, 'install-windows-cleanup.ps1'), 'utf8');
	if (process.platform !== 'win32') source = source.replace('[System.Security.Principal.WindowsIdentity]::GetCurrent().Name', "'test-user'");
	const installer = path.join(root, 'install.ps1'); fs.writeFileSync(installer, source);
	const testScript = path.join(root, 'test.ps1');
	fs.writeFileSync(testScript, `
$ErrorActionPreference = 'Stop'
function New-ScheduledTaskAction { param($Execute, $Argument, $WorkingDirectory) [pscustomobject]@{Execute=$Execute; Argument=$Argument; WorkingDirectory=$WorkingDirectory} }
function New-ScheduledTaskPrincipal { param($UserId, $LogonType, $RunLevel) [pscustomobject]@{UserId=$UserId; LogonType=$LogonType; RunLevel=$RunLevel} }
function New-ScheduledTaskTrigger { param([switch]$Once, $At, $RepetitionInterval) [pscustomobject]@{Once=[bool]$Once; Interval=$RepetitionInterval.TotalHours} }
function New-ScheduledTaskSettingsSet { param([switch]$StartWhenAvailable, [switch]$AllowStartIfOnBatteries, [switch]$DontStopIfGoingOnBatteries, $ExecutionTimeLimit, $MultipleInstances) [pscustomobject]@{Limit=$ExecutionTimeLimit.TotalMinutes; MultipleInstances=$MultipleInstances} }
function Register-ScheduledTask { param($TaskName, $Action, $Principal, $Trigger, $Settings, $Description, [switch]$Force)
    [pscustomobject]@{Name=$TaskName; Action=$Action; Principal=$Principal; Trigger=$Trigger; Settings=$Settings} | ConvertTo-Json -Depth 5 | Set-Content $env:TEST_TASK_RESULT
}
& $env:TEST_INSTALLER -ConfigRoot $env:TEST_CONFIG_ROOT
`);
	const report = path.join(root, 'task.json'), config = path.join(root, 'config with spaces');
	const result = spawnSync(powershell, ['-NoProfile', '-NonInteractive', '-File', testScript], {encoding:'utf8', env:{...process.env, USERPROFILE:root, SystemRoot:root, TEST_INSTALLER:installer, TEST_CONFIG_ROOT:config, TEST_TASK_RESULT:report}});
	assert.equal(result.status, 0, result.stderr);
	const task = JSON.parse(fs.readFileSync(report, 'utf8').replace(/^\uFEFF/, ''));
	assert.equal(task.Name, 'Agent Session Cleanup');
	assert.equal(task.Principal.RunLevel, 'Limited'); assert.equal(task.Principal.LogonType, 'Interactive');
	assert.equal(task.Trigger.Once, true); assert.equal(task.Trigger.Interval, 1);
	assert.equal(task.Settings.MultipleInstances, 'IgnoreNew'); assert.equal(task.Settings.Limit, 30);
	assert.ok(task.Action.Argument.includes(`-ConfigRoot "${config}"`));
	assert.match(task.Action.Argument, /run-hidden\.vbs.*run-windows-cleanup\.ps1/);
	assert.ok(!fs.existsSync(path.join(config, 'runtime')));
});

test('Windows cleanup runner uses the shared retention command and logs success or invalid settings', { skip: !available }, (t) => {
	const root = setup(t), config = path.join(root, '.agent-run');
	fs.mkdirSync(config);
	const chats = path.join(root, '.gemini', 'tmp', 'project', 'chats'); fs.mkdirSync(chats, {recursive:true});
	const old = path.join(chats, 'old.json'), recent = path.join(chats, 'recent.json');
	for (const [file, days] of [[old,16], [recent,8]]) { fs.writeFileSync(file, '{}'); const date=new Date(Date.now()-days*86400000); fs.utimesSync(file,date,date); }
	const runner = path.join(root, 'runner.ps1');
	fs.writeFileSync(runner, fs.readFileSync(path.join(__dirname, 'run-windows-cleanup.ps1'), 'utf8').replace("Join-Path $PSScriptRoot '..\\dist\\agent-run.js'", '$env:TEST_AGENT_RUN'));
	const testScript = path.join(root, 'test.ps1');
	fs.writeFileSync(testScript, `function Get-Command { param($Name, $ErrorAction) [pscustomobject]@{Source=$env:TEST_NODE} }\n& $env:TEST_RUNNER -ConfigRoot $env:TEST_CONFIG_ROOT\nexit $LASTEXITCODE\n`);
	const env = {...process.env, HOME:root, USERPROFILE:root, CODEX_HOME:path.join(root,'.codex'), CLAUDE_CONFIG_DIR:path.join(root,'.claude'), GROK_HOME:path.join(root,'.grok'), GEMINI_CLI_HOME:root, TEST_CONFIG_ROOT:config, TEST_RUNNER:runner, TEST_NODE:process.execPath, TEST_AGENT_RUN:path.resolve(__dirname,'../dist/agent-run.js')};
	delete env.AGENT_RUN_SESSION_RETENTION_DAYS;
	const run = () => spawnSync(powershell, ['-NoProfile','-NonInteractive','-File',testScript],{encoding:'utf8',env});
	fs.writeFileSync(path.join(config,'cleanup.env'), 'AGENT_RUN_SESSION_RETENTION_DAYS=invalid\n');
	assert.equal(run().status, 1); assert.ok(fs.existsSync(old));
	const log = path.join(config,'runtime','cleanup.log');
	assert.match(fs.readFileSync(log,'utf8').replaceAll('\0',''), /non-negative whole number/);
	fs.writeFileSync(path.join(config,'cleanup.env'), 'AGENT_RUN_SESSION_RETENTION_DAYS=14\n');
	const result = run(); assert.equal(result.status,0,result.stderr);
	assert.ok(!fs.existsSync(old)); assert.ok(fs.existsSync(recent));
	assert.match(fs.readFileSync(log,'utf8').replaceAll('\0',''), /gemini: removed 1 session/);
});
