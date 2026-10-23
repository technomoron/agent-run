import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fail } from './utils';

// Install the packaged hourly updater only when explicitly requested.
export function autoUpdate(dryRun: boolean): void {
	if (process.platform !== 'linux') fail('auto-update currently requires Linux with systemd.');
	if (!dryRun && !fs.existsSync('/run/systemd/system')) fail('auto-update requires a running systemd host; use --dry-run to preview installation.');
	const installer = path.resolve(__dirname, '..', 'scripts', 'install-systemd-jobs.sh');
	if (!fs.existsSync(installer)) fail(`Missing packaged updater installer: ${installer}`);
	const result = spawnSync('bash', [installer, '--ai-tools', ...(dryRun ? ['--dry-run'] : [])], { shell: false, stdio: 'inherit' });
	if (result.error) fail(`Cannot run updater installer: ${result.error.message}`);
	process.exitCode = result.status ?? 1;
}
