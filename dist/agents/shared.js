"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.assertRuntimeFile = assertRuntimeFile;
exports.withPostflight = withPostflight;
const fs = require("fs");
const postflight_1 = require("../runtime/postflight");
function assertRuntimeFile(tool, filePath, profileDir) {
    if (fs.existsSync(filePath)) {
        return;
    }
    process.stderr.write(`agent-run: no ${tool} config found for this project: ${profileDir}\n`);
    process.stderr.write(`agent-run: run \`agent-run ${tool} --none\` to bypass agent setup, or \`agent-run ${tool} --create\` to create profile files.\n`);
    process.exit(1);
}
function withPostflight(runtime, wrapperArgs) {
    return (code) => (0, postflight_1.postflightProjectCheck)(runtime.context, wrapperArgs.local, code);
}
