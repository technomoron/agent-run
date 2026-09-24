import * as path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

export async function checkWindowsPipe(pipePath: string, secure = false): Promise<void> {
	if (!/^\\\\\.\\pipe\\[a-zA-Z0-9._-]+$/.test(pipePath)) throw new Error('Expected a local Windows named pipe (\\\\.\\pipe\\name).');
	const powershell = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
	const helper = path.resolve(__dirname, '../../scripts/brain-pipe-security.ps1');
	try {
		await promisify(execFile)(powershell, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', helper,
			'-PipePath', pipePath, ...(secure ? ['-Secure'] : [])], { encoding: 'utf8', windowsHide: true, timeout: 15000 });
	} catch (error) { throw new Error(`Cannot ${secure ? 'secure' : 'verify'} the brain pipe: ${String(error)}`); }
}
