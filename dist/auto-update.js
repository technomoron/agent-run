"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.autoUpdate = autoUpdate;
const fs = require("node:fs");
const path = require("node:path");
const node_child_process_1 = require("node:child_process");
const utils_1 = require("./utils");
// Install the packaged hourly updater only when explicitly requested.
function autoUpdate(dryRun) {
    if (process.platform !== 'linux')
        (0, utils_1.fail)('auto-update currently requires Linux with systemd.');
    if (!dryRun && !fs.existsSync('/run/systemd/system'))
        (0, utils_1.fail)('auto-update requires a running systemd host; use --dry-run to preview installation.');
    const installer = path.resolve(__dirname, '..', 'scripts', 'install-systemd-jobs.sh');
    if (!fs.existsSync(installer))
        (0, utils_1.fail)(`Missing packaged updater installer: ${installer}`);
    const result = (0, node_child_process_1.spawnSync)('bash', [installer, '--ai-tools', ...(dryRun ? ['--dry-run'] : [])], { shell: false, stdio: 'inherit' });
    if (result.error)
        (0, utils_1.fail)(`Cannot run updater installer: ${result.error.message}`);
    process.exitCode = result.status ?? 1;
}
