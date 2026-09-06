import * as fs from 'fs';
import type { AgentId, AgentRuntime } from './types';
import type { WrapperArgs } from '../model';
import { postflightProjectCheck } from '../runtime/postflight';

export function assertRuntimeFile(tool: AgentId, filePath: string, profileDir: string): void {
	if (fs.existsSync(filePath)) {
		return;
	}
	process.stderr.write(`agent-run: no ${tool} config found for this project: ${profileDir}\n`);
	process.stderr.write(
		`agent-run: run \`agent-run ${tool} --none\` to bypass agent setup, or \`agent-run ${tool} --create\` to create profile files.\n`
	);
	process.exit(1);
}

export function withPostflight(runtime: AgentRuntime, wrapperArgs: WrapperArgs): (code: number) => number {
	return (code) => postflightProjectCheck(runtime.context, wrapperArgs.local, code);
}
