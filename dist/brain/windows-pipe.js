"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.checkWindowsPipe = checkWindowsPipe;
const path = require("node:path");
const node_child_process_1 = require("node:child_process");
const node_util_1 = require("node:util");
async function checkWindowsPipe(pipePath, secure = false) {
    if (!/^\\\\\.\\pipe\\[a-zA-Z0-9._-]+$/.test(pipePath))
        throw new Error('Expected a local Windows named pipe (\\\\.\\pipe\\name).');
    const powershell = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    const helper = path.resolve(__dirname, '../../scripts/brain-pipe-security.ps1');
    try {
        await (0, node_util_1.promisify)(node_child_process_1.execFile)(powershell, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', helper,
            '-PipePath', pipePath, ...(secure ? ['-Secure'] : [])], { encoding: 'utf8', windowsHide: true, timeout: 15000 });
    }
    catch (error) {
        throw new Error(`Cannot ${secure ? 'secure' : 'verify'} the brain pipe: ${String(error)}`);
    }
}
