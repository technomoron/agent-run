"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.postflightProjectCheck = postflightProjectCheck;
const fs = require("fs");
const path = require("path");
const project_1 = require("../project");
function postflightProjectCheck(context, allowLocal, code) {
    if (!context.guardrails.forbidRepoAiFiles) {
        return code;
    }
    if (!allowLocal) {
        removeClaudeLocalSettings(context.projectRoot);
    }
    const localAiFiles = (0, project_1.findLocalAiFiles)(context.projectRoot, context.profileDir);
    if (localAiFiles.length === 0) {
        return code;
    }
    (0, project_1.warnForLocalAiFiles)(null, context.projectRoot, localAiFiles);
    return allowLocal ? code : 1;
}
function removeClaudeLocalSettings(projectRoot) {
    const claudeDir = path.join(projectRoot, '.claude');
    const localSettingsPath = path.join(claudeDir, 'settings.local.json');
    if (!fs.existsSync(localSettingsPath)) {
        return;
    }
    fs.rmSync(localSettingsPath);
    try {
        fs.rmdirSync(claudeDir);
    }
    catch (error) {
        if (!isDirectoryNotEmptyError(error)) {
            throw error;
        }
    }
    process.stderr.write(`agent-run: removed Claude's project-local settings: ${localSettingsPath}\n`);
}
function isDirectoryNotEmptyError(error) {
    return error instanceof Error && 'code' in error && error.code === 'ENOTEMPTY';
}
