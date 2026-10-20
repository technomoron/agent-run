"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.brainCommand = brainCommand;
exports.brainQuery = brainQuery;
const cross_spawn_1 = require("cross-spawn");
const utils_1 = require("./utils");
const process_1 = require("./process");
// The server is installed separately. Use argv arrays so paths and forwarded
// arguments never become shell commands, including through Windows npm shims.
function brainCommand(args) {
    const executable = (0, utils_1.findExecutable)('agent-brain');
    if (!executable)
        throw new Error('Cannot run agent-brain. Install @technomoron/agent-brain separately and add it to PATH.');
    (0, process_1.execCommand)(executable, args, { ...process.env }, process.cwd());
}
function brainQuery(args) {
    const result = (0, cross_spawn_1.sync)('agent-brain', args, { encoding: 'utf8', shell: false, maxBuffer: 4 * 1024 * 1024 });
    if (result.error)
        throw new Error(`Cannot run agent-brain. Install @technomoron/agent-brain separately. ${result.error.message}`);
    if (result.status !== 0)
        throw new Error(result.stderr.trim() || `agent-brain exited with status ${result.status}`);
    return JSON.parse(result.stdout);
}
