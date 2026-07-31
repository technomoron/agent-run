import * as fs from 'fs';
import * as path from 'path';
import { RenderContext, ToolName, WrapperArgs } from './model';
import { execCommand } from './process';
import { findLocalAiFiles, warnForLocalAiFiles } from './project';

export function runCodex(
	realBinary: string,
	permissionArgs: string[],
	context: RenderContext,
	args: string[],
	wrapperArgs: WrapperArgs
): void {
	const liveDir = context.paths.liveDir;
	const codexHomeDir = context.paths.codexHomeDir;
	const projectRoot = context.projectRoot;
	if (!fs.existsSync(path.join(codexHomeDir, 'AGENTS.md'))) {
		failMissingConfig('codex', context.profileDir);
	}

	const realPath = process.env.AGENT_RUN_REAL_PATH ?? process.env.PATH ?? '';
	fs.mkdirSync(codexHomeDir, { recursive: true });
	const env: Record<string, string | undefined> = {
		...process.env,
		CODEX_HOME: codexHomeDir,
		AGENT_DIR: liveDir,
		AGENT_PROFILE_DIR: context.profileDir,
		AGENT_RUN_PROJECT_ROOT: projectRoot,
		AGENT_RUN_REAL_PATH: realPath,
		PATH: `${path.join(liveDir, 'bin')}${path.delimiter}${realPath}`
	};
	const runtimeArgs =
		wrapperArgs.sandboxMode === 'danger' ? getDangerArgs('codex') : ['-a', 'on-request', '-s', 'workspace-write'];
	execCommand(
		realBinary,
		[
			...permissionArgs,
			...runtimeArgs,
			'-C',
			projectRoot,
			...(wrapperArgs.sandboxMode !== 'danger' && wrapperArgs.codexNetwork
				? ['--config', 'sandbox_workspace_write.network_access=true']
				: []),
			...args
		],
		env,
		codexHomeDir,
		(code) => postflightProjectCheck(context, wrapperArgs.local, code)
	);
}

export function runClaude(
	realBinary: string,
	permissionArgs: string[],
	context: RenderContext,
	args: string[],
	wrapperArgs: WrapperArgs
): void {
	const liveDir = context.paths.liveDir;
	const claudePath = path.join(liveDir, 'CLAUDE.md');
	if (!fs.existsSync(claudePath)) {
		failMissingConfig('claude', context.profileDir);
	}
	const claudeConfigDir = path.join(liveDir, '.claude');
	const realPath = process.env.AGENT_RUN_REAL_PATH ?? process.env.PATH ?? '';
	const env: Record<string, string | undefined> = {
		...process.env,
		AGENT_DIR: liveDir,
		AGENT_PROFILE_DIR: context.profileDir,
		AGENT_RUN_PROJECT_ROOT: context.projectRoot,
		AGENT_RUN_REAL_PATH: realPath,
		PATH: `${path.join(liveDir, 'bin')}${path.delimiter}${realPath}`
	};
	const runtimeArgs = wrapperArgs.sandboxMode === 'danger' ? getDangerArgs('claude') : permissionArgs;
	execCommand(
		realBinary,
		[
			...runtimeArgs,
			'--append-system-prompt-file',
			claudePath,
			'--settings',
			path.join(claudeConfigDir, 'agent-run-settings.json'),
			'--plugin-dir',
			claudeConfigDir,
			...args
		],
		env,
		context.projectRoot,
		(code) => postflightProjectCheck(context, wrapperArgs.local, code)
	);
}

function postflightProjectCheck(context: RenderContext, allowLocal: boolean, code: number): number {
	if (!context.guardrails.forbidRepoAiFiles) {
		return code;
	}
	if (!allowLocal) {
		removeClaudeLocalSettings(context.projectRoot);
	}
	const localAiFiles = findLocalAiFiles(context.projectRoot, context.profileDir);
	if (localAiFiles.length === 0) {
		return code;
	}
	warnForLocalAiFiles(null, context.projectRoot, localAiFiles);
	return allowLocal ? code : 1;
}

function removeClaudeLocalSettings(projectRoot: string): void {
	const claudeDir = path.join(projectRoot, '.claude');
	const localSettingsPath = path.join(claudeDir, 'settings.local.json');
	if (!fs.existsSync(localSettingsPath)) {
		return;
	}
	fs.rmSync(localSettingsPath);
	try {
		fs.rmdirSync(claudeDir);
	} catch (error) {
		if (!isDirectoryNotEmptyError(error)) {
			throw error;
		}
	}
	process.stderr.write(`agent-run: removed Claude's project-local settings: ${localSettingsPath}\n`);
}

function isDirectoryNotEmptyError(error: unknown): boolean {
	return error instanceof Error && 'code' in error && error.code === 'ENOTEMPTY';
}

function failMissingConfig(tool: ToolName, agentDir: string): never {
	process.stderr.write(`agent-run: no ${tool} config found for this project: ${agentDir}\n`);
	process.stderr.write(
		`agent-run: run \`agent-run ${tool} --none\` to bypass agent setup, or \`agent-run ${tool} --create\` to create profile files.\n`
	);
	process.exit(1);
}

export function getDangerArgs(tool: ToolName): string[] {
	return tool === 'codex' ? ['-a', 'never', '-s', 'danger-full-access'] : ['--dangerously-skip-permissions'];
}

export function getPermissionArgs(tool: ToolName): string[] {
	if (process.env.AGENT_WRAPPER_FORCE_PERMISSIVE !== '1') {
		return [];
	}
	if (tool === 'claude' && typeof process.getuid === 'function' && process.getuid() !== 0) {
		return ['--permission-mode', 'bypassPermissions'];
	}
	return [];
}
