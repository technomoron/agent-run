import { sync as spawnSync } from 'cross-spawn';
import { findExecutable } from './utils';
import { execCommand } from './process';

// The server is installed separately. Use argv arrays so paths and forwarded
// arguments never become shell commands, including through Windows npm shims.
export function brainCommand(args: string[]): void {
	const executable = findExecutable('agent-brain');
	if (!executable) throw new Error('Cannot run agent-brain. Install @technomoron/agent-brain separately and add it to PATH.');
	execCommand(executable, args, { ...process.env }, process.cwd());
}

export function brainQuery<T>(args: string[]): T {
	const result = spawnSync('agent-brain', args, { encoding: 'utf8', shell: false, maxBuffer: 4 * 1024 * 1024 });
	if (result.error) throw new Error(`Cannot run agent-brain. Install @technomoron/agent-brain separately. ${result.error.message}`);
	if (result.status !== 0) throw new Error(result.stderr.trim() || `agent-brain exited with status ${result.status}`);
	return JSON.parse(result.stdout) as T;
}
