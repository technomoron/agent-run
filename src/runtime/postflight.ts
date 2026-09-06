import * as fs from 'fs';
import * as path from 'path';
import type { RenderContext } from '../model';
import { findLocalAiFiles, warnForLocalAiFiles } from '../project';

export function postflightProjectCheck(context: RenderContext, allowLocal: boolean, code: number): number {
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
